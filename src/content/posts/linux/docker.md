---
title: "Docker en producción"
description: "Instalar desde el repositorio oficial, una imagen multi-etapa sin root para la API, compose con PostgreSQL 18, y los detalles que en producción importan: logs, puertos, el grupo docker y el espacio en disco."
date: 2026-10-19
topic: Infraestructura
tags: [linux, docker, contenedores]
goal: Empaquetar y correr la API con Docker de forma segura en un servidor de producción.
course: linux-administracion
section: virtualizacion
order: 4
---

Con systemd, la API corre directo en el servidor. Con Docker, corre en una imagen que trae su Python y sus dependencias, y el servidor solo necesita Docker. Es la forma de que «en mi máquina anda» signifique lo mismo en producción.

## Instalar

El paquete `docker.io` de Ubuntu funciona, pero va atrasado. El repositorio oficial, con su clave, como cualquier [repositorio de terceros](/blog/linux/paquetes):

```bash Terminal
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

### El grupo docker es root

Para no escribir `sudo docker`, la documentación sugiere `usermod -aG docker ana`. Hay que saber lo que eso significa: quien puede hablar con Docker puede montar `/` del host dentro de un contenedor y hacer lo que quiera con él. **Estar en el grupo `docker` es tener root sin contraseña.** Dalo solo a quien ya tendría sudo completo.

## La imagen de la API

```dockerfile Dockerfile
FROM python:3.13-slim AS construccion
COPY --from=ghcr.io/astral-sh/uv:0.13.2 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim
RUN useradd --system --uid 10001 --no-create-home facturacion
COPY --from=construccion /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/salud')"]
CMD ["uvicorn", "facturacion.web:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Dos etapas.** La primera tiene uv y construye el entorno virtual; la segunda copia solo el `.venv`. uv, los cachés y el código fuente no llegan a la imagen final.

**El orden de las capas.** Primero se copian `pyproject.toml` y `uv.lock` y se instalan las dependencias; después el código. Docker reutiliza las capas que no cambiaron, así que un cambio en el código no reinstala las dependencias.

**`USER 10001`, numérico.** Sin `USER`, el proceso corre como root dentro del contenedor, y root adentro es root afuera si escapa, como viste en [contenedores por dentro](/blog/linux/contenedores-por-dentro). Que sea un número y no un nombre importa en Kubernetes: con `runAsNonRoot`, rechaza una imagen con `USER facturacion` porque no puede verificar que ese nombre no sea root. Pasó armando este curso, y está en [la lección de Kubernetes](/blog/linux/kubernetes-en-la-practica).

**`HEALTHCHECK`** contra `/salud`. Docker marca el contenedor como `healthy` o `unhealthy`, y compose puede esperar a que esté sano.

Un `.dockerignore` deja afuera lo que no tiene que entrar al contexto de construcción:

```text .dockerignore
.venv
__pycache__
.mypy_cache
.pytest_cache
tests
.git
```

```text Terminal
$ docker build -t facturacion:1.0 .
$ docker run --rm --entrypoint sh facturacion:1.0 -c id
uid=10001(facturacion) gid=999(facturacion) groups=999(facturacion)
```

## Con PostgreSQL, en compose

```yaml compose.yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: facturacion
      POSTGRES_PASSWORD: ${DB_CLAVE:?falta DB_CLAVE}
      POSTGRES_DB: facturacion
    volumes:
      - datos:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U facturacion -d facturacion"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  api:
    build: .
    image: facturacion:1.0
    environment:
      DATABASE_URL: postgresql+psycopg://facturacion:${DB_CLAVE}@db/facturacion
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:8000:8000"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped

volumes:
  datos:
```

**`${DB_CLAVE:?falta DB_CLAVE}`** viene de un archivo `.env` al lado del compose, o del entorno, y si falta, compose se niega a arrancar. El `.env` no va al repositorio.

**El volumen de PostgreSQL 18** se monta en `/var/lib/postgresql`, no en `/var/lib/postgresql/data` como en las versiones anteriores de la imagen:

```text Terminal
$ docker exec curso-lab-db-1 sh -c 'echo $PGDATA'
/var/lib/postgresql/18/docker
```

Las guías viejas montan el volumen en `.../data`; con la imagen 18, los datos quedarían fuera del volumen y se perderían al recrear el contenedor.

**`depends_on` con `service_healthy`**: la API arranca cuando la base responde, no cuando el contenedor de la base existe.

**`127.0.0.1:8000:8000`**: el puerto se publica solo en el host. Un puerto publicado sin IP queda abierto a Internet **aunque ufw diga que está cerrado**, porque Docker desvía el tráfico antes, como viste en [firewall](/blog/linux/firewall). Nginx, en el host, recibe el tráfico público y se lo pasa.

**`read_only`, `cap_drop: [ALL]` y `no-new-privileges`** son el equivalente al endurecimiento de systemd:

```text Terminal
$ docker exec curso-lab-api-1 touch /app/x
touch: cannot touch '/app/x': Read-only file system
$ docker exec curso-lab-api-1 grep -E '^Cap(Eff|Bnd)' /proc/1/status
CapEff:	0000000000000000
CapBnd:	0000000000000000
```

```text Terminal · docker compose ps
api Up 14 seconds (healthy)
db Up 19 seconds (healthy)
```

```text Terminal
$ curl -s localhost:8000/salud
{"estado":"ok"}
```

## Lo que en producción muerde

### Los logs sin rotación

```text Terminal · docker inspect curso-lab-api-1 --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'
json-file map[]
```

`json-file` sin opciones significa **sin límite**: el log de cada contenedor crece hasta llenar el disco. En `/etc/docker/daemon.json`:

```json /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

`sudo systemctl restart docker`, y vale para los contenedores que se creen después; los existentes hay que recrearlos. La alternativa es `"log-driver": "journald"`, y los logs de los contenedores van al journal con todo lo demás.

### El espacio

```text Terminal · docker system df
Images 2.966GB 0B (0%)
Containers 1.375GB 1.122MB (0%)
Local Volumes 147.3MB 0B (0%)
Build Cache 2.088GB 364.1MB
```

Imágenes viejas y caché de construcción se acumulan en cada despliegue. `docker image prune -a --filter "until=168h"` borra las que no usa ningún contenedor desde hace una semana, y conviene programarlo. **`docker system prune --volumes` borra los volúmenes sin usar**, y un volumen de base de datos de un contenedor parado es un volumen sin usar.

### Actualizar

```bash Terminal
docker compose pull          # imágenes nuevas, si vienen de un registro
docker compose build         # o construir la propia
docker compose up -d         # recrea solo lo que cambió
```

Y las imágenes base también tienen parches de seguridad: reconstruir periódicamente aunque tu código no cambie, para que `python:3.13-slim` traiga sus parches.

## systemd o Docker

| | systemd directo | Docker |
|---|---|---|
| Dependencias | Las del sistema más el venv | Todo dentro de la imagen |
| Mismo artefacto en desarrollo y producción | No | Sí |
| Varias apps con versiones de Python distintas | Incómodo | Natural |
| Capas extra que entender | Ninguna | Red, volúmenes, el demonio |
| Camino a Kubernetes | No | Directo |

Para un servidor con una aplicación, systemd alcanza y es más simple. Docker paga cuando hay varias aplicaciones, equipos que despliegan solos, o el destino es [Kubernetes](/blog/linux/kubernetes-conceptos).

> **Quedate con esto**
> Docker del repositorio oficial, y el grupo `docker` solo para quien ya tendría root. Imagen multi-etapa, dependencias antes que el código, `USER` numérico y `HEALTHCHECK`. En compose: secretos desde `.env`, la base esperada con `service_healthy`, puertos en `127.0.0.1`, contenedor de solo lectura y sin capabilities. PostgreSQL 18 se monta en `/var/lib/postgresql`. Y dos cosas que llenan el disco: logs sin `max-size` e imágenes sin podar.
