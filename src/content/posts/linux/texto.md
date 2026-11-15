---
title: "Procesar texto: grep, sed, awk y compañía"
description: Analizar el access log real de Nginx para encontrar quién te escanea, editar configuración con sed sin romperla, y awk para todo lo que tiene columnas.
date: 2026-10-19
topic: Infraestructura
tags: [linux, bash, awk, sed]
goal: Responder preguntas sobre logs y archivos de configuración con una línea de shell.
course: linux-administracion
section: scripting
order: 3
---

En Linux casi todo es texto: logs, configuración, la salida de los comandos. Saber cortarlo, filtrarlo y contarlo convierte una pregunta de diez minutos en una línea.

El material de esta lección es el `access.log` real del Nginx que está delante de la API, después de un rato de tráfico desde tres máquinas, algunas pidiendo cosas que no existen.

```text /var/log/nginx/access.log · dos líneas
172.20.0.3 - - [19/Oct/2026:21:52:11 +0000] "POST /comprobantes HTTP/1.1" 201 115 "-" "curl/8.5.0"
172.20.0.3 - - [19/Oct/2026:21:52:11 +0000] "POST /comprobantes HTTP/1.1" 201 115 "-" "curl/8.5.0"
```

Separado por espacios, el campo 1 es la IP, el 7 la ruta, el 9 el código HTTP y el 10 los bytes.

## La herramienta de cada tarea

| Para | Herramienta |
|---|---|
| Filtrar líneas que coinciden | `grep` |
| Reemplazar o editar | `sed` |
| Trabajar con columnas, sumar, agrupar | `awk` |
| Cortar columnas simples | `cut` |
| Ordenar, contar repetidos | `sort`, `uniq -c` |
| Pasar una lista como argumentos | `xargs` |

## Contar y ordenar

¿Quién hace más pedidos?

```text Terminal · awk '{print $1}' access.log | sort | uniq -c | sort -rn
     61 172.20.0.3
     11 172.20.0.4
      4 127.0.0.1
```

`uniq -c` cuenta líneas repetidas **consecutivas**, por eso va después de `sort`. El `sort -rn` final ordena por número, de mayor a menor. Esta tubería es la que más vas a escribir en tu vida.

¿Qué códigos devuelve el servidor?

```text Terminal · awk '{print $9}' access.log | sort | uniq -c | sort -rn
     43 200
     20 404
     12 201
      1 422
```

¿Qué se pide que no existe?

```text Terminal · awk '$9 == 404 {print $7}' access.log | sort | uniq -c | sort -rn | head -5
      5 /wp-login.php
      5 /.env
      2 /phpmyadmin/
      2 /comprobantes/F001-14
      2 /admin
```

Ahí está el escaneo: `/wp-login.php`, `/.env`, `/phpmyadmin/` en un servidor que no tiene nada de eso. Es el ruido normal de cualquier IP pública. `/.env` merece atención aparte: los bots lo buscan porque muchos proyectos dejan sus secretos en un `.env` servido por error.

## grep

```text Terminal
$ grep -cE '"(GET|POST) /(wp-|\.env|\.git|phpmyadmin)' access.log
14
```

| Opción | Hace |
|---|---|
| `-E` | Expresiones regulares extendidas: `|`, `+`, `?` sin escapar |
| `-c` | Cuenta en lugar de mostrar |
| `-v` | Las que **no** coinciden |
| `-i` | Sin distinguir mayúsculas |
| `-r` | En todos los archivos de un directorio |
| `-l` | Solo los nombres de archivo que coinciden |
| `-A 3`, `-B 3` | Tres líneas después, antes |
| `-F` | Texto literal, sin expresión regular |

Para buscar en logs comprimidos, `zgrep` lee los `.gz` de logrotate sin descomprimirlos.

## awk

`awk` procesa línea por línea, parte cada una en campos y ejecuta acciones con condiciones. Es un lenguaje pequeño:

```text Terminal · awk '{b[$9] += $10} END {for (c in b) printf "%s %d\n", c, b[c]}' access.log | sort
200 19826
201 1384
404 486
422 31
```

Bytes por código: un array asociativo indexado por el campo 9 que acumula el 10, impreso al final. Las piezas:

| | |
|---|---|
| `$1`, `$NF` | Primer campo, último campo |
| `NR` | Número de línea |
| `-F:` | Separador: dos puntos, como en `/etc/passwd` |
| `condición {acción}` | La acción solo en las líneas que cumplen |
| `BEGIN {}`, `END {}` | Antes de la primera línea, después de la última |

Con `/etc/passwd`:

```text Terminal · awk -F: '$7 !~ /nologin|false/ {printf "%-12s %-6s %s\n", $1, $3, $7}' /etc/passwd
root         0      /bin/bash
sync         4      /bin/sync
ubuntu       1000   /bin/bash
ana          1001   /bin/bash
postgres     107    /bin/bash
```

Las cuentas que tienen shell. `sync` y `postgres` son esperables; una cuenta de servicio desconocida con `/bin/bash` sería para investigar.

Y `awk` sí tiene decimales, a diferencia de Bash: `awk -F';' '{s += $2} END {printf "%.2f\n", s}' montos.csv`.

## sed

`sed` edita texto en flujo. Para configuración, el uso típico es reemplazar el valor de una directiva:

```bash Terminal
sudo sed -i.bak 's/^MaxAuthTries .*/MaxAuthTries 4/' /etc/ssh/sshd_config.d/10-endurecer.conf
diff /etc/ssh/sshd_config.d/10-endurecer.conf{.bak,}
```

```text Terminal
5c5
< MaxAuthTries 3
---
> MaxAuthTries 4
```

`-i.bak` edita el archivo **y deja una copia** con ese sufijo. `-i` a secas no deja copia; en un servidor, siempre con sufijo.

| | Hace |
|---|---|
| `s/viejo/nuevo/` | Reemplaza la primera vez en cada línea |
| `s/viejo/nuevo/g` | Todas las veces |
| `-n '/patrón/p'` | Imprime solo las líneas que coinciden |
| `/patrón/d` | Borra las líneas que coinciden |
| `-E` | Expresiones extendidas, con grupos `( )` y `\1` |

```text Terminal · sed -E 's/^([A-Za-z]+) (.*)$/\1 = \2/' 10-endurecer.conf | head -2
PasswordAuthentication = no
KbdInteractiveAuthentication = no
```

Para cambios de configuración que se repiten, sed sirve. Para gestionar la configuración de varios servidores, [Ansible](/blog/linux/ansible) con plantillas es más seguro: un `sed` que no encuentra la línea no falla, simplemente no cambia nada.

## xargs

Pasa una lista como argumentos a un comando:

```bash Terminal
find /etc/nginx -name '*.conf' -print0 | xargs -0 grep -l 'include'
```

`-print0` y `-0` separan con un carácter nulo en lugar de espacios, para que los nombres con espacios no se partan. `xargs -P 4` corre cuatro a la vez.

## jq, para JSON

Los logs de la API son JSON, una línea por evento. Para eso, `jq`:

```bash Terminal
journalctl -u facturacion -o cat | grep '^{' | jq -r 'select(.nivel == "INFO" and .comprobante) | [.momento, .comprobante, .total] | @tsv'
```

> **Quedate con esto**
> `awk '{print $N}' | sort | uniq -c | sort -rn` responde «¿cuánto de cada cosa?» sobre cualquier log. `grep -E` para filtrar, `awk` para columnas y sumas, con decimales. `sed -i.bak` para editar dejando copia, y `diff` para ver qué cambió. `find -print0 | xargs -0` para nombres con espacios. Y para JSON, `jq`.
