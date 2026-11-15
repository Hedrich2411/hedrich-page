---
title: "Relaciones: Many2one, One2many y Many2many"
description: Los tres tipos de relación del ORM, cuándo usar cada uno y qué pasa realmente en la base de datos con cada uno.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, postgresql]
goal: La orden tiene cliente, equipo, líneas de repuestos y técnico asignado.
course: odoo-backend-framework
section: orm
order: 3
---

Odoo tiene tres tipos de relación, y la diferencia entre ellos se entiende mejor mirando qué crean en PostgreSQL. Esa es la parte que casi ningún tutorial explica, y es la que te deja razonar sobre rendimiento y sobre qué pasa cuando borrás algo.

## Many2one: una columna, nada más

Una orden pertenece a un cliente. Muchas órdenes, un cliente.

```python models/service_order.py
partner_id = fields.Many2one(
    comodel_name="res.partner",
    string="Cliente",
    required=True,
    ondelete="restrict",
    index=True,
)
user_id = fields.Many2one(
    "res.users",
    string="Técnico",
    default=lambda self: self.env.user,
)
```

**En la base es una columna con una clave foránea.** `partner_id INTEGER REFERENCES res_partner(id)`. Nada más. Por eso un Many2one es barato.

La convención de nombre es terminar en `_id`. No es obligatorio, pero todo Odoo la sigue y romperla hace que tu código se lea raro.

### `ondelete`: qué pasa si borran el otro lado

Es el atributo que más consecuencias tiene y el que más se deja en blanco:

- **`"set null"`** (el default) — si borran el cliente, la orden queda sin cliente. Silencioso y casi siempre malo.
- **`"restrict"`** — impide borrar el cliente mientras tenga órdenes. El usuario recibe un error claro.
- **`"cascade"`** — borrar el cliente **borra todas sus órdenes**. Úsalo solo cuando el hijo no tiene sentido sin el padre, como las líneas de una orden.

Para un documento de negocio, `restrict` es casi siempre la respuesta correcta. Una orden de taller sin cliente no es un dato válido; es un dato roto.

## One2many: el espejo, que no existe en la base

```python models/service_order.py
line_ids = fields.One2many(
    comodel_name="service.order.line",
    inverse_name="order_id",
    string="Repuestos y servicios",
)
```

```python models/service_order_line.py
class ServiceOrderLine(models.Model):
    _name = "service.order.line"
    _description = "Línea de orden de servicio"

    order_id = fields.Many2one(
        "service.order",
        string="Orden",
        required=True,
        ondelete="cascade",
        index=True,
    )
    name = fields.Char(string="Descripción", required=True)
    quantity = fields.Float(string="Cantidad", default=1.0)
```

Acá está el punto importante: **un One2many no crea ninguna columna**. Es una vista del Many2one que apunta de vuelta. Lo único que existe en PostgreSQL es `service_order_line.order_id`.

De ahí salen dos consecuencias prácticas:

**Un One2many necesita sí o sí un Many2one del otro lado**, y se lo nombrás en `inverse_name`. Si te equivocás en ese nombre, el error te dice que el campo no existe.

**Leer un One2many es una consulta.** Recorrer `order.line_ids` para mil órdenes dispara trabajo real. El ORM agrupa las consultas (lo vemos en la sección de recordsets), pero la relación no es gratis como lo es leer una columna.

### El patrón cabecera-líneas

Lo que acabamos de escribir es **el patrón más repetido de todo Odoo**: un documento con su cabecera y sus líneas. `sale.order` / `sale.order.line`, `account.move` / `account.move.line`, `stock.picking` / `stock.move`.

Si lo entendés acá, entendés la mitad de los modelos de Odoo. Y fijate el `ondelete="cascade"` en la línea: una línea sin su orden no significa nada, así que se va con ella.

## Many2many: una tabla intermedia

Una orden puede llevar varias etiquetas, y una etiqueta está en varias órdenes.

```python models/service_order.py
tag_ids = fields.Many2many(
    comodel_name="service.tag",
    string="Etiquetas",
)
```

```python models/service_tag.py
class ServiceTag(models.Model):
    _name = "service.tag"
    _description = "Etiqueta de orden"

    name = fields.Char(required=True)
    color = fields.Integer(string="Color")
```

**En la base crea una tabla intermedia** con dos columnas. Odoo le pone nombre solo —algo como `service_order_service_tag_rel`— y normalmente eso alcanza.

Podés nombrarla vos si necesitás control, por ejemplo cuando hay dos Many2many entre los mismos modelos:

```python
tag_ids = fields.Many2many(
    "service.tag",
    relation="service_order_tag_rel",
    column1="order_id",
    column2="tag_id",
    string="Etiquetas",
)
```

Un Many2many **no tiene lugar donde guardar datos de la relación**. Si necesitás saber *cuándo* se puso esa etiqueta o *quién* la puso, la tabla intermedia ya no alcanza: tenés que crear un modelo propio con dos Many2one. Es el momento de dejar de usar Many2many.

## `domain`: limitar lo que se puede elegir

```python
partner_id = fields.Many2one(
    "res.partner",
    string="Cliente",
    domain=[("is_company", "=", False)],
)
```

Filtra qué registros aparecen en el selector. Lo vemos en profundidad en la sección de vistas, pero conviene saber desde ahora que se puede declarar en el modelo y no solo en la vista.

Ojo: **el `domain` filtra la interfaz, no la base**. Por código podés escribir cualquier id. Si necesitás garantía, va una restricción.

## Jerarquías: una relación a sí mismo

Las categorías de equipo son un árbol: «Cómputo» → «Laptops» → «Laptops gamer».

```python models/service_equipment.py
class ServiceEquipmentCategory(models.Model):
    _name = "service.equipment.category"
    _description = "Categoría de equipo"
    _parent_store = True
    _order = "complete_name"

    name = fields.Char(required=True)
    complete_name = fields.Char(
        string="Nombre completo",
        compute="_compute_complete_name",
        recursive=True,
        store=True,
    )
    parent_id = fields.Many2one(
        "service.equipment.category",
        string="Categoría padre",
        ondelete="cascade",
        index=True,
    )
    parent_path = fields.Char(index=True)
    child_ids = fields.One2many(
        "service.equipment.category", "parent_id", string="Subcategorías"
    )

    @api.depends("name", "parent_id.complete_name")
    def _compute_complete_name(self):
        for category in self:
            if category.parent_id:
                category.complete_name = f"{category.parent_id.complete_name} / {category.name}"
            else:
                category.complete_name = category.name
```

Es un Many2one al propio modelo más su One2many espejo. Pero hay dos piezas que merecen explicación.

**`_parent_store = True` y `parent_path`** van juntos: Odoo guarda en `parent_path` la ruta completa del nodo (algo como `1/4/9/`) para poder responder «todos los descendientes de X» con un solo `LIKE` en vez de recorrer el árbol. Eso es lo que hace funcionar al operador `child_of` de los dominios.

El campo lo mantiene Odoo, vos solo lo declarás, y alcanza con `index=True`. Si viste en algún lado `unaccent=False` ahí, era de versiones anteriores: **ese parámetro ya no existe** y Odoo 19 deja un warning en el log por cada arranque si lo dejás.

**`recursive=True`** en el campo calculado le avisa al ORM que el cálculo depende de sí mismo en el padre. Sin eso, renombrar una categoría no actualiza el nombre completo de sus hijas.

El costo: `_parent_store` **recalcula y bloquea la tabla cada vez que se agrega, borra o mueve un nodo**. Para categorías que casi no cambian está perfecto. Si tu jerarquía se reorganiza todo el tiempo y con concurrencia, conviene quedarse con `parent_id` y `child_ids` pelados y asumir las consultas recursivas.

## El equipo, que une todo

```python models/service_equipment.py
class ServiceEquipment(models.Model):
    _name = "service.equipment"
    _description = "Equipo del cliente"
    _rec_names_search = ["name", "serial"]

    name = fields.Char(string="Equipo", required=True)
    serial = fields.Char(string="N° de serie", index=True)
    partner_id = fields.Many2one(
        "res.partner", string="Propietario", required=True, ondelete="restrict"
    )
    category_id = fields.Many2one(
        "service.equipment.category", string="Categoría", ondelete="restrict"
    )
    order_ids = fields.One2many("service.order", "equipment_id", string="Historial")
```

Ese `order_ids` es el que va a permitir, más adelante, abrir un equipo y ver todas las veces que pasó por el taller. Es información que ya existe en la base; solo había que declararla.

> **Quedate con esto**
> Un Many2one es una columna, un One2many es la lectura inversa de esa columna y no existe en la base, y un Many2many es una tabla intermedia sin lugar para datos propios. Y de todos los atributos, `ondelete` es el que más consecuencias tiene y el que más se deja en el default equivocado.
