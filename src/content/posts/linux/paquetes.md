---
title: "Paquetes: apt, dpkg, dnf y repositorios de terceros"
description: Instalar, consultar, fijar versiones y sumar repositorios con su clave. Lo que hace cada herramienta y la trampa del usr-merge en Ubuntu 24.04.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ubuntu, apt]
goal: Gestionar software con el gestor de paquetes, incluso desde repositorios de terceros, sin perder el control de las versiones.
course: linux-administracion
section: software
order: 1
---

En un servidor, casi todo se instala con el gestor de paquetes. No por comodidad: porque un paquete trae sus dependencias, se actualiza con parches de seguridad y se desinstala limpio. Un binario descargado a mano no tiene nada de eso.

## Dos niveles

| | Debian y Ubuntu | Red Hat y Rocky |
|---|---|---|
| Formato | `.deb` | `.rpm` |
| Bajo nivel: instala un archivo, no resuelve dependencias | `dpkg` | `rpm` |
| Alto nivel: repositorios y dependencias | `apt` | `dnf` |

En el día a día se usa el de alto nivel. El de bajo nivel sirve para **preguntar**: qué paquete trajo este archivo, qué archivos trae este paquete.

## Lo de todos los días

| Tarea | Ubuntu | Rocky |
|---|---|---|
| Actualizar la lista de paquetes | `sudo apt update` | Automático |
| Instalar | `sudo apt install nginx` | `sudo dnf install nginx` |
| Actualizar todo | `sudo apt upgrade` | `sudo dnf upgrade` |
| Quitar | `sudo apt remove nginx` | `sudo dnf remove nginx` |
| Quitar con su configuración | `sudo apt purge nginx` | — |
| Buscar | `apt search postgres` | `dnf search postgres` |
| Información | `apt show nginx` | `dnf info nginx` |
| Historial | `/var/log/apt/history.log` | `dnf history` |

`apt` es para personas, con colores y barras. En scripts se usa `apt-get`, cuya salida no cambia entre versiones.

### Simular antes

```text Terminal · apt-get install -s nginx
Inst nginx-common (1.24.0-2ubuntu7.18 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [all])
Inst nginx (1.24.0-2ubuntu7.18 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Conf nginx-common (1.24.0-2ubuntu7.18 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [all])
Conf nginx (1.24.0-2ubuntu7.18 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
```

`-s` muestra qué haría sin hacerlo. Antes de un `apt upgrade` en producción, o de instalar algo que arrastra muchas dependencias, es el primer paso.

## Preguntar

**¿Qué versión se va a instalar y de dónde?**

```text Terminal · apt-cache policy nginx
nginx:
  Installed: (none)
  Candidate: 1.24.0-2ubuntu7.18
  Version table:
     1.24.0-2ubuntu7.18 500
        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages
```

**¿Qué paquete trajo este archivo?** Acá aparece la trampa del *usr-merge*:

```text Terminal
$ dpkg -S /usr/bin/ss
dpkg-query: no path found matching pattern /usr/bin/ss
$ dpkg -S /bin/ss
iproute2: /bin/ss
```

En Ubuntu 24.04 `/bin` es un enlace a `/usr/bin`, pero muchos paquetes todavía registran sus archivos con el camino viejo. Si `dpkg -S` no encuentra algo en `/usr/bin`, probá con `/bin`. En Rocky es directo: `rpm -qf /usr/bin/ls`.

**¿Qué archivos trae un paquete?** `dpkg -L iproute2` o `rpm -ql iproute`. Para saber dónde dejó la configuración un paquete recién instalado, `dpkg -L nginx | grep etc` es más rápido que buscar documentación.

**¿Qué paquete instalo para tener este comando?** En Rocky, `dnf provides '*/bin/semanage'`. En Ubuntu, `apt-file search bin/semanage` después de `apt install apt-file && apt-file update`.

## Un paquete por dentro

Un `.deb` es un archivo `ar` con dos tarballs adentro:

```text Terminal
$ apt-get download tree
$ ar t tree_2.1.1-2ubuntu3.24.04.2_amd64.deb
debian-binary
control.tar.zst
data.tar.zst
$ dpkg-deb -f tree_*.deb Package Version Depends
Package: tree
Version: 2.1.1-2ubuntu3.24.04.2
Depends: libc6 (>= 2.38)
```

`control` tiene los metadatos y los scripts que corren al instalar; `data`, los archivos. `ar` viene en el paquete `binutils`, que no está en una instalación mínima; `dpkg-deb -c` lista el contenido sin él.

## Fijar una versión

Hay paquetes que no querés que se actualicen solos, como una base de datos en la que una versión mayor nueva implica una migración:

```text Terminal
$ sudo apt-mark hold postgresql-18
postgresql-18 set on hold.
$ apt-mark showhold
postgresql-18
$ sudo apt-mark unhold postgresql-18
Canceled hold on postgresql-18.
```

En Rocky, `sudo dnf install python3-dnf-plugin-versionlock` y después `sudo dnf versionlock add postgresql-server`.

## Repositorios de terceros

Ubuntu trae PostgreSQL 16. Si necesitás otra versión, el proyecto mantiene su propio repositorio, PGDG. Agregar un repositorio es agregar **una fuente y la clave con la que firma**.

Ubuntu 24.04 usa el formato *deb822* en `/etc/apt/sources.list.d/`:

```text Terminal · /etc/apt/sources.list.d/ubuntu.sources
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
```

El de PostgreSQL, igual:

```bash Terminal
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
sudo tee /etc/apt/sources.list.d/pgdg.sources <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
sudo apt update
```

**`Signed-By` limita la clave a ese repositorio.** El método viejo, `apt-key add`, la agregaba como confiable para *todos* los repositorios: una clave de terceros podía firmar un paquete que se hiciera pasar por uno de Ubuntu. Por eso `apt-key` está obsoleto: en 24.04 todavía existe, pero no lo uses para repositorios nuevos.

### Lo que un repositorio cambia

En el laboratorio, después de agregar PGDG, `apt install postgresql` instaló la versión **18** y no la 16 de Ubuntu: el metapaquete `postgresql` del repositorio nuevo tiene una versión más alta y apt elige la más alta. Un repositorio de terceros no suma solo lo que buscabas; puede cambiar lo que ya instalabas. Antes de instalar, `apt-cache policy paquete` dice de dónde va a venir.

Si querés solo una versión puntual, instalala por nombre, `postgresql-17`, y fijá las demás con prioridades en `/etc/apt/preferences.d/`.

## snap y flatpak

Son paquetes que traen todas sus dependencias adentro y se actualizan solos, en segundo plano. En un escritorio son cómodos. En un servidor, que se actualicen solos y cuando quieren es justo lo que no querés para la base de datos o el servidor web. Para servidores, el paquete de la distribución o el repositorio oficial del proyecto.

> **Quedate con esto**
> `apt` y `dnf` para instalar, `dpkg` y `rpm` para preguntar qué trajo cada paquete; en Ubuntu 24.04, si `dpkg -S` no encuentra un archivo en `/usr/bin`, probá en `/bin`. Simulá con `-s` antes de cambios grandes y fijá con `apt-mark hold` lo que no se tiene que mover solo. Un repositorio de terceros va con su clave en `Signed-By`, y antes de instalar mirá con `apt-cache policy` de dónde viene cada paquete.
