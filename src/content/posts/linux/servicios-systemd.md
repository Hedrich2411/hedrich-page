---
title: "Un servicio de systemd para la API"
description: Usuario propio, archivo de entorno con secretos, reinicio automático y endurecimiento con medición. La API de facturación como servicio de producción.
date: 2026-10-19
topic: Infraestructura
tags: [linux, systemd]
goal: Convertir una aplicación en un servicio que arranca solo, se recupera de caídas y corre con el mínimo de privilegios.
course: linux-administracion
section: procesos
order: 3
---

La API de facturación es un proceso de uvicorn que escucha en el puerto 8000. Que corra en una terminal no la hace un servicio. Un servicio **arranca cuando arranca el servidor, vuelve a levantarse si se cae, corre con su propio usuario y deja sus logs en un lugar que se puede consultar**. Eso lo da systemd.

## Antes de la unidad

El usuario de servicio, de [usuarios y grupos](/blog/linux/usuarios-y-grupos), el código en `/srv/facturacion/app` con sus dependencias instaladas, y PostgreSQL con su base:

```bash Terminal
sudo apt install postgresql
sudo -u postgres psql -c "CREATE ROLE facturacion LOGIN PASSWORD 'una-clave-larga'"
sudo -u postgres createdb -O facturacion facturacion
cd /srv/facturacion/app && sudo -u facturacion uv sync --no-dev --frozen
```

Los secretos van en un archivo aparte, legible solo por root y el grupo del servicio:

```bash Terminal
sudo install -d -m 0750 -o root -g facturacion /etc/facturacion
sudoedit /etc/facturacion/entorno
sudo chown root:facturacion /etc/facturacion/entorno
sudo chmod 0640 /etc/facturacion/entorno
```

```text /etc/facturacion/entorno
DATABASE_URL=postgresql+psycopg://facturacion:una-clave-larga@127.0.0.1/facturacion
PSE_URL=https://pse.example.pe/api
PSE_TOKEN=...
```

¿Por qué no `Environment=` dentro de la unidad? Porque los archivos de unidad son legibles por cualquier usuario del sistema, y `systemctl show` muestra su contenido. El `EnvironmentFile` tiene sus propios permisos.

## La unidad

```ini /etc/systemd/system/facturacion.service
[Unit]
Description=API de facturación
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=exec
User=facturacion
Group=facturacion
WorkingDirectory=/srv/facturacion/app
EnvironmentFile=/etc/facturacion/entorno
ExecStart=/srv/facturacion/app/.venv/bin/uvicorn facturacion.web:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
```

**`[Unit]`.** `After=` ordena, no obliga: si PostgreSQL arranca, la API arranca después. `Wants=` sí pide que la otra unidad arranque. `network-online.target` espera a que la red esté configurada de verdad, no solo a que exista.

**`Type=exec`.** systemd considera arrancado el servicio cuando el programa se ejecutó. Para un proceso que se queda en primer plano, como uvicorn, es lo correcto. `Type=forking` es para los demonios viejos que se van al fondo solos.

**`--host 127.0.0.1`.** La API no escucha hacia afuera; Nginx, delante, sí. Lo vas a ver en [TCP/IP](/blog/linux/tcp-ip).

**`Restart=on-failure`.** Si el proceso termina con error o por una señal, systemd lo vuelve a levantar a los 5 segundos. No lo hace si lo paraste vos con `systemctl stop`.

Rutas absolutas en `ExecStart`, siempre: la unidad no tiene tu `PATH`.

## Validar, activar, mirar

```bash Terminal
sudo systemd-analyze verify /etc/systemd/system/facturacion.service
sudo systemctl daemon-reload
sudo systemctl enable --now facturacion
```

`daemon-reload` le avisa a systemd que hay archivos nuevos o cambiados; sin eso, sigue usando la versión anterior. `enable` hace que arranque con el servidor, y `--now` además lo arranca ya.

```text Terminal · systemctl status facturacion
● facturacion.service - API de facturación
     Loaded: loaded (/etc/systemd/system/facturacion.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-10-19 21:45:06 UTC; 3s ago
   Main PID: 4138 (uvicorn)
      Tasks: 5 (limit: 19072)
     Memory: 70.1M (peak: 70.7M)
        CPU: 832ms
     CGroup: /system.slice/facturacion.service
             └─4138 /srv/facturacion/app/.venv/bin/python /srv/facturacion/app/.venv/bin/uvicorn facturacion.web:app --host 127.0.0.1 --port 8000
```

`Loaded` dice si arranca con el sistema (`enabled`), `Active` si está corriendo ahora, y las últimas líneas del log aparecen abajo. Una emisión real contra la API ya deja su rastro:

```text Terminal · journalctl -u facturacion -n 2 -o cat
{"momento": "2026-10-19T21:45:19+0000", "nivel": "INFO", "origen": "facturacion.aplicacion.emitir", "operacion": "prueba-1", "mensaje": "F001-1 emitido por S/ 2360.00", "comprobante": "F001-1", "total": "2360.00"}
INFO:     127.0.0.1:59870 - "POST /comprobantes HTTP/1.1" 201 Created
```

## Que se recupere sola

Un `kill -9` simula una caída:

```text Terminal · journalctl -u facturacion
facturacion.service: Main process exited, code=killed, status=9/KILL
facturacion.service: Failed with result 'signal'.
facturacion.service: Scheduled restart job, restart counter is at 1.
Started facturacion.service - API de facturación.
```

```text Terminal · systemctl show -p NRestarts facturacion
NRestarts=1
```

Si el servicio se cae en bucle, systemd deja de intentar después de 5 arranques en 10 segundos (`StartLimitBurst` y `StartLimitIntervalSec`) y lo marca como fallido, para que no consuma la máquina reintentando. `NRestarts` subiendo en un monitoreo es una alerta temprana.

## Endurecer, y medirlo

Las líneas después de `RestartSec` restringen lo que el proceso puede hacer aunque alguien lo comprometa:

| Directiva | Efecto |
|---|---|
| `ProtectSystem=strict` | Todo el sistema de archivos en solo lectura para el servicio |
| `ProtectHome=yes` | `/home` y `/root` invisibles |
| `PrivateTmp=yes` | Un `/tmp` propio, no compartido |
| `NoNewPrivileges=yes` | Ni setuid ni sudo pueden darle más permisos |
| `CapabilityBoundingSet=` | Ninguna capability de root, ni siquiera heredada |
| `RestrictAddressFamilies=` | Solo puede abrir sockets IP y Unix |

`ProtectSystem=strict` se prueba en un segundo:

```text Terminal
$ sudo systemd-run --wait --pipe -p User=facturacion -p ProtectSystem=strict touch /srv/facturacion/prueba
/usr/bin/touch: cannot touch '/srv/facturacion/prueba': Read-only file system
```

Si la aplicación necesita escribir en un directorio, se habilita ese solo: `ReadWritePaths=/srv/facturacion/datos`.

Y systemd mide el resultado:

```text Terminal
$ systemd-analyze security facturacion
→ Overall exposure level for facturacion.service: 4.3 OK :-)
$ systemd-analyze security postgresql@18-main
→ Overall exposure level for postgresql@18-main.service: 9.6 UNSAFE :-{
```

Sin ninguna directiva, un servicio puntúa cerca de 9.6. La lista completa de `systemd-analyze security facturacion` muestra cada mejora posible con su peso; `ProtectClock=`, `SystemCallArchitectures=native` o `MemoryDenyWriteExecute=` bajan el número un poco más. Esta última rompe programas que generan código en memoria, como algunos JIT, así que agregá de a una y probá.

Todo esto usa los mismos mecanismos que los contenedores, *namespaces*, que vas a ver en [contenedores por dentro](/blog/linux/contenedores-por-dentro).

## Cambiar algo sin tocar la unidad

Para una unidad que vino con un paquete, como la de PostgreSQL, no se edita el archivo de `/usr/lib/systemd/system/`: lo pisaría la próxima actualización. Se crea un *override*:

```bash Terminal
sudo systemctl edit postgresql@18-main
```

Abre un archivo en `/etc/systemd/system/postgresql@18-main.service.d/override.conf` donde ponés solo lo que cambia. `systemctl cat` muestra la unidad original con los overrides aplicados, y `systemctl revert` los borra.

> **Quedate con esto**
> Un servicio de verdad tiene usuario propio, secretos en un `EnvironmentFile` con permisos `640`, `Restart=on-failure` y escucha en `127.0.0.1` si hay un proxy delante. Validá con `systemd-analyze verify`, `daemon-reload` después de cada cambio y `enable --now` para activarlo. Endurecé con `ProtectSystem=strict` y compañía, y medilo con `systemd-analyze security`. Las unidades de los paquetes se cambian con `systemctl edit`, nunca en su archivo.
