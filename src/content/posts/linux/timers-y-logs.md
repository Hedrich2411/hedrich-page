---
title: "Timers, journald y logrotate"
description: Reemplazar el cron por un timer de systemd, consultar el journal como una base de datos, y la trampa de las prioridades en los logs de una aplicación.
date: 2026-10-19
topic: Infraestructura
tags: [linux, systemd, logs]
goal: Programar tareas con timers y encontrar en los logs lo que pasó, sin perderse en archivos.
course: linux-administracion
section: procesos
order: 4
---

La API de facturación tiene una tarea que corre cada cinco minutos: mandar a SUNAT los comprobantes pendientes. Con cron sería una línea. Con systemd son dos archivos, y valen la pena.

## Cron contra timers

| | cron | timer de systemd |
|---|---|---|
| Logs | Lo que redirijas a mano | El journal, con el resto |
| Si el servidor estaba apagado a la hora | Se pierde | `Persistent=true` la corre al arrancar |
| Si la corrida anterior sigue | Arranca otra encima | No arranca otra: la unidad ya está activa |
| Endurecimiento | No | El mismo que cualquier servicio |
| Correr a mano igual que lo haría el timer | Copiar la línea y rezar | `systemctl start unidad.service` |
| Variables de entorno | Casi ninguna | `EnvironmentFile=` |

La tercera fila reemplaza al `flock` que necesitaría un cron.

## El servicio y su timer

```ini /etc/systemd/system/enviar-pendientes.service
[Unit]
Description=Envía a SUNAT los comprobantes pendientes
After=network-online.target postgresql.service

[Service]
Type=oneshot
User=facturacion
Group=facturacion
WorkingDirectory=/srv/facturacion/app
EnvironmentFile=/etc/facturacion/entorno
ExecStart=/srv/facturacion/app/.venv/bin/facturacion enviar-pendientes --limite 50
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
```

```ini /etc/systemd/system/enviar-pendientes.timer
[Unit]
Description=Envío de pendientes cada cinco minutos

[Timer]
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
```

`Type=oneshot` es para algo que corre y termina. El servicio no tiene `[Install]`: no se habilita, lo activa el timer. Y `RandomizedDelaySec` agrega hasta 30 segundos al azar, para que diez servidores no golpeen al PSE en el mismo segundo.

`OnCalendar` tiene su propia sintaxis, y systemd la explica:

```text Terminal · systemd-analyze calendar '*:0/5' --iterations=3
Original form: *:0/5
Normalized form: *-*-* *:00/5:00
Next elapse: Mon 2026-10-19 21:50:00 UTC
Iteration #2: Mon 2026-10-19 21:55:00 UTC
Iteration #3: Mon 2026-10-19 22:00:00 UTC
```

| Expresión | Cuándo |
|---|---|
| `*:0/5` | Cada cinco minutos |
| `daily` | Todos los días a medianoche |
| `Mon..Fri 08:00` | Días hábiles a las 8 |
| `*-*-01 03:00` | El primero de cada mes a las 3 |

```bash Terminal
sudo systemctl daemon-reload
sudo systemctl enable --now enviar-pendientes.timer
```

```text Terminal · systemctl list-timers enviar-pendientes.timer
NEXT                            LEFT LAST PASSED UNIT                    ACTIVATES
Mon 2026-10-19 21:50:13 UTC 4min 28s -         - enviar-pendientes.timer enviar-pendientes.service
```

Y para probar, se corre a mano exactamente como lo haría el timer:

```text Terminal · sudo systemctl start enviar-pendientes; journalctl -u enviar-pendientes -o cat
Starting enviar-pendientes.service - Envía a SUNAT los comprobantes pendientes...
{"momento": "2026-10-19T21:45:44+0000", "nivel": "WARNING", "origen": "facturacion.aplicacion.enviar", "operacion": "enviar-pendientes-c9295e82", "mensaje": "PSE no disponible, se reintenta en la próxima corrida", "error": "ConnectError: [Errno -2] Name or service not known"}
{"momento": "2026-10-19T21:45:44+0000", "nivel": "INFO", "origen": "facturacion.cli", "operacion": "enviar-pendientes-c9295e82", "mensaje": "0 comprobantes enviados"}
enviar-pendientes.service: Deactivated successfully.
Finished enviar-pendientes.service - Envía a SUNAT los comprobantes pendientes.
```

El PSE del laboratorio no existe, así que el aviso es el esperado.

## El journal

journald recoge todo lo que los servicios escriben por stdout y stderr, más los mensajes del kernel y de syslog, con metadatos: unidad, PID, usuario, prioridad. Se consulta como una base de datos:

| Para | Comando |
|---|---|
| Un servicio | `journalctl -u facturacion` |
| Varios | `journalctl -u facturacion -u enviar-pendientes` |
| En vivo | `journalctl -u facturacion -f` |
| Las últimas líneas | `journalctl -u facturacion -n 50` |
| Por tiempo | `--since "10 min ago"`, `--since today`, `--since "2026-10-19 08:00" --until "09:00"` |
| Desde el arranque actual o el anterior | `-b`, `-b -1` |
| Por prioridad | `-p err`, `-p warning` |
| Solo el mensaje | `-o cat` |
| Todo, en JSON | `-o json` |
| Buscar texto | `--grep 'F001-42'` |
| El kernel | `-k` |

### La trampa de las prioridades

```text Terminal
$ journalctl -u enviar-pendientes -p warning
-- No entries --
```

La aplicación escribió un `WARNING` hace un minuto. ¿Por qué no aparece?

```text Terminal · journalctl -u enviar-pendientes -o json, campo PRIORITY
6 {"momento": "2026-10-19T21:45:44+0000", "nivel": "WARNING", ...
6 {"momento": "2026-10-19T21:45:44+0000", "nivel": "INFO", ...
```

Todo lo que sale por stdout o stderr se guarda con **prioridad 6, info**, diga lo que diga el texto. journald no lee el JSON de la aplicación. Dos salidas:

- **Buscar en el texto:** `journalctl -u enviar-pendientes --grep '"nivel": "WARNING"'`.
- **Prefijar la línea con la prioridad syslog.** journald interpreta `<4>` al principio como *warning* y `<3>` como *error*:

```text Terminal
$ systemd-run --wait -p SyslogIdentifier=prueba sh -c 'echo "<4>esto es un aviso"; echo "<3>esto es un error"; echo "sin prefijo"'
$ journalctl -t prueba -p warning -o cat
esto es un aviso
esto es un error
```

Un formateador de logs que anteponga `<4>` a las advertencias hace que `-p warning` funcione como esperás.

### Que no llene el disco

```text Terminal
$ journalctl --disk-usage
Archived and active journals take up 8.0M in the file system.
```

Por defecto, el journal puede crecer hasta el 10 % del sistema de archivos, con un tope de 4 GB. Para fijarlo, un drop-in:

```ini /etc/systemd/journald.conf.d/limites.conf
[Journal]
SystemMaxUse=1G
MaxRetentionSec=3month
```

`sudo systemctl restart systemd-journald` para aplicarlo, y `sudo journalctl --vacuum-size=500M` para recortar ya.

## logrotate

Algunos programas escriben sus propios archivos de log en lugar del journal: Nginx, PostgreSQL, o un import nocturno que guarda su salida. Para esos está logrotate:

```text /etc/logrotate.d/facturacion
/var/log/facturacion/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 facturacion adm
    su facturacion adm
}
```

Rota cada día, guarda 14, comprime todos menos el más reciente (`delaycompress`, por si un proceso todavía escribe en él) y crea el archivo nuevo con los permisos indicados. `su` le dice con qué usuario operar en un directorio que no es de root.

```text Terminal · sudo logrotate -d /etc/logrotate.d/facturacion
rotating pattern: /var/log/facturacion/*.log  after 1 days (14 rotations)
empty log files are not rotated, old logs are removed
switching euid from 0 to 999 and egid from 0 to 4
considering log /var/log/facturacion/importaciones.log
```

`-d` simula sin tocar nada. logrotate corre con su propio timer, `logrotate.timer`, una vez por día.

> **Quedate con esto**
> Un timer de systemd reemplaza a cron con logs en el journal, sin solapamientos y con `Persistent=true` para lo que se perdió con el servidor apagado; se prueba con `systemctl start`. El journal se consulta por unidad, tiempo y prioridad, pero lo que una aplicación escribe por stdout es siempre prioridad 6: usá `--grep` o prefijos `<4>`. Limitá su tamaño con `SystemMaxUse`, y lo que escribe archivos propios, con logrotate.
