---
title: "Los campos que vas a usar siempre"
description: Los tipos de campo del día a día y los atributos que cambian su comportamiento - required, default, index, copy, tracking.
date: 2026-10-10
topic: ERP
tags: [odoo, orm]
goal: Char, Selection, Date, Float con digits y Monetary con su currency_id, y qué hace cada atributo.
course: odoo-backend-framework
section: orm
order: 2
---

Los tipos de campo de Odoo son pocos y se aprenden en una tarde. Lo que lleva más tiempo es saber **qué atributo poner en cada uno**, porque ahí es donde se deciden cosas que después cuesta cambiar.

## Los tipos

| Tipo | Para qué |
|---|---|
| `Char` | texto de una línea |
| `Text` | texto multilínea |
| `Html` | texto con formato |
| `Selection` | una opción de una lista fija |
| `Boolean` | sí o no |
| `Integer` | enteros |
| `Float` | decimales con precisión configurable |
| `Monetary` | importes, con su moneda |
| `Date` | fecha |
| `Datetime` | fecha y hora, **siempre en UTC** |
| `Binary` | archivos |

La orden de taller con sus campos propios:

```python models/service_order.py
code = fields.Char(string="Código", required=True, copy=False, index=True, default="Nuevo")
date_in = fields.Date(string="Fecha de ingreso", required=True, default=fields.Date.context_today)
date_done = fields.Date(string="Fecha de entrega", readonly=True)
state = fields.Selection(
    selection=[
        ("draft", "Recibido"),
        ("diagnosis", "En diagnóstico"),
        ("approved", "Aprobado"),
        ("repair", "En reparación"),
        ("ready", "Listo"),
        ("done", "Entregado"),
        ("cancel", "Cancelado"),
    ],
    string="Estado",
    default="draft",
    required=True,
    tracking=True,
)
diagnosis = fields.Text(string="Diagnóstico")
is_warranty = fields.Boolean(string="En garantía")
active = fields.Boolean(string="Activo", default=True)
```

Ahora, los atributos que importan.

## `required` y `default`

```python
required=True
default="Nuevo"
default=fields.Date.context_today
```

`required=True` lo hace obligatorio **en la base de datos y en la interfaz**: PostgreSQL recibe un `NOT NULL`. Eso tiene una consecuencia que te va a morder: si agregás un campo `required` a un modelo que ya tiene registros, la actualización falla, porque los registros viejos tendrían el campo vacío. La salida es agregarlo sin `required`, llenar los existentes y después hacerlo obligatorio.

`default` acepta un valor o **una función**. Para fechas, usá los helpers del propio campo:

- `fields.Date.today` — hoy, en UTC.
- `fields.Date.context_today` — hoy **en la zona horaria del usuario**. Esta es casi siempre la que querés.

La diferencia no es teórica: a las 22:00 en Lima ya es el día siguiente en UTC. Con `today`, una orden registrada el lunes a la noche queda fechada el martes.

## `Selection`: fácil de escribir, difícil de cambiar

```python
state = fields.Selection([("draft", "Recibido"), ...])
```

Lo que se guarda en la base es **la clave**, no la etiqueta. La etiqueta se traduce sola.

De ahí sale la regla importante: **podés cambiar las etiquetas cuando quieras, pero cambiar una clave rompe los datos existentes**. Si renombrás `draft` a `received`, todos los registros que tenían `draft` quedan con un valor que ya no está en la lista, y la interfaz los muestra vacíos.

Elegí las claves pensando en que son permanentes. Cortas, en inglés, sin tildes.

## `Float` con `digits`, y `Monetary` para plata

```python
hours_spent = fields.Float(string="Horas", digits=(6, 2))
```

`digits` es `(total, decimales)`. También acepta el nombre de una precisión configurable de Odoo, como `digits="Product Unit of Measure"`, y entonces el usuario la ajusta desde Ajustes sin tocar código.

Para dinero, **nunca uses `Float`**:

```python
currency_id = fields.Many2one(
    "res.currency",
    string="Moneda",
    default=lambda self: self.env.company.currency_id,
)
amount_total = fields.Monetary(string="Total", currency_field="currency_id")
```

Un `Monetary` **exige un campo de moneda al lado**. Si el campo se llama `currency_id`, Odoo lo encuentra solo; si se llama distinto, se lo indicás con `currency_field`.

A cambio te da el símbolo correcto, el redondeo según la moneda y la conversión cuando corresponde. Un `Float` te deja un número pelado y a vos decidiendo si eran soles o dólares.

## `index`: el que mejora las búsquedas

```python
code = fields.Char(index=True)
```

Crea un índice en PostgreSQL. Ponelo en los campos por los que vas a **buscar o filtrar seguido**: códigos, claves foráneas que se usan en dominios, fechas por las que se reporta.

No lo pongas en todo. Cada índice ocupa espacio y hace más lenta cada escritura.

> **Si venís de versiones anteriores**
> `index=True` reemplazó al viejo `select=1`, que está deprecado. Odoo 19 además permite declarar índices compuestos a nivel de modelo con `models.Index("(campo_a, campo_b)")`, que es lo que querés cuando siempre filtrás por dos campos juntos.

## `copy=False`: el que nadie recuerda hasta que duele

Cuando un usuario duplica un registro, Odoo copia todos los campos. Casi siempre está bien, salvo para los que deben ser únicos:

```python
code = fields.Char(copy=False)
date_done = fields.Date(copy=False)
```

Sin `copy=False`, duplicar una orden te deja dos con el mismo código — y si además pusiste una restricción de unicidad, el usuario recibe un error críptico al duplicar.

Por defecto `copy` es `True` para los campos normales y Many2one, y `False` para One2many y calculados.

## `tracking`: el historial gratis

```python
state = fields.Selection([...], tracking=True)
```

Marca el campo para que **cada cambio quede registrado en el chatter** del registro: quién lo cambió, cuándo, de qué valor a cuál.

Es casi gratis y vale muchísimo en un modelo de negocio. Cuando alguien pregunte por qué una orden pasó a «Entregado» sin reparar nada, la respuesta está ahí.

**Pero no lo declares todavía.** `tracking` solo es un parámetro válido en modelos que heredan `mail.thread`, y ese mixin lo sumamos en la lección de chatter. Si lo ponés antes, Odoo no falla, pero te deja un warning en el log **en cada arranque**:

```text Log de Odoo · El precio de adelantarse
WARNING odoo.fields: Field service.order.state: unknown parameter 'tracking'
```

Es inofensivo y es ruido. Y el ruido en los logs es caro: te acostumbra a ignorarlos justo cuando aparece el que importaba.

## `active`: el campo con poderes

```python
active = fields.Boolean(default=True)
```

Este nombre es especial. Si tu modelo tiene un campo llamado exactamente `active`, Odoo **filtra automáticamente los registros con `active = False` de todas las búsquedas y vistas**, y te agrega la opción «Archivar» en la interfaz.

Es la forma correcta de dar de baja algo sin borrarlo. Borrar un registro referenciado por otros falla o deja huecos; archivarlo lo saca de la vista y conserva el historial.

Para ver los archivados hay que pedirlo explícitamente, con el filtro «Archivado» o con `active_test=False` en el contexto.

## Los demás que vas a ver

- **`string`** — la etiqueta. Si la omitís, Odoo la deriva del nombre del campo: `date_in` se vuelve «Date In». Para una interfaz en español, declarala.
- **`help`** — el tooltip. Es el mejor lugar para explicar una regla de negocio que no es obvia.
- **`readonly=True`** — no editable en la interfaz. **No es seguridad**: por código se escribe igual. Para seguridad real están los grupos y las reglas.
- **`groups="modulo.grupo"`** — el campo solo existe para esos grupos. Esto sí es seguridad.
- **`translate=True`** — el campo guarda un valor por idioma. Útil para nombres de productos o categorías.
- **`company_dependent=True`** — un valor distinto por compañía. Reemplaza al viejo tipo `Property`, que está deprecado.

## Un detalle de `Datetime` que confunde a todos

**Los `Datetime` se guardan siempre en UTC** y se convierten a la zona del usuario para mostrarlos. Los `Date`, en cambio, no tienen zona horaria: son un día calendario y punto.

Por eso, cuando compares un `Datetime` con «ahora» en tu código, usá `fields.Datetime.now()` y no `datetime.now()` de Python: el primero te da UTC, que es lo que hay en la base.

> **Quedate con esto**
> Las claves de un `Selection` son permanentes, el dinero va en `Monetary` con su `currency_id`, `copy=False` en lo que debe ser único, y un campo llamado `active` te da archivado gratis. Esos cuatro son los que más cuesta arreglar después.
