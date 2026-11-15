---
title: "Instalación nativa: Linux, macOS y Windows"
description: Instalar Odoo desde el fuente en cada sistema, con las trampas concretas de cada uno. Leé solo la sección de tu máquina.
date: 2026-10-10
topic: ERP
tags: [odoo, linux, macos, windows]
goal: Odoo corriendo desde el código fuente en tu máquina, por el camino de tu sistema operativo.
course: odoo-backend-framework
section: entorno
order: 3
---

Esta lección es material de referencia: **leé la sección de tu sistema y saltate las otras dos**.

## ¿Para qué, si ya tenés Docker?

Pregunta válida, y la respuesta es una sola: para tener **el código fuente de Odoo en tu máquina**.

El 80% de aprender Odoo es leer cómo lo resolvió Odoo. Cuando no sepas cómo se hace algo, la respuesta está en los módulos estándar, y querés poder abrirlos en tu editor, buscar entre ellos con el buscador del proyecto y pararte con el debugger dentro de un método del core para ver qué recibe de verdad.

Eso se puede hacer con Docker montando el fuente, pero es más incómodo. Si vas en serio con Odoo, en algún momento vas a querer el árbol completo clonado.

Si por ahora solo querés seguir el curso: **quedate con Docker y volvé a esta lección cuando la necesites.** No te estás perdiendo nada.

## Linux (Ubuntu / Debian)

Es el camino de referencia. Odoo se desarrolla, se prueba y se despliega sobre Ubuntu, así que es donde menos problemas vas a tener y donde más respuestas vas a encontrar cuando busques un error.

### Las dependencias de sistema

Estas van **antes** de instalar las dependencias de Python. Varias de esas librerías se compilan contra ellas, y si faltan, la instalación falla con un error de compilador que no dice nada útil.

```bash Terminal · Dependencias de compilación
sudo apt update
sudo apt install -y build-essential python3-dev python3-venv \
  libxml2-dev libxslt1-dev libzip-dev libldap2-dev libsasl2-dev \
  libssl-dev libffi-dev libjpeg-dev zlib1g-dev libpq-dev git
```

Para que las tengas ubicadas: `libxml2-dev` y `libxslt1-dev` son para `lxml`, que es con lo que Odoo procesa todo el XML; `libpq-dev` es para `psycopg2`; `libldap2-dev` y `libsasl2-dev` para `python-ldap`, que vuelve a aparecer en la sección de Windows como protagonista.

### wkhtmltopdf

```bash Terminal · La versión que Odoo necesita
wget https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6.1-2/wkhtmltox_0.12.6.1-2.jammy_amd64.deb
sudo dpkg -i wkhtmltox_0.12.6.1-2.jammy_amd64.deb
sudo apt install -f -y
```

**No lo instales con `apt install wkhtmltopdf`.** La versión de los repositorios está compilada sin el parche de Qt, y ya sabés cómo se manifiesta eso: los PDFs salen sin encabezado ni pie, sin un solo error en el log.

### PostgreSQL

```bash Terminal · El rol de Odoo
sudo apt install -y postgresql
sudo -u postgres createuser --createdb --pwprompt odoo
```

`--createdb` es el permiso que Odoo necesita y `--pwprompt` te pide la contraseña. Vas a encontrar guías que usan `--superuser`: funciona, y es darle mucho más de lo que necesita.

Un atajo cómodo para desarrollo: si en vez de `odoo` creás el rol con **tu propio nombre de usuario del sistema**, la conexión local funciona sin contraseña, por lo que vimos de `psycopg2`.

### El fuente

```bash Terminal · Clonar solo lo necesario
mkdir -p ~/odoo-dev && cd ~/odoo-dev
git clone -b 19.0 --single-branch --depth 1 https://github.com/odoo/odoo.git
```

`--single-branch --depth 1` baja solo la rama 19.0 y sin historial. El repositorio de Odoo es enorme; clonarlo entero tarda muchísimo y no vas a necesitar los commits de 2012. Si más adelante querés el historial, `git fetch --unshallow` lo trae.

### El entorno de Python, con uv

Podés hacerlo con `python3 -m venv` y `pip` como toda la vida. Pero para Odoo conviene **`uv`**, y no es por moda: el `requirements.txt` de Odoo tiene unas cuarenta dependencias, varias pesadas, y `uv` resuelve e instala todo en segundos donde `pip` tarda minutos. Vas a recrear ese entorno más veces de las que creés.

El otro motivo pesa más todavía: **`uv` también gestiona la versión de Python**. Odoo 19 pide 3.10 o superior, y el Python que trae tu distribución puede no ser el que querés. Con `uv` no dependés de eso.

```bash Terminal · Instalar uv
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```bash Terminal · Entorno y dependencias
cd ~/odoo-dev/odoo
uv python install 3.12
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
```

Y ya que estamos, agregá el paquete que hace andar la recarga automática:

```bash Terminal · Para que --dev=reload funcione
uv pip install watchdog
```

> **No te fíes de ninguna tabla de versiones, ni de esta**
> La versión mínima de Python sube con cada release de Odoo, y los libros y tutoriales suelen quedar atrasados. El dato real está en el fuente que acabás de clonar: mirá `python_requires` en el `setup.py` del repositorio. Esa es la única fuente que no miente.

Es el paquete que hace andar la recarga automática. Lo vimos en la lección de Docker: sin él, `--dev=reload` no recarga nada y tampoco te avisa.

### Arrancar

```bash Terminal · Primera instancia
cd ~/odoo-dev/odoo
createdb taller
./odoo-bin -d taller -i base \
  --addons-path=addons \
  --db-filter='taller$' \
  --dev=all
```

A `http://localhost:8069`, usuario `admin`, contraseña `admin`.

El `--db-filter` con el `$` al final importa: limita qué bases puede servir esta instancia. Sin el `$`, la expresión regular hace match parcial y `taller` también seleccionaría `taller_viejo`.

## macOS

Se puede, y vas a pelear con dos cosas: las librerías que compilan contra PostgreSQL y los PDFs.

```bash Terminal · Base con Homebrew
brew install uv postgresql@16 libpq libxml2 libxslt
brew services start postgresql@16
createuser --createdb --pwprompt odoo
```

Fijate que no instalamos Python con Homebrew: de eso se encarga `uv`, igual que en Linux.

```bash Terminal · Fuente y entorno de Python
mkdir -p ~/odoo-dev && cd ~/odoo-dev
git clone -b 19.0 --single-branch --depth 1 https://github.com/odoo/odoo.git

cd odoo
uv python install 3.12
uv venv --python 3.12
source .venv/bin/activate
```

### `psycopg2` no compila

Es el error número uno de Odoo en macOS. Homebrew instala `libpq` «keg-only», o sea fuera de las rutas donde el compilador busca por defecto, así que el compilador no lo encuentra.

Tenés dos salidas. La corta:

```bash Terminal · Evitar la compilación
uv pip install psycopg2-binary
uv pip install -r requirements.txt
```

`psycopg2-binary` trae las librerías ya compiladas. Para desarrollar está perfecto.

La larga, si preferís compilar de verdad, es ponerle `pg_config` en el PATH antes de instalar:

```bash Terminal · Compilar contra libpq de Homebrew
export PATH="$(brew --prefix libpq)/bin:$PATH"
export LDFLAGS="-L$(brew --prefix libpq)/lib"
export CPPFLAGS="-I$(brew --prefix libpq)/include"
uv pip install -r requirements.txt
```

En Apple Silicon, Homebrew vive en `/opt/homebrew` y no en `/usr/local`. Por eso los comandos usan `brew --prefix` en vez de rutas fijas: así funcionan en ambos.

### wkhtmltopdf: acá no hay solución limpia

El proyecto wkhtmltopdf **está discontinuado** y ya no publica builds mantenidas para las versiones recientes de macOS. Es un problema real y no hay una respuesta cómoda.

Lo más sensato es separar las aguas: **desarrollá nativo y generá los PDFs en un contenedor**. O, directamente, usá Docker para todo cuando te toque trabajar en los reportes del capítulo correspondiente.

Mientras no toques reportes, Odoo funciona perfectamente sin wkhtmltopdf instalado. Lo único que no vas a poder hacer es imprimir.

> **Verificá esto antes de pelearla**
> El estado de wkhtmltopdf en macOS es lo que más cambia de esta lección. Antes de dar por perdida una tarde, fijate si apareció alguna build nueva o un reemplazo oficial.

## Windows

La recomendación honesta es: **no instales Odoo desde el fuente en Windows nativo.**

No es un prejuicio. `python-ldap`, que está en las dependencias de Odoo, necesita compilador de C y las cabeceras de OpenLDAP, que en Windows no existen en forma utilizable. Es una pelea que no deja nada aprendido.

Tenés dos caminos buenos.

### WSL2 — el recomendado

Windows Subsystem for Linux te da un Ubuntu real sobre Windows. A partir de ahí, **seguís la sección de Linux tal cual** y heredás todo su ecosistema de respuestas.

```powershell PowerShell (como administrador)
wsl --install -d Ubuntu-24.04
```

Dos trampas que te van a costar una tarde si no las sabés:

**Guardá el código dentro del sistema de archivos de Linux.** O sea en `~/odoo-dev`, nunca en `/mnt/c/Users/...`. Cruzar la frontera entre Windows y Linux en cada lectura de archivo es lentísimo, y encima **el watcher de archivos no funciona confiablemente sobre `/mnt/c`** — con lo cual `--dev=reload` deja de recargar y vos sin entender por qué, otra vez.

Si querés editar con VS Code desde Windows, instalá la extensión **WSL**: el editor corre en Windows pero los archivos quedan del lado de Linux, que es exactamente lo que querés.

**Clonalo desde dentro de WSL.** Si clonás con el Git de Windows, te va a convertir los finales de línea a CRLF y `odoo-bin` no va a arrancar dentro de Linux, con un error que no menciona para nada los finales de línea. Si ya te pasó:

```bash Terminal · Arreglar los finales de línea
git config --global core.autocrlf input
```

### El instalador oficial

Odoo publica un `.exe` para Windows que instala todo, PostgreSQL incluido.

Sirve para ver Odoo funcionando y para mostrárselo a alguien. **No sirve para desarrollar**: no te deja el fuente en un estado cómodo para leer ni para modificar, y vas a estar peleando con rutas y servicios en vez de escribiendo módulos.

## Cuál elegir

| Tu situación | Lo que conviene |
|---|---|
| Querés seguir el curso y ya | Docker, la lección anterior |
| Vas en serio con Odoo | Linux nativo, o WSL2 si estás en Windows |
| Estás en macOS | Nativo para el código, Docker para los PDFs |
| Estás en Windows | WSL2, y clonando dentro de Linux |

> **Quedate con esto**
> La razón para instalar nativo es tener el fuente de Odoo abierto en tu editor y poder pararte con el debugger dentro del core. Si no necesitás eso todavía, Docker te da exactamente lo mismo con menos fricción — y las dos opciones conviven: muchos desarrolladores tienen el fuente clonado para leerlo y levantan la instancia en contenedores.
