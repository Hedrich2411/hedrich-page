---
title: "Bash: variables, comillas y set -euo pipefail"
description: El encabezado de todo script, el bug de comillas que borra el archivo equivocado, y los cinco casos en los que set -e no te salva.
date: 2026-10-19
topic: Infraestructura
tags: [linux, bash]
goal: Escribir scripts de Bash que fallan rápido y de forma predecible en lugar de seguir con datos rotos.
course: linux-administracion
section: scripting
order: 1
---

Un script de Bash es una lista de comandos con variables y lógica. Lo difícil no es escribirlo: es que **no siga adelante cuando algo salió mal**, porque Bash, por defecto, sigue.

## El encabezado

```bash script.sh
#!/usr/bin/env bash
set -euo pipefail
```

| | Hace |
|---|---|
| `#!/usr/bin/env bash` | Ejecuta con el Bash que esté en el `PATH`. `#!/bin/sh` no es Bash, es `dash` en Ubuntu, y no tiene arrays ni `[[ ]]` |
| `set -e` | Corta el script si un comando falla |
| `set -u` | Corta si usás una variable que no existe |
| `set -o pipefail` | Una tubería falla si falla cualquiera de sus comandos, no solo el último |

```bash Terminal
chmod +x script.sh && ./script.sh
```

## Variables

```bash Terminal
base=facturacion                 # sin espacios alrededor del =
echo "base: $base"
echo "base: ${base}_backup"      # llaves cuando sigue texto pegado
hoy=$(date +%F)                  # salida de un comando
readonly DESTINO=/var/backups    # constante
export PGPASSWORD                # visible para los programas que lances
```

`base = facturacion`, con espacios, ejecuta un comando llamado `base` con dos argumentos. Es el primer error de todo el que empieza.

## Las comillas: el bug que borra lo que no era

```bash Terminal
touch "reporte final.txt" "reporte.txt" "final.txt"
archivo="reporte final.txt"
rm -v $archivo
```

```text Terminal
rm: cannot remove 'reporte': No such file or directory
removed 'final.txt'
```

Sin comillas, Bash **parte** el valor por los espacios: `rm` recibió dos argumentos, `reporte` y `final.txt`. El archivo que querías sigue ahí, y se borró otro. Si la variable tuviera un `*`, además lo expandiría como comodín.

**Regla: toda variable va entre comillas dobles.** `"$archivo"`, `"$@"`, `"$(comando)"`. Las excepciones son tan pocas que conviene no pensar en ellas.

Comillas simples cuando no querés que se expanda nada: `'$HOME'` es literalmente `$HOME`.

## Argumentos

| | Es |
|---|---|
| `$0` | El nombre del script |
| `$1`, `$2`… | Cada argumento |
| `$#` | Cuántos hay |
| `"$@"` | Todos, cada uno como argumento separado |
| `$?` | El código de salida del último comando |

`"$@"` contra `$*`, con un primer argumento que tiene un espacio:

```text Terminal · args "uno dos" tres
con $*:
[uno] [dos] [tres]
con "$@":
[uno dos] [tres]
```

Para pasarle los argumentos a otro comando sin romperlos, siempre `"$@"`.

## Valores por defecto y obligatorios

```text Terminal
$ bash -c 'set -u; echo "$NO_DEFINIDA"'
bash: line 1: NO_DEFINIDA: unbound variable
$ bash -c 'set -u; echo "${NO_DEFINIDA:-valor por defecto}"'
valor por defecto
```

| Expansión | Si la variable no existe o está vacía |
|---|---|
| `${var:-defecto}` | Usa `defecto` |
| `${var:=defecto}` | Usa `defecto` y lo asigna |
| `${var:?mensaje}` | Corta el script con `mensaje` |

`${1:?uso: $0 base}` es la forma corta de exigir un argumento. Y `rm -rf "${DESTINO:?}/"*` hace que, si `DESTINO` quedó vacía por un error, el script corte en lugar de ejecutar `rm -rf /*`.

## Manipular texto sin programas externos

```bash Terminal
ruta=/var/backups/facturacion-20261019.dump
echo "${ruta##*/}"        # facturacion-20261019.dump   (basename)
echo "${ruta%/*}"         # /var/backups                (dirname)
echo "${ruta%.dump}.sql"  # /var/backups/facturacion-20261019.sql
echo "${#ruta}"           # 38                          (largo)
nombre=Facturacion
echo "${nombre,,} ${nombre^^}"   # facturacion FACTURACION
```

`#` y `%` recortan desde el principio y desde el final; doblados, `##` y `%%`, recortan lo más largo posible.

## Números

```text Terminal
$ echo "$(( 2360 * 18 / 100 ))"
424
$ echo "$(( 7 / 2 ))"
3
```

Bash solo tiene enteros: 2360 por 18 % es 424,8 y da 424. Para montos, `awk` o Python; nunca la aritmética de Bash.

## Lo que set -e no atrapa

`set -e` tiene excepciones, y son las que causan los incidentes:

```text Terminal
1) sigue: || desactiva -e
2) sigue: dentro de if no cuenta
3) sigue: local tapa el error
4) separado: salió con 1
5) sigue: sin pipefail el pipe vale lo del último
6) con pipefail: salió con 1
```

```bash Los casos
false || true                  # 1. un comando con || nunca dispara -e
if false; then :; fi           # 2. la condición de un if tampoco
f() { local x=$(false); }      # 3. local devuelve 0 y tapa el error de $(false)
f() { local x; x=$(false); }   # 4. separado, sí corta
false | true                   # 5. sin pipefail, el pipe vale lo del último
```

El tercero es el más traicionero, porque parece código prolijo. Declará y asigná en líneas separadas cuando el valor viene de un comando que puede fallar.

Y en general: `set -e` es una red de seguridad, no un manejo de errores. Para lo que de verdad importa, como un `pg_dump`, comprobá explícitamente: `pg_dump ... || morir "pg_dump falló"`.

## shellcheck

Todo lo de esta lección lo detecta una herramienta:

```bash Terminal
sudo apt install shellcheck
shellcheck script.sh
```

Lo vas a ver contra un script con errores en [un script de administración de verdad](/blog/linux/scripts-de-administracion). Pasá shellcheck por todo script que vaya a un servidor.

> **Quedate con esto**
> Todo script empieza con `#!/usr/bin/env bash` y `set -euo pipefail`. Toda variable entre comillas dobles, porque sin ellas Bash parte el valor y un `rm` borra otro archivo. `"$@"` para pasar argumentos, `${var:?}` para exigirlos y proteger un `rm -rf`. Bash no tiene decimales. `set -e` no atrapa `||`, `if`, ni `local x=$(...)`, así que lo crítico se comprueba a mano. Y shellcheck siempre.
