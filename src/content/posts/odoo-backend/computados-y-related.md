---
title: "Campos calculados, related y la decisión de store"
description: Campos que se calculan solos. Cuándo guardarlos, cuándo no, y por qué un depends mal escrito es la causa de la mitad de los bugs raros.
date: 2026-10-10
topic: ERP
tags: [odoo, orm]
goal: Total, días en taller y teléfono del cliente, sabiendo cuál se guarda en base y cuál no.
course: odoo-backend-framework
section: orm
order: 4
---

Un campo calculado no guarda un valor: lo deriva de otros. El total de una orden sale de sus líneas, los días en taller salen de dos fechas.

La parte difícil no es escribir el cálculo. Es decidir **si se guarda en la base o no**, y declarar bien **de qué depende**. Un `depends` incompleto produce el peor tipo de bug: el que solo aparece a veces.

## El cálculo

```python models/service_order_line.py
subtotal = fields.Monetary(string="Subtotal", compute="_compute_subtotal", store=True)

@api.depends("quantity", "price_unit")
def _compute_subtotal(self):
    for line in self:
        line.subtotal = line.quantity * line.price_unit
```

```python models/service_order.py
amount_total = fields.Monetary(
    string="Total", compute="_compute_amount_total", store=True
)

@api.depends("line_ids.subtotal")
def _compute_amount_total(self):
    for order in self:
        order.amount_total = sum(order.line_ids.mapped("subtotal"))
```

Tres cosas de ese código no son negociables.

**El método siempre itera sobre `self`.** Un método de cálculo recibe un recordset que puede tener uno o mil registros. Si escribís `self.amount_total = ...` sin el `for`, falla apenas alguien abra una lista. Esto no es estilo: es el error número uno de quien empieza.

**Tiene que asignar un valor a todos los registros, siempre.** Si una rama del `if` no asigna nada, ese registro queda sin valor y el ORM lanza un error que no te dice cuál fue. Asigná un valor por defecto arriba y refinalo después.

**El `depends` recorre relaciones con puntos.** `line_ids.subtotal` significa «recalculá cuando cambie el subtotal de cualquier línea, y también cuando se agregue o se quite una línea». Si hubieras puesto solo `line_ids`, agregar una línea recalcularía, pero **cambiar la cantidad de una línea existente no**. El total quedaría viejo y no habría ningún error.

Ese es el bug del que hablaba. Se manifiesta como «a veces el total está mal».

## `store`: la decisión que define todo

Por defecto, un campo calculado **no se guarda**. Se recalcula cada vez que alguien lo lee.

```python
amount_total = fields.Monetary(compute="_compute_amount_total")              # no se guarda
amount_total = fields.Monetary(compute="_compute_amount_total", store=True)  # se guarda
```

La diferencia es grande:

| | Sin `store` | Con `store=True` |
|---|---|---|
| Columna en PostgreSQL | no | sí |
| Se puede buscar y filtrar | **no** | sí |
| Se puede usar en `_order` | **no** | sí |
| Se puede agrupar o sumar en un reporte | **no** | sí |
| Costo al escribir | ninguno | recalcula y escribe |
| Costo al leer | recalcula siempre | lectura directa |

La regla práctica: **si lo vas a filtrar, ordenar o agrupar, necesita `store=True`**. No hay vuelta. Un campo no almacenado no existe para PostgreSQL, y es PostgreSQL quien hace los `WHERE` y los `ORDER BY`.

Si solo se muestra en el formulario, dejalo sin almacenar y ahorrás escrituras.

Hay un costo escondido en `store=True`: cuando el campo del que dependés cambia en muchos registros a la vez, Odoo tiene que recalcular y escribir todos. Un campo almacenado que depende de algo que cambia seguido puede hacer lenta una operación masiva.

## `related`: el atajo para traer un campo de otro modelo

Mostrar el teléfono del cliente en la orden no necesita un cálculo:

```python models/service_order.py
partner_phone = fields.Char(related="partner_id.phone", string="Teléfono", readonly=True)
```

`related` es azúcar sobre un campo calculado: Odoo escribe el cálculo por vos siguiendo la ruta de puntos.

Sirve para dos cosas que no son obvias:

**La interfaz no puede navegar relaciones.** En el servidor escribís `order.partner_id.phone` sin problema, pero una vista XML no puede hacer eso: solo lee campos del modelo que está mostrando. Un `related` es la forma de exponerlo.

**Hace el campo filtrable**, si lo almacenás.

```python
partner_city = fields.Char(related="partner_id.city", store=True)
```

Ahora podés agrupar las órdenes por ciudad del cliente. Sin `store=True`, no.

Pero pensalo dos veces antes de almacenar un `related`: estás **duplicando el dato**. Si el cliente cambia de ciudad, Odoo tiene que actualizar todas sus órdenes. Para un dato que no cambia casi nunca está bien; para uno que cambia seguido, es trabajo repetido en cada escritura.

## Un calculado que el usuario puede editar: `inverse`

Por defecto un campo calculado es de solo lectura, porque el usuario no debería escribir algo que se deduce. A veces conviene lo contrario.

En el taller: querés poder fijar la fecha de entrega **o** la cantidad de días, y que el otro se acomode.

```python models/service_order.py
days_in_shop = fields.Integer(
    string="Días en taller",
    compute="_compute_days_in_shop",
    inverse="_inverse_days_in_shop",
    store=True,
)

@api.depends("date_in", "date_done")
def _compute_days_in_shop(self):
    for order in self:
        if order.date_in and order.date_done:
            order.days_in_shop = (order.date_done - order.date_in).days
        else:
            order.days_in_shop = 0

def _inverse_days_in_shop(self):
    for order in self:
        if order.date_in and order.days_in_shop:
            order.date_done = order.date_in + timedelta(days=order.days_in_shop)
```

El método `inverse` corre cuando el usuario escribe en el campo, y su trabajo es **traducir ese valor hacia atrás**, a los campos de los que se deriva. Fijate que no lleva `@api.depends`: no calcula nada, escribe.

## `search`: hacer buscable un campo sin almacenarlo

Si querés filtrar por un calculado pero almacenarlo sale caro, hay una tercera vía:

```python
is_overdue = fields.Boolean(compute="_compute_is_overdue", search="_search_is_overdue")

def _search_is_overdue(self, operator, value):
    hoy = fields.Date.context_today(self)
    return [("date_promised", "<", hoy), ("state", "not in", ["done", "cancel"])]
```

El método recibe el operador y el valor del dominio, y **devuelve otro dominio** que PostgreSQL sí sabe resolver. El campo sigue sin ocupar espacio, y aun así se puede filtrar.

Es la salida elegante cuando `store=True` sería demasiado caro.

## Dos trampas de Odoo 19

### El caché ahora es global

**Odoo 19 cambió el caché del ORM**: antes era por environment, ahora hay uno solo, global. Eso tiene una consecuencia concreta para los campos calculados que leen algo del contexto.

Si tu cálculo usa un valor del contexto, declaralo:

```python
@api.depends("price")
@api.depends_context("company_id")
def _compute_value(self):
    company_id = self.env.context.get("company_id")
    ...
```

Sin `@api.depends_context`, el caché global puede devolverte el valor calculado con **otro** contexto. Y el síntoma es de los peores: valores correctos casi siempre, equivocados de vez en cuando, imposibles de reproducir.

Si venís de versiones anteriores y tenés campos que dependen del contexto, es lo primero que hay que revisar al migrar.

### `compute_sudo`

Un cálculo que necesita leer datos que el usuario no tiene permiso de ver falla con un error de acceso. Para eso está `compute_sudo=True`, que corre el cálculo con privilegios elevados.

Su valor por defecto **depende de `store`**: si el campo se almacena, `compute_sudo` es `True`; si no, es `False`. Tiene sentido —un valor guardado es compartido entre todos los usuarios— pero es un default implícito que conviene conocer. Podés fijarlo a mano cuando quieras lo contrario.

## Cómo queda la orden

```python models/service_order.py · Los calculados de la orden
currency_id = fields.Many2one(
    "res.currency", default=lambda self: self.env.company.currency_id
)
amount_total = fields.Monetary(
    string="Total", compute="_compute_amount_total", store=True
)
partner_phone = fields.Char(related="partner_id.phone", string="Teléfono", readonly=True)
days_in_shop = fields.Integer(
    string="Días en taller", compute="_compute_days_in_shop", store=True
)
```

> **Quedate con esto**
> `store=True` es obligatorio para filtrar, ordenar o agrupar, y ese es el único criterio que importa. El `depends` tiene que llegar hasta el campo exacto del que dependés —`line_ids.subtotal`, no `line_ids`— o vas a tener totales viejos sin ningún error que te avise.
