---
title: "XML-RPC y JSON-RPC desde un script externo"
description: Los dos protocolos que Odoo expone de fábrica - autenticarse, buscar, crear, escribir y llamar métodos desde otro proceso.
date: 2026-10-10
topic: ERP
tags: [odoo, python, rpc]
goal: Automatizar Odoo desde afuera, en Python y en cualquier otro lenguaje.
course: odoo-backend-framework
section: integracion
order: 4
---

La lección anterior construyó un endpoint a medida. Pero Odoo ya expone **todo su ORM** por RPC, sin que escribas una línea.

Cualquier modelo, cualquier método, desde cualquier lenguaje. Y con los permisos del usuario que se autentica.

## XML-RPC en Python

```python scripts/crear_orden.py
import xmlrpc.client

URL = "http://localhost:8069"
DB = "taller"
USUARIO = "tecnico@taller.com"
CLAVE = "la-api-key"

comun = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common")
uid = comun.authenticate(DB, USUARIO, CLAVE, {})

modelos = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object")


def llamar(modelo, metodo, *args, **kwargs):
    return modelos.execute_kw(DB, uid, CLAVE, modelo, metodo, list(args), kwargs)
```

Son **dos endpoints**: `/common` para autenticarse y `/object` para todo lo demás.

`authenticate` devuelve el id del usuario, que después hay que pasar en cada llamada junto con la clave. Es incómodo y por eso conviene envolverlo en una función como la de arriba.

**Usá una API key, no la contraseña.** Se puede revocar sin cambiarle la contraseña a nadie.

## Las operaciones

```python
# buscar y leer en una sola llamada
ordenes = llamar(
    "service.order", "search_read",
    [("state", "=", "ready")],
    fields=["code", "partner_id", "amount_total"],
    limit=10,
    order="date_in desc",
)

# contar
cantidad = llamar("service.order", "search_count", [("state", "=", "ready")])

# crear
nueva = llamar("service.order", "create", [{
    "partner_id": 14,
    "equipment_id": 3,
    "diagnosis": "No enciende",
}])

# modificar
llamar("service.order", "write", [[nueva], {"state": "diagnosis"}])

# borrar
llamar("service.order", "unlink", [[nueva]])

# llamar cualquier método del modelo
llamar("service.order", "action_deliver", [[nueva]])
```

**`search_read` es el que vas a usar.** Un `search` seguido de un `read` son dos viajes por la red; `search_read` es uno.

Fijate que `write` y `unlink` reciben **una lista de ids** como primer argumento. Es la forma del `execute_kw`, y es donde más se equivoca uno al principio.

### Inspeccionar el modelo

```python
campos = llamar("service.order", "fields_get", [], attributes=["string", "type", "required"])
for nombre, info in campos.items():
    print(nombre, info["type"], info["string"])
```

`fields_get` te dice qué campos tiene el modelo. Es la forma de descubrir el esquema sin leer el código, y lo que usan las herramientas genéricas de integración.

## Lo que NO cambia

Esto es lo importante y lo que más tranquiliza:

**RPC entra por la misma puerta que la interfaz.** Las reglas de `ir.model.access`, las reglas de registro, los campos restringidos por grupo, tus `@api.constrains`, tus extensiones de `create` y `write` — **todo se aplica igual**.

Si un técnico se conecta por XML-RPC, va a ver exactamente las órdenes que vería en pantalla. No hay una puerta trasera.

La única excepción es el superusuario, igual que siempre. Por eso **nunca uses una clave de administrador para una integración**: creá un usuario de servicio con los grupos mínimos.

## JSON-RPC

```python
import requests

sesion = requests.Session()


def llamar(modelo, metodo, args, kwargs=None):
    respuesta = sesion.post(f"{URL}/jsonrpc", json={
        "jsonrpc": "2.0",
        "method": "call",
        "params": {
            "service": "object",
            "method": "execute_kw",
            "args": [DB, uid, CLAVE, modelo, metodo, args, kwargs or {}],
        },
        "id": 1,
    }).json()
    if "error" in respuesta:
        raise RuntimeError(respuesta["error"]["data"]["message"])
    return respuesta["result"]
```

Mismo protocolo conceptual, JSON en vez de XML.

**Elegí JSON-RPC si no estás en Python.** Cualquier lenguaje tiene un cliente HTTP y un parser de JSON; no todos tienen XML-RPC decente.

Y fijate la comprobación del error: **JSON-RPC devuelve 200 aunque falle**, con el error dentro del cuerpo. Si no mirás `respuesta["error"]`, los fallos pasan desapercibidos.

## `odoorpc`, de la OCA

```python
import odoorpc

odoo = odoorpc.ODOO("localhost", port=8069)
odoo.login("taller", "tecnico@taller.com", "la-api-key")

Orden = odoo.env["service.order"]
ids = Orden.search([("state", "=", "ready")])
for orden in Orden.browse(ids):
    print(orden.code, orden.partner_id.name, orden.amount_total)
```

La librería de la OCA envuelve RPC con **la misma API del ORM**. `search`, `browse`, navegar relaciones con puntos: se escribe igual que dentro de Odoo.

Es muchísimo más cómodo para scripts, y el costo es una dependencia más.

Pero cuidado con una cosa: **cada atributo que leés es una llamada por la red**. Un bucle que navega relaciones puede disparar cientos de peticiones. Acordate del prefetch de la lección de recordsets — acá no lo tenés. Para volumen, `search_read` crudo pidiendo exactamente los campos que necesitás.

## Cuándo RPC y cuándo un endpoint propio

| | RPC | Endpoint propio |
|---|---|---|
| Hay que escribir código en Odoo | no | sí |
| Superficie expuesta | **todo el ORM** | solo lo que definís |
| Contrato | el modelo de datos | el que vos diseñás |
| Validación de entrada | la del ORM | la que escribís |
| Si cambia tu modelo | el otro lado se rompe | lo absorbés vos |

**RPC para scripts internos y herramientas tuyas**: migraciones, cargas puntuales, reportes ad hoc. Es inmediato y no requiere desplegar nada.

**Endpoint propio para sistemas de terceros**: superficie mínima, contrato estable, idempotencia, errores pensados.

El criterio de fondo: **¿quién controla el otro lado?** Si sos vos, RPC. Si es otro equipo u otra empresa, un endpoint que puedas versionar.

## Un script que vas a reusar

```python scripts/pendientes.py
"""Órdenes que llevan más de 5 días sin entregarse."""
import xmlrpc.client
from datetime import date, timedelta

URL, DB, USUARIO, CLAVE = "http://localhost:8069", "taller", "tecnico@taller.com", "clave"

uid = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common").authenticate(DB, USUARIO, CLAVE, {})
modelos = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object")

limite = (date.today() - timedelta(days=5)).isoformat()
ordenes = modelos.execute_kw(DB, uid, CLAVE, "service.order", "search_read",
    [[("state", "not in", ["done", "cancel"]), ("date_in", "<", limite)]],
    {"fields": ["code", "partner_id", "date_in", "user_id"], "order": "date_in"})

for o in ordenes:
    print(f"{o['code']}  {o['partner_id'][1]:30}  desde {o['date_in']}")
```

Un detalle del formato: **los Many2one vuelven como `[id, nombre]`**. Por eso `o["partner_id"][1]` es el nombre. Es la convención del ORM por RPC y conviene tenerla presente.

## Fin del curso

El módulo `service_workshop` recorrió el camino completo: modelos con relaciones, lógica de negocio, interfaz usable, seguridad por perfil, automatizaciones, documentos imprimibles, un portal para el cliente y dos formas de integrarse con sistemas externos.

Y más importante que el módulo: **ese es el recorrido de cualquier módulo de Odoo**. El próximo que escribas va a tener las mismas piezas en el mismo orden.

Lo que sigue depende de a dónde quieras ir. Si lo tuyo es la interfaz, el curso de **Odoo 19 Web Framework** entra en OWL y el cliente web. Si te toca que esto corra para usuarios reales, **Odoo 19 a producción** cubre Docker, Nginx, backups y migraciones.

> **Quedate con esto**
> RPC expone todo el ORM respetando los permisos del usuario, así que una integración se asegura creando un usuario de servicio con los grupos mínimos, nunca con una clave de administrador. `search_read` ahorra un viaje. `odoorpc` es cómodo pero cada atributo es una llamada de red. Y la pregunta que decide entre RPC y endpoint propio es quién controla el otro lado.
