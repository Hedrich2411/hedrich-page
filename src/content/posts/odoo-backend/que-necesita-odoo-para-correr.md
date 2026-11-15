---
title: "Qué necesita Odoo para correr"
description: PostgreSQL, Python, wkhtmltopdf, el addons_path y el odoo.conf. Las cinco piezas que hay debajo de cualquier guía de instalación.
date: 2026-10-10
topic: ERP
tags: [odoo, postgresql, python]
goal: Entender las cinco piezas que toda instalación necesita, para que cualquier guía deje de ser magia.
course: odoo-backend-framework
section: entorno
order: 1
---

Hay cientos de guías para instalar Odoo y casi todas son una lista de comandos para copiar. Funcionan hasta que algo falla, y entonces no tenés idea de qué se rompió porque nunca supiste qué estabas instalando.

Esta lección no instala nada. Explica las cinco piezas que hay debajo. Con eso, las dos lecciones que siguen —Docker e instalación nativa— dejan de ser recetas y pasan a ser dos formas de armar lo mismo.

## Odoo, en una frase

**Odoo es un proceso de Python que escucha HTTP en el puerto 8069 y guarda todo en PostgreSQL.**

Eso es todo. No hay un servidor de aplicaciones aparte, ni un runtime especial, ni un servicio de fondo que haya que registrar. Arrancás `odoo-bin`, queda corriendo, y le pegás con el navegador.

Instalar Odoo es darle esas dos cosas —un Python con sus dependencias y una base de datos— y decirle dónde está tu código.

## 1 · PostgreSQL, con un rol que pueda crear bases

Acá está la diferencia con casi cualquier otra aplicación que hayas instalado: **Odoo no usa una base de datos, usa varias, y las crea él solo**.

Una instancia de Odoo puede servir muchas bases independientes, y la interfaz tiene un gestor para crearlas, duplicarlas y borrarlas. Por eso no alcanza con darle acceso a una base existente: el rol de PostgreSQL necesita permiso para **crear** bases.

```sql psql · El permiso que Odoo realmente necesita
CREATE ROLE odoo WITH LOGIN CREATEDB PASSWORD 'lo-que-sea';
```

Vas a ver muchas guías que crean el rol como `SUPERUSER`. En tu máquina de desarrollo da lo mismo. En un servidor es regalar la base entera: si alguien encuentra un agujero en cualquier módulo instalado, un rol superusuario le deja hacer lo que quiera con todo el PostgreSQL, no solo con las bases de Odoo. `CREATEDB` alcanza y sobra.

### Por qué algunas guías no configuran contraseña

Odoo se conecta con `psycopg2`, y `psycopg2` sin configurar hace tres cosas por defecto:

- se conecta con **el mismo nombre de usuario del sistema operativo**,
- por **socket Unix**, no por TCP,
- al **puerto 5432**.

Por eso las guías de Linux crean un rol que se llama igual que tu usuario: así la conexión local no pide contraseña y «funciona sin configurar nada». Es cómodo para desarrollar y no sirve para nada apenas la base esté en otro host, donde vas a tener que pasarle `db_host`, `db_user` y `db_password` explícitos.

## 2 · Un Python aislado, con las versiones exactas

Odoo trae un `requirements.txt` con sus dependencias fijadas. No es decorativo: Odoo es sensible a las versiones de sus librerías, y una menor de diferencia en `lxml` o en `psycopg2` se manifiesta como un error que no vas a poder buscar en Google.

Eso significa que **el Python de tu sistema no es el Python de Odoo**. Lo aislás con un entorno virtual o con un contenedor; el mecanismo da igual, lo que importa es que esté separado.

De acá sale una regla que te va a ahorrar un día entero más adelante: **desarrollá en el mismo entorno que producción**. Misma versión de Python, mismas versiones de las librerías. Descubrir el día del despliegue que una dependencia se comporta distinto es una de esas tardes que no se olvidan.

## 3 · wkhtmltopdf, la pieza frágil

Odoo no tiene motor de PDF propio. Cuando imprimís una factura o una orden de trabajo, lo que pasa es esto:

**plantilla QWeb → HTML → wkhtmltopdf → PDF**

Es un binario externo que recibe HTML y devuelve un PDF. Y es, por lejos, la parte más frágil de toda la instalación, por tres razones:

**Necesita una versión específica.** Odoo 19 espera `wkhtmltopdf 0.12.6.1`. La que viene en los repositorios de la mayoría de las distribuciones está compilada sin el parche de Qt que Odoo necesita, y el síntoma es desconcertante: el PDF **sí** se genera, pero **sin encabezado ni pie de página**. Ni un error, ni un log. Simplemente el membrete de la empresa no aparece y vos no sabés por qué. Por eso siempre se instala desde los paquetes del proyecto y no con el gestor de la distro.

**El proyecto está discontinuado.** Dejó de desarrollarse, lo que explica por qué en macOS reciente ya no hay una build oficial mantenida y por qué en Windows es un dolor de cabeza aparte.

**Es opcional para arrancar.** Y esto es lo tranquilizador: si no lo instalás, Odoo levanta igual y todo funciona, salvo los reportes PDF. Es la única de las cinco piezas que podés dejar para después sin bloquearte.

## 4 · El `addons_path`, o cómo Odoo encuentra tu código

Odoo no escanea tu proyecto buscando módulos. Lee **una lista de directorios separados por comas**, y nada más.

La estructura que espera es siempre la misma: cada directorio de la lista contiene subdirectorios, y cada subdirectorio es un módulo.

```ini odoo.conf · Dos directorios de Odoo y uno tuyo
addons_path = /opt/odoo/odoo/addons,/opt/odoo/addons,/opt/odoo/custom-addons
```

Los dos primeros son de Odoo: `odoo/odoo/addons` tiene el módulo `base`, y `odoo/addons` el resto de los módulos estándar. El tercero es donde va tu código.

Dos trampas que vas a pisar sí o sí:

**Agregar un módulo no lo hace aparecer.** Odoo arma la lista de módulos disponibles cuando creás la base. Si después copiás un módulo nuevo al `addons_path`, no va a estar en la interfaz hasta que actualices la lista de módulos a mano. Es el primer «mi módulo no aparece» de todo desarrollador de Odoo, y no es un error: es que nadie le avisó a Odoo.

**Las rutas relativas se resuelven contra el directorio de trabajo**, no contra el archivo de configuración. O sea que el mismo `odoo.conf` funciona o no según desde dónde arrancaste el proceso. Usá rutas absolutas y listo.

## 5 · El `odoo.conf`, donde vive todo lo anterior

`odoo-bin` tiene decenas de opciones. Nadie las escribe a mano cada vez: van a un archivo de configuración.

Lo que conviene entender es **el orden en que Odoo arma su configuración**, porque explica casi todas las confusiones:

1. Los valores por defecto del código.
2. Lo que diga el archivo de configuración, que pisa los defaults.
3. Lo que pases por línea de comandos, que pisa al archivo.

Por eso podés tener un `odoo.conf` estable y sobreescribir una sola opción al vuelo para una prueba. Y también por eso, si cambiás algo en el archivo y no pasa nada, lo primero que hay que mirar es si no lo estás pisando desde la línea de comandos.

La traducción entre una y otra forma es mecánica: tomá el nombre largo de la opción, sacale los guiones del principio y convertí los del medio en guiones bajos. `--without-demo` queda `without_demo`.

```ini odoo.conf · Lo mínimo con sentido
[options]
addons_path = /opt/odoo/odoo/addons,/opt/odoo/addons,/opt/odoo/custom-addons
data_dir = /var/lib/odoo
admin_passwd = una-contraseña-larga-y-propia
db_host = localhost
db_user = odoo
db_password = lo-que-sea
http_port = 8069
log_level = info
```

Las que vale la pena conocer desde ahora:

- **`data_dir`** — donde Odoo guarda las sesiones y el **filestore**: los archivos adjuntos, las imágenes de los productos, todo lo que subieron los usuarios. No está en la base de datos. Si hacés backup del dump y no del filestore, **tu backup está incompleto** y te vas a enterar el peor día. Lo vamos a ver en detalle en el curso de producción.
- **`admin_passwd`** — la contraseña maestra del gestor de bases de datos. No es la del usuario admin. Con esta se crean, duplican y borran bases enteras.
- **`http_port`** — 8069 por defecto.
- **`gevent_port`** — 8072 por defecto. Es el segundo puerto, el que Odoo usa para las conexiones largas del chatter y las notificaciones en vivo. Solo entra en juego cuando corrés con varios workers, y es la causa número uno de «el chatter no se actualiza en producción». Si leés `longpolling_port` en algún tutorial, es de versiones anteriores: en Odoo 19 la opción se llama `gevent_port`.
- **`workers`** — cuántos procesos atienden pedidos. En 0 corre en un solo proceso, que es lo que querés para desarrollar porque el debugger funciona.
- **`proxy_mode`** — actívalo **solo** detrás de un proxy de confianza. Sin esto, los enlaces que Odoo pone en los correos salen apuntando a `localhost`.

## Cuando algo falle

Esta es la tabla que hace que la lección valga la pena. Cada síntoma apunta a una de las cinco piezas:

| Lo que ves | Qué pieza mirar |
|---|---|
| No arranca, error de conexión a la base | PostgreSQL no está corriendo o el host está mal |
| «database does not exist» o no puede crear la base | Al rol le falta `CREATEDB` |
| `ImportError` o `ModuleNotFoundError` al arrancar | El entorno de Python, o faltó el `requirements.txt` |
| El PDF sale sin encabezado ni pie | wkhtmltopdf, la versión equivocada |
| Mi módulo no aparece en la lista | `addons_path`, o la lista de módulos sin actualizar |
| Cambié una opción y no pasó nada | La línea de comandos le está ganando al archivo |

> **Quedate con esto**
> Odoo es un proceso de Python contra un PostgreSQL. Todo lo demás —el entorno virtual, wkhtmltopdf, el `addons_path`, el `odoo.conf`— existe para sostener esas dos cosas. Cuando una guía de instalación falle, preguntate cuál de las cinco piezas se rompió en vez de volver a correr los comandos.
