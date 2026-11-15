---
title: "El modelo: _name, _description y _order"
description: El primer modelo del módulo y los atributos de clase que definen cómo se comporta en toda la interfaz.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, python]
goal: service.order existe como tabla y Odoo ya sabe cómo nombrarlo y ordenarlo.
course: odoo-backend-framework
section: orm
order: 1
---

Un modelo de Odoo es una clase de Python que el ORM convierte en una tabla de PostgreSQL. Pero además de los campos, la clase lleva unos atributos con guión bajo adelante que deciden cómo se comporta el modelo **en toda la interfaz**: cómo se ordena, qué texto lo representa, por qué campos se lo busca.

Son cuatro o cinco líneas que casi nadie piensa al principio y que después molestan todos los días.

## El modelo mínimo

```python models/service_order.py
from odoo import fields, models


class ServiceOrder(models.Model):
    _name = "service.order"
    _description = "Orden de servicio"

    code = fields.Char(string="Código", required=True)
```

Y acordate de la cadena de imports de la lección anterior:

```python models/__init__.py
from . import service_order
```

Con eso, un `-u service_workshop` crea la tabla.

## `_name` es el nombre en todas partes

```python
_name = "service.order"
```

Ese identificador es **el nombre del modelo en todo Odoo**: en `self.env["service.order"]`, en las vistas XML, en los permisos de acceso, en los identificadores externos.

Y define el nombre de la tabla: **los puntos se convierten en guiones bajos**. `service.order` → tabla `service_order`.

La convención es `modulo.objeto`, con el prefijo del área funcional. Por eso ves `sale.order`, `account.move`, `stock.picking`. Seguila: cuando tengas quince modelos, el prefijo es lo que te deja saber de un vistazo de qué módulo es cada uno.

## `_description` no es opcional en la práctica

```python
_description = "Orden de servicio"
```

Técnicamente podés omitirlo. Si lo hacés, **Odoo te deja un warning en el log cada vez que arranca**. Es una línea; ponela y evitate el ruido.

Ese texto aparece en lugares reales: en la lista de modelos de Ajustes técnicos y en varios mensajes de error, donde «Orden de servicio» se lee mucho mejor que `service.order`.

## `_order`: cómo salen listados los registros

```python
_order = "date_in desc, id desc"
```

Por defecto Odoo ordena por `id`, o sea por orden de creación. Casi nunca es lo que querés: en una lista de órdenes de taller, lo útil es ver primero las que entraron último.

La sintaxis es la de un `ORDER BY` de SQL recortado: campos separados por coma, con `desc` opcional. Pero **no es SQL**: no acepta `NULLS FIRST` ni expresiones.

Hay una regla que se paga cara si la ignorás: **solo funciona con campos almacenados en la base**. Un campo calculado sin `store=True` no se puede usar para ordenar, porque el orden lo hace PostgreSQL y ese campo no existe ahí. El error que vas a ver no menciona nada de esto.

El `id desc` al final es un hábito que conviene adoptar: desempata de forma determinística. Sin él, dos órdenes del mismo día pueden salir en cualquier orden y cambiar de posición entre recargas.

## `_rec_name`: el texto que representa al registro

Cuando una orden aparece dentro de un campo Many2one en otra pantalla, Odoo tiene que mostrar *algo*. Ese algo sale de `display_name`, que por defecto toma el campo `name`.

Nuestro modelo no tiene `name`, tiene `code`:

```python
_rec_name = "code"
```

Si no lo declarás y tampoco hay un campo `name`, Odoo muestra algo como `(service.order, 4)`. Lo vas a reconocer apenas lo veas, y ahora sabés qué significa.

## `_compute_display_name` cuando `_rec_name` no alcanza

A veces un campo solo no identifica bien el registro. Un código de orden sin el cliente obliga a abrirla para saber de quién es.

En Odoo 19 eso se resuelve sobrescribiendo `_compute_display_name`:

```python models/service_order.py · Nombre descriptivo
@api.depends("code", "partner_id")
def _compute_display_name(self):
    for order in self:
        order.display_name = f"{order.code} · {order.partner_id.name or 'Sin cliente'}"
```

Ahora el selector muestra `TAL/0007 · Juan Pérez` en vez de `TAL/0007`.

> **Si venís de versiones anteriores**
> Esto antes se hacía sobrescribiendo `name_get()`. En Odoo 19 el método es `_compute_display_name`, y es un campo calculado normal: lleva su `@api.depends` y asigna a `record.display_name`. Si encontrás un tutorial con `name_get`, está desactualizado.

Regla práctica: **si un solo campo alcanza, usá `_rec_name`**. Es más simple y más rápido, porque no tiene que calcular nada. Dejá `_compute_display_name` para cuando de verdad necesites combinar campos.

## `_rec_names_search`: por dónde se busca

Cuando escribís en un campo Many2one, Odoo busca por `_rec_name`. En nuestro caso eso significa que podés buscar una orden por su código, pero no por el nombre del cliente — que es lo que cualquiera intentaría.

```python
_rec_names_search = ["code", "partner_id.name", "equipment_id.serial"]
```

Con eso, escribir «Pérez» o el número de serie del equipo encuentra la orden.

Antes esto exigía sobrescribir el método `name_search` completo. Ahora es una lista.

## Los campos que Odoo pone solo

No los declarás y están siempre:

| Campo | Qué guarda |
|---|---|
| `id` | la clave primaria |
| `create_uid` | quién creó el registro |
| `create_date` | cuándo |
| `write_uid` | quién lo modificó por última vez |
| `write_date` | cuándo |

Son gratis y sirven más de lo que parece: podés usarlos en dominios, mostrarlos en vistas y ordenar por ellos. Un `_order = "create_date desc"` funciona sin que hayas declarado nada.

## Cómo queda

```python models/service_order.py
from odoo import api, fields, models


class ServiceOrder(models.Model):
    _name = "service.order"
    _description = "Orden de servicio"
    _order = "date_in desc, id desc"
    _rec_name = "code"
    _rec_names_search = ["code", "partner_id.name"]

    code = fields.Char(string="Código", required=True)
    date_in = fields.Date(string="Fecha de ingreso", required=True)

    @api.depends("code", "partner_id")
    def _compute_display_name(self):
        for order in self:
            order.display_name = f"{order.code} · {order.partner_id.name or 'Sin cliente'}"
```

Todavía no tiene `partner_id` — lo agregamos en la lección de relaciones, y hasta entonces el `display_name` va a fallar. Si querés probar ahora, dejá el `_compute_display_name` comentado y volvé después.

Para verlo en la base:

```bash Terminal · Confirmar que la tabla existe
docker compose exec db psql -U odoo -d taller -c "\d service_order"
```

Vas a ver tus dos columnas más las cinco que Odoo agregó sin preguntar.

> **Quedate con esto**
> `_name` define el modelo y la tabla, `_order` decide cómo se lista y solo acepta campos almacenados, y `_rec_name` es el texto con el que el registro aparece en el resto del sistema. Son cuatro líneas que afectan todas las pantallas donde el modelo se muestre.
