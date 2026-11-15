---
title: "Variables, secretos y el odoo.conf"
description: Dónde va cada cosa - lo que cambia por entorno, lo que es secreto y lo que puede ir versionado.
date: 2026-10-11
topic: ERP
tags: [odoo, docker, seguridad]
goal: La configuración fuera de la imagen y las contraseñas fuera del repositorio.
course: odoo-produccion
section: despliegue
order: 2
---

Hay tres clases de configuración y mezclarlas es lo que termina con una contraseña de producción en el historial de Git.

| Clase | Ejemplo | Dónde va |
|---|---|---|
| Igual en todos lados | `workers`, `limit_time_cpu` | el `odoo.conf`, versionado |
| Cambia por entorno | `db_host`, `dbfilter` | variables o un conf por entorno |
| Secreta | contraseñas, `admin_passwd` | un gestor de secretos, **nunca** versionado |

## El `odoo.conf` de producción

```ini config/odoo.conf
[options]
addons_path = /mnt/extra-addons
data_dir = /var/lib/odoo

; seguridad — su propia sección más adelante
list_db = False
dbfilter = ^taller$
proxy_mode = True

; rendimiento — su propia sección
workers = 5
max_cron_threads = 2
limit_memory_soft = 2147483648
limit_memory_hard = 2684354560
limit_time_cpu = 60
limit_time_real = 120
limit_request = 65536

; red
http_port = 8069
gevent_port = 8072

; registro
log_level = info
logfile = None
```

Fijate que **no hay contraseñas**. `db_password` y `admin_passwd` no están.

**`logfile = None` es deliberado en Docker**: hace que Odoo escriba al log del contenedor, que es lo que lee `docker compose logs` y lo que recoge cualquier agregador. Si lo mandás a un archivo dentro del contenedor, ese archivo no lo ve nadie y crece hasta llenar el disco.

Así, este archivo **se puede versionar**. Y conviene: la configuración de producción merece revisión e historial igual que el código.

## Las credenciales de la base

La imagen oficial lee tres variables:

```yaml
environment:
  HOST: db
  USER: odoo
  PASSWORD_FILE: /run/secrets/db_password
```

**`PASSWORD_FILE` en vez de `PASSWORD`** es la diferencia que importa.

Con `PASSWORD`, la contraseña queda en el `compose.yaml` —que seguramente versionás—, visible en `docker inspect`, en la lista de procesos y en los logs de cualquier herramienta que imprima el entorno.

Con `PASSWORD_FILE`, Docker monta el secreto como un archivo dentro del contenedor y la imagen lo lee de ahí.

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

```text .gitignore
secrets/
*.key
*.pem
```

Ese `.gitignore` va **antes** de crear la carpeta, no después. Un secreto que entró al historial de Git sigue ahí aunque borres el archivo.

## El `admin_passwd`

Es la contraseña maestra del gestor de bases de datos. **No es la del usuario admin** — eso lo vimos en el curso de backend.

Odoo la acepta hasheada, y así es como conviene guardarla:

```text config/odoo.conf
admin_passwd = $pbkdf2-sha512$600000$...
```

La forma de obtener el hash es ponerla en claro una vez, entrar al gestor de bases, cambiarla desde ahí, y Odoo reescribe el archivo con el hash. A partir de ese momento el valor en claro no está en ningún lado.

Y en la sección de hardening vamos a ver que, con el gestor cerrado, esta contraseña casi no se usa — que es exactamente donde querés que esté.

## Qué nunca va al repositorio

- Contraseñas de base de datos.
- `admin_passwd`, ni siquiera hasheada.
- Credenciales SMTP. Las de Zoho, Gmail o quien sea.
- API keys de servicios externos.
- Certificados y claves privadas.
- Dumps de producción. Tienen datos de clientes.

Ese último se olvida seguido: alguien baja un backup para depurar algo y lo deja en la carpeta del proyecto.

## Rotar una contraseña

El procedimiento para cambiar la de PostgreSQL sin dejar el servicio caído:

```bash Terminal
# 1. cambiarla en PostgreSQL
docker compose exec db psql -U odoo -c "ALTER USER odoo WITH PASSWORD 'la-nueva';"

# 2. actualizar el secreto
echo -n "la-nueva" > secrets/db_password.txt

# 3. recrear solo Odoo
docker compose up -d --force-recreate odoo
```

Dos detalles:

**`echo -n`**, sin el salto de línea. Un `\n` al final de la contraseña es un fallo de autenticación que cuesta diagnosticar porque el archivo «se ve bien».

**Solo se recrea `odoo`**, no la base. La base ya tiene la contraseña nueva del paso 1.

Para las de SMTP y las API keys es más simple: se cambian desde la interfaz de Odoo y quedan en la base.

## Varios entornos

```text
├── compose.yaml              lo común
├── compose.prod.yaml         lo de producción
├── compose.staging.yaml      lo de staging
├── config/
│   ├── odoo.conf
│   └── odoo.staging.conf
└── secrets/                  ignorado por git
```

```bash Terminal
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

Compose combina los archivos, y el segundo pisa al primero. Así lo común no se duplica y cada entorno declara solo lo suyo.

Vas a necesitar staging sí o sí: la sección de actualizaciones depende de tener un lugar donde probar antes.

## La prueba de que está bien

Preguntate: **¿puedo publicar este repositorio ahora mismo?**

Si la respuesta es no, hay algo mal ubicado. Un repositorio de despliegue bien armado se puede hacer público sin consecuencias, porque lo único que falta para que funcione son los secretos, y esos no están.

> **Quedate con esto**
> `PASSWORD_FILE` en vez de `PASSWORD`: con la segunda, la contraseña queda visible en `docker inspect` y en el compose versionado. El `.gitignore` de `secrets/` va antes de crear la carpeta, porque lo que entró al historial se queda. `logfile = None` en Docker, para que los logs salgan al contenedor. Y la prueba es simple: si no podés hacer público el repositorio, algo está donde no va.
