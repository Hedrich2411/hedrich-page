---
title: "La shell: comandos, redirecciones y códigos de salida"
description: Qué tipo de comando estás corriendo, a dónde va cada salida y cómo saber si algo falló. Las tres cosas que se usan en cada línea de administración.
date: 2026-10-19
topic: Infraestructura
tags: [linux, bash]
goal: Componer comandos con redirecciones y tuberías sabiendo exactamente qué pasa con la salida y los errores.
course: linux-administracion
section: fundamentos
order: 3
---

La shell es el programa que lee lo que escribís, lo interpreta y ejecuta. En Ubuntu y RHEL es **Bash**. En un servidor llegás a ella por SSH, que tiene [su propia lección](/blog/linux/ssh); acá importa lo que pasa una vez adentro.

## Qué estás ejecutando

No todo lo que escribís es un programa. `type` lo dice:

```text Terminal
$ type cd ls echo systemctl
cd is a shell builtin
ls is /usr/bin/ls
echo is a shell builtin
systemctl is /usr/bin/systemctl
```

| Tipo | Ejemplo | Por qué importa |
|---|---|---|
| Builtin | `cd`, `echo`, `export` | Corre dentro de la shell; `cd` no podría ser un programa aparte |
| Programa | `ls`, `systemctl` | Un archivo en algún directorio del `$PATH` |
| Alias | `ll='ls -alF'` | Solo existe en shells interactivas |
| Función | Definida en `.bashrc` o en un script | Como un alias, pero con lógica |

La última columna del alias muerde: un alias definido en tu `.bashrc` **no existe dentro de un script**. En el laboratorio, `type ll` dentro de un script da `ll: not found` aunque en tu terminal funcione.

Para la documentación: `man comando` es la referencia completa, `comando --help` el resumen, y `man -k palabra` busca entre todas las páginas cuando no sabés cómo se llama lo que buscás.

## Tres canales

Cada proceso nace con tres canales abiertos:

| Número | Nombre | Por defecto |
|---|---|---|
| 0 | stdin, la entrada | El teclado |
| 1 | stdout, la salida | La pantalla |
| 2 | stderr, los errores | La pantalla |

Que errores y salida normal vayan por canales distintos es lo que permite separarlos:

```bash Terminal
ls /etc/hostname /no-existe > salida.txt 2> errores.txt
```

```text Terminal
$ cat salida.txt
/etc/hostname
$ cat errores.txt
ls: cannot access '/no-existe': No such file or directory
```

| Escritura | Hace |
|---|---|
| `> archivo` | stdout al archivo, pisándolo |
| `>> archivo` | stdout al final del archivo |
| `2> archivo` | stderr al archivo |
| `> archivo 2>&1` | Los dos al mismo archivo |
| `&> archivo` | Lo mismo, abreviado en Bash |
| `2> /dev/null` | Tirar los errores |
| `< archivo` | stdin desde el archivo |

### El orden de `2>&1` importa

`2>&1` significa «que el canal 2 vaya a donde **ahora** va el 1». Se lee de izquierda a derecha:

```bash Terminal
ls /etc/hostname /no-existe > todo.txt 2>&1     # los dos al archivo
ls /etc/hostname /no-existe 2>&1 > todo.txt     # el error a la pantalla
```

En la segunda, cuando se evalúa `2>&1` el canal 1 todavía apunta a la pantalla, así que el error sale por pantalla y solo la salida normal termina en el archivo. Es el error de redirección más común en un cron que «no registra los errores».

## Tuberías

`|` conecta la salida de un comando con la entrada del siguiente. Es la forma de combinar herramientas chicas:

```bash Terminal
journalctl -u ssh --since today | grep "Failed password" | wc -l
```

`tee` copia lo que pasa por la tubería a un archivo sin cortarla, y tiene un uso que vas a necesitar seguido: escribir un archivo que requiere root. `sudo echo x > /etc/archivo` falla, porque la redirección la hace tu shell, que no es root. La forma correcta:

```bash Terminal
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/90-swap.conf
```

## Códigos de salida

Cada comando termina con un número: **0 es éxito, cualquier otro es falla**. Queda en `$?`:

```text Terminal
$ ls /no-existe; echo "codigo: $?"
ls: cannot access '/no-existe': No such file or directory
codigo: 2
$ grep -q root /etc/passwd; echo "codigo: $?"
codigo: 0
```

Los operadores `&&` y `||` usan ese número: `a && b` corre `b` solo si `a` salió bien, y `a || b` solo si falló.

```bash Terminal
sudo nginx -t && sudo systemctl reload nginx
```

Esa línea es un patrón de administración entero: verificá la configuración y recargá solo si está bien.

### Las tuberías esconden errores

El código de salida de una tubería es el del **último** comando:

```text Terminal
$ false | true; echo "sin pipefail: $?"
sin pipefail: 0
$ set -o pipefail; false | true; echo "con pipefail: $?"
con pipefail: 1
```

`pg_dump base | gzip > backup.sql.gz` devuelve 0 aunque `pg_dump` falle, porque `gzip` terminó bien con una entrada vacía. Con `set -o pipefail`, que es parte del encabezado de todo script de [Bash bien escrito](/blog/linux/bash-basico), la falla sube.

## Historial y atajos

- **`Ctrl+R`** busca hacia atrás en el historial. Es el atajo que más tiempo ahorra.
- **`!!`** repite el último comando; `sudo !!` lo repite con sudo.
- **`Alt+.`** pega el último argumento del comando anterior.
- Un espacio al principio de la línea hace que no quede en el historial, si `HISTCONTROL` incluye `ignorespace`, como en Ubuntu. Útil cuando escribís una contraseña en un comando, cosa que igual conviene evitar.

> **Quedate con esto**
> `type` dice si un comando es builtin, programa o alias, y los alias no existen en los scripts. La salida y los errores van por canales distintos; `2>&1` copia a donde apunta el 1 en ese momento, así que el orden importa. Para escribir como root, `| sudo tee`. Un código de salida 0 es éxito, y una tubería devuelve el del último comando salvo que actives `pipefail`.
