---
title: "El compose de producción, que no es el de desarrollo"
description: Qué cambia entre el compose con el que desarrollás y el que va a aguantar usuarios reales.
date: 2026-10-11
topic: ERP
tags: [odoo, docker, produccion]
goal: Un stack que arranca solo, se reinicia solo y no pierde datos.
course: odoo-produccion
section: despliegue
order: 1
---

El compose con el que desarrollás y el que corre en producción se parecen. Esa es exactamente la trampa: copiarlo tal cual funciona el primer día y falla el día que el servidor se reinicia a las tres de la mañana.

Esta lección es sobre las diferencias.

## El archivo

```yaml compose.yaml · producción
services:
  db:
    image: postgres:16.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: odoo
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      POSTGRES_DB: postgres
      PGDATA: /var/lib/postgresql/data/pgdata
    secrets:
      - db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U odoo"]
      interval: 10s
      timeout: 5s
      retries: 5

  odoo:
    image: odoo:19.0
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      HOST: db
      USER: odoo
      PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - odoo-data:/var/lib/odoo
      - ./config:/etc/odoo:ro
      - ./addons:/mnt/extra-addons:ro
    ports:
      - "127.0.0.1:8069:8069"
      - "127.0.0.1:8072:8072"

secrets:
  db_password:
    file: ./secrets/db_password.txt

volumes:
  pgdata:
  odoo-data:
```

Vamos por lo que cambió.

## `restart: unless-stopped`

Sin eso, **el servidor se reinicia y tu Odoo no vuelve**. Es la diferencia número uno entre un compose de desarrollo y uno de producción, y la que más despiertan a alguien de madrugada.

`unless-stopped` reinicia el contenedor salvo que vos lo hayas parado a mano. Es lo que querés: si te cae el proceso, vuelve; si lo frenaste para mantenimiento, no vuelve solo.

## El healthcheck y `depends_on: condition`

```yaml
depends_on:
  db:
    condition: service_healthy
```

Esto es lo segundo que más molesta. **`depends_on` a secas solo espera a que el contenedor arranque, no a que PostgreSQL esté listo para aceptar conexiones.**

En un arranque normal no se nota porque Odoo tarda más en levantar. Después de un reinicio del servidor, con todo arrancando a la vez, Odoo gana la carrera, no encuentra la base y muere. Con `restart: unless-stopped` reintenta hasta que funciona, así que tampoco te enterás — solo ves un arranque lento y unos errores feos en el log.

Con el healthcheck, el orden está garantizado.

## Puertos atados a localhost

```yaml
ports:
  - "127.0.0.1:8069:8069"
  - "127.0.0.1:8072:8072"
```

El `127.0.0.1:` adelante **es la parte importante**. Sin él, Docker abre el puerto en todas las interfaces y tu Odoo queda accesible desde internet directo, salteándose el Nginx.

Y lo que es peor: salteándose el HTTPS. Alguien entrando por `http://tu-servidor:8069` manda su contraseña en texto plano.

> **Docker y el firewall**
> Esto sorprende a mucha gente: **Docker escribe sus propias reglas de iptables y puede pasar por encima de las de `ufw`**. Un puerto publicado sin el `127.0.0.1:` puede quedar abierto aunque el firewall diga que no. Atar a localhost resuelve eso de raíz.

El 8072 es el de websockets, que vemos en la sección de Nginx.

## La versión fijada

```yaml
image: odoo:19.0        # no "odoo:latest"
image: postgres:16.4    # no "postgres:latest"
```

Con `latest`, un `docker compose pull` cualquier martes te sube de versión mayor sin avisar. Para Odoo eso significa una migración no planificada; para PostgreSQL, que la base no arranque porque el formato de datos cambió.

Fijá la versión y subila cuando vos decidas.

## Los volúmenes, y cuál duele perder

| Volumen | Qué guarda | Si lo perdés |
|---|---|---|
| `pgdata` | la base de datos | lo perdiste todo |
| `odoo-data` | el **filestore**: adjuntos, imágenes, logos | la base queda llena de referencias a archivos que no existen |

Acordate de la primera lección del curso de backend: **el filestore no está en PostgreSQL**. Es el error de backup más común y tiene su sección entera más adelante.

Los dos van como volúmenes con nombre, no como bind mounts: en Linux evita problemas de permisos y deja que Docker los gestione.

## Lo de solo lectura

```yaml
- ./config:/etc/odoo:ro
- ./addons:/mnt/extra-addons:ro
```

El `:ro` monta esas carpetas como solo lectura. Es higiene barata: **el proceso de Odoo no tiene por qué poder modificar su propia configuración ni su código**. Si algo lo intenta, falla en vez de tener éxito.

## `PGDATA` dentro de un subdirectorio

```yaml
PGDATA: /var/lib/postgresql/data/pgdata
```

Un detalle que ahorra un dolor de cabeza: PostgreSQL exige que su directorio de datos esté vacío al inicializar, y un volumen de Docker puede traer metadatos. Apuntando a un subdirectorio, el problema no aparece.

## Lo que no está

**No hay `--dev`.** Nada de recarga automática ni assets sin minificar.

**No hay puerto de PostgreSQL publicado.** La base solo se habla con Odoo por la red interna de Compose. Si necesitás entrar, es por un túnel SSH, no abriendo el 5432.

**No hay `workers: 0`.** Eso va en el `odoo.conf` y tiene su sección: en producción el número no es cero.

## Verificar antes de confiar

```bash Terminal · reiniciá el servidor a propósito
sudo reboot
# cuando vuelva:
docker compose ps
curl -I http://127.0.0.1:8069/web/login
```

**Hacé esa prueba el día que lo instalás**, no el día que se cae. Un stack que no vuelve solo después de un reinicio es un stack que vas a tener que levantar a mano a las tres de la mañana.

> **Quedate con esto**
> `restart: unless-stopped` y un healthcheck en la base con `condition: service_healthy` son lo que hace que el stack vuelva solo. Publicá los puertos con `127.0.0.1:` adelante, porque Docker puede pasar por encima de tu firewall. Fijá las versiones de las imágenes. Y probá un reinicio del servidor el primer día.
