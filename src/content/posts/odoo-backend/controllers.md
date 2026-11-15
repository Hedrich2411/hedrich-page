---
title: "Controllers y rutas: @http.route, auth y tipos de respuesta"
description: Odoo también es un servidor web. Cómo declarar rutas, qué significa cada modo de autenticación y qué podés devolver.
date: 2026-10-10
topic: ERP
tags: [odoo, python, http]
goal: Una URL propia servida por tu módulo.
course: odoo-backend-framework
section: integracion
order: 1
---

Volvamos a la primera lección del curso: **Odoo es un proceso de Python que escucha HTTP en el 8069**. Todo lo que hiciste hasta ahora —las vistas, el ORM, los reportes— vive detrás de ese servidor.

Esta sección usa el servidor directamente.

## Una ruta

```python controllers/portal.py
from odoo import http
from odoo.http import request


class ServicePortal(http.Controller):

    @http.route("/taller/estado", type="http", auth="public", website=False)
    def estado(self, **kwargs):
        return request.make_response("Taller operativo", headers=[("Content-Type", "text/plain")])
```

```python controllers/__init__.py
from . import portal
```

Y en el `__init__.py` del módulo, acordate de la cadena de imports:

```python __init__.py
from . import models
from . import controllers
```

Esa es la parte que más se olvida: el controlador no se carga, la ruta da 404, y uno busca el error en el decorador.

## `auth`: quién puede entrar

Es el parámetro más importante y el que más se usa mal.

| `auth` | Quién | `request.env.user` |
|---|---|---|
| `"user"` | solo autenticados | el usuario real |
| `"public"` | cualquiera | el usuario público si no hay sesión |
| `"none"` | cualquiera, sin base de datos | no hay |

**`"user"`** es el default sano. Si no hay sesión, Odoo redirige al login.

**`"public"`** permite entrar sin login, pero ojo: **no significa «sin permisos»**. Si no hay sesión, `request.env.user` es el usuario público, que casi no tiene acceso a nada. Vas a recibir errores de acceso al tocar cualquier modelo, y eso es correcto: es la seguridad funcionando.

**`"none"`** es para webhooks y endpoints que no tocan la base.

## `type`: qué devolvés

**`type="http"`** devuelve una respuesta web: HTML, un archivo, una redirección.

**`type="jsonrpc"`** recibe y devuelve JSON. Es el que usa el cliente web de Odoo internamente.

Ojo con el nombre: **en Odoo 19 se llama `jsonrpc`**. El viejo `type="json"` sigue funcionando como alias, pero te avisa:

```text
DeprecationWarning: Since 19.0, @route(type='json') is a deprecated alias
to @route(type='jsonrpc')
```

Tanto que Odoo trae un script que hace el cambio por vos en todo tu código — `odoo-bin upgrade_code --script 18.1-02-route-jsonrpc`.

## Las formas de responder

```python
# HTML desde una plantilla QWeb
return request.render("service_workshop.portal_order", {"order": order})

# texto o cualquier contenido
return request.make_response(contenido, headers=[("Content-Type", "text/plain")])

# redirección
return request.redirect("/taller/estado")

# un archivo para descargar
return request.make_response(
    pdf_bytes,
    headers=[("Content-Type", "application/pdf"),
             ("Content-Disposition", 'attachment; filename="orden.pdf"')],
)

# JSON, con type="jsonrpc" basta devolver un dict
return {"estado": "ok", "ordenes": 3}
```

## `request`: lo que tenés a mano

```python
request.env              # el environment, con el usuario de la sesión
request.params           # los parámetros, de la query y del body
request.httprequest      # el objeto Werkzeug crudo: headers, método, cookies
request.session          # la sesión
request.db               # el nombre de la base
```

`request.env` es la pieza clave: es el mismo environment de todas las secciones anteriores, con el usuario de quien hizo la petición. Toda la seguridad que construiste sigue valiendo.

## Parámetros

```python
@http.route("/taller/orden/<string:code>", type="http", auth="public")
def ver_orden(self, code, token=None, **kwargs):
    ...
```

Los de la ruta —`<string:code>`— llegan como argumentos nombrados. Los de la query y del formulario también. El `**kwargs` recoge el resto y **conviene ponerlo siempre**: sin él, un parámetro inesperado hace fallar la llamada con un error de Python.

Los convertidores disponibles: `<int:x>`, `<string:x>`, `<model("service.order"):order>`.

El último es tentador —te entrega el recordset directamente— pero hace la búsqueda con los permisos del usuario, así que para un endpoint público te va a dar error de acceso. Para el portal es mejor buscar a mano y controlar vos el acceso.

## El error de seguridad de los controladores

Esto es lo más importante de la lección.

```python Peligroso · cualquiera lee cualquier orden
@http.route("/taller/orden/<int:order_id>", type="http", auth="public")
def ver_orden(self, order_id, **kwargs):
    order = request.env["service.order"].sudo().browse(order_id)
    return request.render("service_workshop.portal_order", {"order": order})
```

Acá está todo mal junto: el endpoint es público, el id viene del usuario, y `sudo()` apaga la seguridad. Cualquiera puede recorrer `/taller/orden/1`, `/2`, `/3` y leer las órdenes de todos los clientes.

Es exactamente lo que advertía la lección de `sudo()`, y este es el lugar donde más se comete.

```python Correcto · el token es parte de la identidad
@http.route("/taller/orden/<int:order_id>", type="http", auth="public")
def ver_orden(self, order_id, token=None, **kwargs):
    order = request.env["service.order"].sudo().browse(order_id).exists()
    if not order or not token or not consteq(order.access_token, token):
        return request.not_found()
    return request.render("service_workshop.portal_order", {"order": order})
```

La regla: **si usás `sudo()` en un controlador público, algo además del id tiene que probar que el que pide tiene derecho**. Un token imposible de adivinar, una sesión, una clave de API.

Y la comparación va con `consteq`, de `odoo.tools`, que compara en tiempo constante. Un `==` común revela información por el tiempo que tarda.

## Limitar quién entra, sin `sudo()`

Cuando el endpoint es para usuarios internos, no hace falta nada de esto:

```python
@http.route("/taller/mis-ordenes", type="http", auth="user")
def mis_ordenes(self, **kwargs):
    ordenes = request.env["service.order"].search([])
    return request.render("service_workshop.portal_list", {"ordenes": ordenes})
```

Sin `sudo()`, el `search` corre con los permisos del usuario. **Las reglas de registro que escribiste en la sección de seguridad se aplican solas**: el técnico ve las suyas, el jefe todas. No hay nada que programar.

Esa es la forma correcta de hacerlo siempre que se pueda.

## `csrf`

```python
@http.route("/taller/webhook", type="http", auth="none", methods=["POST"], csrf=False)
```

Odoo exige un token CSRF en los POST de tipo `http`. Para un formulario del portal está bien, porque Odoo lo inyecta solo.

Para un webhook que llama un sistema externo hay que desactivarlo, y entonces **la autenticación tiene que venir por otro lado**: una firma en la cabecera, una clave de API. Un endpoint con `auth="none"` y `csrf=False` sin ninguna verificación está abierto al mundo.

## Extender un controlador existente

```python controllers/portal.py
from odoo.addons.portal.controllers.portal import CustomerPortal


class ServiceCustomerPortal(CustomerPortal):

    def _prepare_home_portal_values(self, counters):
        valores = super()._prepare_home_portal_values(counters)
        if "service_count" in counters:
            valores["service_count"] = request.env["service.order"].search_count([])
        return valores
```

Funciona como la herencia de modelos: importás la clase original, heredás y llamás a `super()`. Odoo reemplaza la ruta por la tuya.

Para **sobrescribir una ruta** entera, redeclarás el método con el mismo `@http.route`.

## Archivos estáticos

```text
static/src/img/logo.png   →   /service_workshop/static/src/img/logo.png
```

Todo lo que esté bajo `static/` de tu módulo se sirve solo, sin declarar rutas. Es público por diseño: no pongas nada ahí que no quieras que cualquiera descargue.

> **Quedate con esto**
> `auth="public"` no es «sin permisos»: es el usuario público, que casi no puede leer nada. Si usás `sudo()` en una ruta pública, algo más que el id tiene que autorizar la petición — un token comparado con `consteq`. Y cuando el endpoint sea para usuarios internos, no uses `sudo()`: las reglas de registro ya hacen el trabajo.
