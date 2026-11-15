---
title: "Extender create y write"
description: Interceptar la creación y la escritura de registros - el gancho más usado del ORM y el que más fácil se rompe.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, python]
goal: Numeración automática al crear y bloqueo de edición cuando la orden está cerrada.
course: odoo-backend-framework
section: recordsets
order: 3
---

Extender `create` y `write` es el gancho más usado de todo Odoo: numerar un documento, registrar una auditoría, impedir una modificación, disparar una notificación.

También es donde más fácil se rompe algo, porque estás interviniendo en el camino por el que pasa *todo*.

## `create` recibe una lista

```python models/service_sequence_mixin.py
@api.model_create_multi
def create(self, vals_list):
    for vals in vals_list:
        if vals.get("code", "Nuevo") == "Nuevo":
            vals["code"] = self.env["ir.sequence"].next_by_code(self._sequence_code()) or "Nuevo"
    return super().create(vals_list)
```

Lo primero que sorprende: **`create` recibe una lista de diccionarios, no uno solo**. El decorador `@api.model_create_multi` lo declara.

La razón es rendimiento. Crear cien registros de a uno son cien viajes a la base; en lote es uno. Odoo lo aprovecha en las importaciones y en los datos de los módulos.

Por eso tu extensión **tiene que recorrer la lista**. Si escribís `vals_list.get(...)` tratándolo como un diccionario, falla.

Y `super().create(vals_list)` devuelve **el recordset de todos los creados**, no uno.

### Qué hacer antes y qué después

Hay dos lugares donde poner tu lógica, y la elección no es estética:

```python
@api.model_create_multi
def create(self, vals_list):
    # ANTES: modificar los valores con los que se va a crear
    for vals in vals_list:
        vals.setdefault("user_id", self.env.user.id)

    records = super().create(vals_list)

    # DESPUÉS: hacer algo con los registros ya creados
    records._notificar_recepcion()
    return records
```

**Antes de `super()`** es el único momento en que podés cambiar los valores. El registro todavía no existe.

**Después de `super()`** es el único momento en que tenés el registro, con su id, para relacionarlo con otra cosa o mandar un correo.

Nuestro mixin de numeración va antes, porque el código tiene que estar en los valores con los que se crea la fila.

## `write` recibe un diccionario, y `self` muchos registros

```python models/service_order.py
def write(self, vals):
    if "state" in vals and vals["state"] == "done":
        vals.setdefault("date_done", fields.Date.context_today(self))
    return super().write(vals)
```

Acá es al revés que en `create`: **un solo diccionario de valores, aplicado a todos los registros de `self`**.

Eso tiene una consecuencia que conviene tener presente: `self` puede tener mil órdenes y les estás escribiendo lo mismo a todas.

### Comparar el valor viejo con el nuevo

Es el caso más frecuente y el que más se hace mal:

```python models/service_order.py · Detectar un cambio de estado
def write(self, vals):
    if "state" in vals:
        for order in self:
            if order.state == "done" and vals["state"] != "done":
                raise UserError(
                    "La orden %s ya fue entregada y no se puede reabrir." % order.code
                )
    return super().write(vals)
```

**Leé el valor viejo antes de llamar a `super()`.** Después de `super()` ya se escribió y `order.state` te devuelve el nuevo. El orden de las líneas es toda la lógica.

Y el `if "state" in vals` de arriba no es un detalle de estilo: sin él, el bucle corre en **cada** escritura del modelo, incluyendo las que no tocan el estado.

## Las dos reglas que evitan la mayoría de los bugs

**Siempre devolver lo que devuelve `super()`.** `write` devuelve `True` y `create` el recordset. Si tu método no devuelve nada, cualquiera que llame a `order.write(...)` esperando `True` recibe `None`.

**Nunca llamar a `self.write()` dentro de `write()`.** Es recursión infinita. Si necesitás modificar un campo del mismo registro, agregalo a `vals` antes de `super()`.

```python Mal · se llama a sí mismo
def write(self, vals):
    res = super().write(vals)
    self.write({"date_done": fields.Date.context_today(self)})   # ← recursión
    return res
```

```python Bien · va en los mismos valores
def write(self, vals):
    if vals.get("state") == "done":
        vals.setdefault("date_done", fields.Date.context_today(self))
    return super().write(vals)
```

## `unlink` y el borrado que conviene impedir

```python models/service_order.py
def unlink(self):
    for order in self:
        if order.state not in ("draft", "cancel"):
            raise UserError(
                "No se puede borrar la orden %s: ya fue procesada. Cancelala." % order.code
            )
    return super().unlink()
```

En un sistema de gestión, **borrar casi nunca es lo correcto**. Un documento que existió es historia. Para sacarlo de la vista están el estado «cancelado» y el archivado con el campo `active`.

Impedir el borrado de documentos procesados es una de esas reglas que nadie pide hasta que alguien borra una orden entregada.

## Escribir en relaciones: `Command`

Para los campos One2many y Many2many no alcanza con un valor: hay que decir **qué operación** hacer sobre la relación.

```python
from odoo import Command

order = self.env["service.order"].create({
    "partner_id": partner.id,
    "equipment_id": equipo.id,
    "line_ids": [
        Command.create({"name": "Cambio de pantalla", "quantity": 1, "price_unit": 450}),
        Command.create({"name": "Mano de obra", "quantity": 2, "price_unit": 60}),
    ],
    "tag_ids": [Command.link(tag_urgente.id)],
})
```

Las operaciones disponibles:

| Comando | Qué hace |
|---|---|
| `Command.create(valores)` | crea un registro nuevo y lo relaciona |
| `Command.update(id, valores)` | modifica uno relacionado |
| `Command.delete(id)` | lo saca de la relación **y lo borra de la base** |
| `Command.unlink(id)` | lo saca de la relación, sin borrarlo |
| `Command.link(id)` | relaciona uno que ya existe |
| `Command.clear()` | vacía la relación |
| `Command.set([ids])` | reemplaza la relación entera por esa lista |

La diferencia entre **`delete` y `unlink`** es la que más se confunde, y el nombre no ayuda: `delete` borra el registro de la base, `unlink` solo corta la relación. Para un One2many de líneas querés `delete`; para un Many2many de etiquetas, `unlink`.

Y ojo: **`update`, `delete` y `clear` no se pueden usar en `create`**. Tiene sentido: no hay nada que actualizar ni borrar en un registro que todavía no existe.

> **Si venís de versiones anteriores**
> Todo esto se escribía con tuplas numéricas: `(0, 0, valores)` para crear, `(4, id)` para enlazar, `(6, 0, [ids])` para reemplazar. **Siguen funcionando**, y las vas a ver en todos los tutoriales y en buena parte del código viejo. Pero en el código fuente de Odoo 19 `Command` ya es la forma dominante, y por algo: `Command.unlink(id)` se entiende sin ir a buscar una tabla, `(3, id)` no.

## Cómo queda el módulo

```python models/service_order.py · Los ganchos de la orden
def write(self, vals):
    if "state" in vals:
        for order in self:
            if order.state == "done" and vals["state"] != "done":
                raise UserError(
                    "La orden %s ya fue entregada y no se puede reabrir." % order.code
                )
    if vals.get("state") == "done":
        vals.setdefault("date_done", fields.Date.context_today(self))
    return super().write(vals)

def unlink(self):
    for order in self:
        if order.state not in ("draft", "cancel"):
            raise UserError(
                "No se puede borrar la orden %s: ya fue procesada. Cancelala." % order.code
            )
    return super().unlink()
```

El `create` ya lo tenemos en el mixin de la sección anterior, y ahora entendés por qué estaba escrito así.

> **Quedate con esto**
> `create` recibe una lista y devuelve un recordset; `write` recibe un diccionario y se aplica a todo `self`. Para comparar el valor viejo con el nuevo hay que leerlo **antes** de `super()`. Y nunca llames a `self.write()` dentro de `write()`: lo que querías cambiar va en `vals`.
