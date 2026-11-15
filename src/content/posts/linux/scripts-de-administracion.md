---
title: "Un script de administración de verdad"
description: El backup diario de PostgreSQL con bloqueo, limpieza, verificación y rotación. Lo que shellcheck encuentra en un script ingenuo, y dos correcciones que salieron de probarlo.
date: 2026-10-19
topic: Infraestructura
tags: [linux, bash, postgresql]
goal: Escribir un script de mantenimiento que se pueda dejar corriendo sin supervisión.
course: linux-administracion
section: scripting
order: 4
---

Un script que corre de madrugada, sin nadie mirando, tiene exigencias que uno de prueba no: no puede correr dos veces a la vez, tiene que limpiar lo que deja aunque falle, tiene que dejar registro y tiene que avisar si algo salió mal. El caso: el volcado diario de la base de facturación.

## El script ingenuo

```bash Mal · /tmp/malo.sh
#!/bin/bash
destino=$1
for f in $(ls /var/backups/*.dump); do
  cp $f $destino
done
cd /var/backups
rm -rf $destino/*
```

Parece inofensivo. shellcheck no opina lo mismo:

```text Terminal · shellcheck /tmp/malo.sh
In /tmp/malo.sh line 3:
         ^-----------------------^ SC2045 (error): Iterating over ls output is fragile. Use globs.
In /tmp/malo.sh line 4:
     ^-- SC2086 (info): Double quote to prevent globbing and word splitting.
        ^------^ SC2086 (info): Double quote to prevent globbing and word splitting.
In /tmp/malo.sh line 6:
^-------------^ SC2164 (warning): Use 'cd ... || exit' or 'cd ... || return' in case cd fails.
In /tmp/malo.sh line 7:
       ^--------^ SC2115 (warning): Use "${var:?}" to ensure this never expands to /* .
```

El último es el grave: si el script se ejecuta sin argumento, `destino` queda vacío y la línea 7 es `rm -rf /*`. Y como el `cd` de la línea 6 no se comprueba, si falla el `rm` corre en otro directorio.

## El script de verdad

```bash /usr/local/sbin/backup-facturacion
#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly BASE=facturacion
readonly DESTINO=/var/backups/facturacion
readonly CONSERVAR_DIAS=14
readonly BLOQUEO=/run/lock/backup-facturacion.lock

log() { printf '%s %s\n' "$(date -Is)" "$*"; }
morir() { log "ERROR: $*" >&2; exit 1; }

exec 9>"$BLOQUEO"
flock -n 9 || morir "ya hay un backup corriendo"

temporal=$(mktemp -d)
trap 'rm -rf "$temporal"' EXIT

archivo="$BASE-$(date +%Y%m%d-%H%M%S).dump"
log "volcando $BASE"
runuser -u postgres -- pg_dump --format=custom --dbname="$BASE" >"$temporal/$archivo" \
  || morir "pg_dump falló"

pg_restore --list "$temporal/$archivo" >/dev/null || morir "el volcado no se puede leer"

install -d -m 0750 "$DESTINO"
mv "$temporal/$archivo" "$DESTINO/"
log "listo: $DESTINO/$archivo ($(du -h "$DESTINO/$archivo" | cut -f1))"

find "$DESTINO" -name "$BASE-*.dump" -mtime +"$CONSERVAR_DIAS" -print -delete |
  while read -r viejo; do log "borrado $viejo"; done
```

```text Terminal
$ shellcheck /usr/local/sbin/backup-facturacion && echo "shellcheck ok"
shellcheck ok
```

Pieza por pieza:

**`exec 9>"$BLOQUEO"` y `flock -n 9`.** Abre el archivo de bloqueo en el descriptor 9 y pide un bloqueo exclusivo sin esperar. Si otra copia del script lo tiene, este falla al instante:

```text Terminal · Dos corridas a la vez
2026-10-19T21:53:18+00:00 ERROR: ya hay un backup corriendo
```

El bloqueo lo libera el kernel cuando el proceso termina, aunque muera con `kill -9`. Un archivo `.pid` que el script crea y borra no tiene esa garantía.

**`mktemp -d` y `trap ... EXIT`.** El volcado se escribe en un directorio temporal que se borra **siempre** al salir, termine bien, falle o lo corten con `Ctrl+C`. Un volcado a medias nunca llega a `/var/backups`.

**Escribir afuera, mover adentro.** El archivo aparece en el destino recién cuando está completo y verificado. `mv` dentro del mismo sistema de archivos es atómico; entre sistemas de archivos distintos copia y borra, así que el temporal y el destino conviene que estén en el mismo disco si los archivos son grandes.

**`pg_restore --list`.** Comprueba que el volcado se puede leer. Es barato, y detecta un archivo truncado antes de que lo necesites.

**`runuser -u postgres --`.** Ejecuta `pg_dump` como el usuario `postgres`, que entra a la base sin contraseña por *peer authentication*. La salida la escribe el script, como root.

**`find -mtime +14 -delete`.** La rotación. Un backup que no rota termina llenando el disco, como en [disco lleno](/blog/linux/espacio-en-disco).

## Dos correcciones que salieron de probarlo

La primera versión no tenía `umask 077`. El resultado:

```text Terminal
-rw-r--r-- 1 root root 15481 Oct 19 21:53 facturacion-20261019-215318.dump
```

Un volcado de toda la base, legible por cualquier usuario del servidor. Con `umask 077`:

```text Terminal
-rw------- 1 root root 15481 Oct 19 21:53 facturacion-20261019-215335.dump
```

La segunda apareció al probar la restauración: `pg_restore` corriendo como `postgres` no puede leer un archivo de root en un directorio `0750`. La solución es que root lo lea y se lo pase por la entrada estándar:

```bash Terminal · Restaurar en una base de prueba
sudo runuser -u postgres -- createdb prueba_restore
sudo runuser -u postgres -- pg_restore --no-owner --dbname=prueba_restore < /var/backups/facturacion/facturacion-20261019-215335.dump
sudo runuser -u postgres -- psql -d prueba_restore -Atc "select count(*) from comprobantes"
```

```text Terminal
13
```

Trece comprobantes, los que había. Un backup sin restauración probada es una hipótesis, y por eso la prueba de restore tiene lugar propio en el [plan de recuperación](/blog/linux/plan-de-recuperacion).

## Programarlo

Con un [timer de systemd](/blog/linux/timers-y-logs), como el de la API:

```ini /etc/systemd/system/backup-facturacion.service
[Unit]
Description=Backup diario de la base de facturación
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-facturacion
Nice=19
IOSchedulingClass=idle
```

```ini /etc/systemd/system/backup-facturacion.timer
[Timer]
OnCalendar=*-*-* 02:30
Persistent=true

[Install]
WantedBy=timers.target
```

`Nice=19` e `IOSchedulingClass=idle` hacen que el backup ceda la CPU y el disco a la API si las dos los necesitan. Y como todo lo que el script imprime va al journal, `journalctl -u backup-facturacion` es el historial de cada noche.

### Que avise cuando falla

Un backup que falla en silencio es peor que no tenerlo, porque creés que lo tenés. systemd puede activar otra unidad cuando una falla:

```ini /etc/systemd/system/backup-facturacion.service · En [Unit]
OnFailure=avisar@%n.service
```

```ini /etc/systemd/system/avisar@.service
[Unit]
Description=Aviso de falla de %i

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/avisar "%i falló en %H"
```

Donde `avisar` es un script de una línea que manda un correo, un mensaje a un webhook de chat, o lo que use tu equipo. `%n` es el nombre de la unidad que falló y `%H` el del servidor. En el laboratorio, con un `avisar` que solo escribe en el journal y `pg_dump` escondido a propósito:

```text Terminal · journalctl -t avisos -n 1 -o cat
backup-facturacion.service falló en servidor
```

## Dónde instalar los scripts

| Dónde | Qué |
|---|---|
| `/usr/local/sbin` | Scripts de administración, para root |
| `/usr/local/bin` | Scripts para cualquier usuario |
| Un paquete `.deb` o Ansible | Cuando son varios servidores |

Nunca en `/usr/bin` o `/usr/sbin`, que son del gestor de paquetes, y nunca en el home de alguien.

> **Quedate con esto**
> Un script desatendido necesita `flock` para no correr dos veces, `mktemp` con `trap ... EXIT` para limpiar siempre, y escribir en un temporal y mover al final para no dejar archivos a medias. `umask 077` si genera algo con datos. Verificá lo que produce, rotá lo viejo, y que lo programe un timer con `OnFailure=` para enterarte cuando falla. shellcheck antes de instalarlo en `/usr/local/sbin`.
