---
title: "search, filtered, mapped y sorted: cuándo cada uno"
description: Cuatro operaciones que parecen intercambiables y no lo son. Una va a la base de datos, las otras tres trabajan en memoria.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, performance]
goal: Elegir la operación correcta y no traer la base entera a memoria.
course: odoo-backend-framework
section: recordsets
order: 2
---

Hay una distinción que decide si tu código corre en milisegundos o en minutos:

**`search` le pregunta a PostgreSQL. `filtered`, `mapped` y `sorted` trabajan sobre lo que ya tenés en memoria.**

Las cuatro parecen hacer lo mismo y producen el mismo resultado sobre datos chicos. Con diez mil registros, la diferencia es brutal.

## `search`: el que va a la base

```python
orders = self.env["service.order"].search([("state", "=", "ready")])
```

Le pasás un **dominio** —la lista de condiciones, que vemos en detalle en la sección de vistas— y PostgreSQL devuelve solo los que coinciden.

Los argumentos que vas a usar:

```python
self.env["service.order"].search(
    [("state", "=", "ready")],
    limit=20,
    offset=0,
    order="date_in desc",
)
```

- **`limit`** — cuántos como máximo. Sin él, no hay tope.
- **`offset`** — cuántos saltear. Con `limit`, es paginación.
- **`order`** — fuerza un orden distinto al `_order` del modelo.

### Contar sin traer nada

```python
cantidad = self.env["service.order"].search_count([("state", "=", "ready")])
```

Si solo querés el número, **`search_count` es la respuesta**. Hace un `COUNT(*)` y devuelve un entero.

El antipatrón es `len(self.env["service.order"].search([...]))`: eso trae todos los registros a memoria para después contarlos y tirarlos.

### Un recordset vacío sirve para buscar

Fijate que escribimos `self.env["service.order"].search(...)` y no `self.search(...)`. Las dos funcionan, pero significan cosas distintas: `self.search` busca en el modelo de `self`. Para buscar en otro modelo, pedís su recordset vacío con `self.env[...]` y buscás ahí.

## `filtered`: en memoria, sobre lo que ya trajiste

```python
listas = orders.filtered(lambda o: o.state == "ready")
listas = orders.filtered("is_warranty")          # atajo para campos booleanos
```

Recorre el recordset en Python y devuelve otro recordset con los que pasan.

**No consulta nada.** Si los registros ya están en memoria, es casi gratis.

### El error que importa

```python Mal · Trae todo para descartar casi todo
todas = self.env["service.order"].search([])
listas = todas.filtered(lambda o: o.state == "ready")
```

```python Bien · PostgreSQL devuelve solo lo que sirve
listas = self.env["service.order"].search([("state", "=", "ready")])
```

El primero trae **todas** las órdenes de la base a memoria para quedarse con unas pocas. Con cincuenta órdenes no se nota. Con cincuenta mil, el servidor se arrodilla.

La regla: **si la condición se puede expresar en un dominio, va en el dominio.**

### Cuándo `filtered` sí es la respuesta

Cuando ya tenés el recordset por otro motivo y querés partirlo:

```python
def procesar(self):
    en_garantia = self.filtered("is_warranty")
    resto = self - en_garantia
```

Acá `self` ya está en memoria. Volver a la base sería más lento, no más rápido.

Y cuando la condición **no se puede expresar en un dominio**, porque depende de un campo calculado sin almacenar o de lógica de Python:

```python
caras = orders.filtered(lambda o: o.amount_total > o.partner_id.credit_limit)
```

Comparar dos campos entre sí no se puede hacer con un dominio. Ahí `filtered` es la única vía.

## `mapped`: extraer un campo, o navegar una relación

```python
nombres = orders.mapped("code")                  # lista de strings
total = sum(orders.mapped("amount_total"))       # sumar
clientes = orders.mapped("partner_id")           # ¡un recordset!
ciudades = orders.mapped("partner_id.city")      # navegar con puntos
```

El detalle que lo hace tan útil: **cuando el campo es relacional, `mapped` devuelve un recordset, no una lista** — y además sin duplicados.

```python
# todos los clientes distintos con órdenes listas, en una línea
clientes = self.env["service.order"].search([("state", "=", "ready")]).mapped("partner_id")
```

Eso evita el bucle con `set()` y lista intermedia que escribiríamos en Python puro.

Para campos no relacionales devuelve una lista normal, **con duplicados y en orden**.

## `sorted`: ordenar en memoria

```python
orders.sorted("date_in")
orders.sorted("date_in", reverse=True)
orders.sorted(lambda o: (o.partner_id.name, o.date_in))
```

Igual que `filtered`: no consulta nada, reordena lo que ya tenés.

Y la misma regla: **si vas a ordenar un resultado de búsqueda, pedile el orden a la base**:

```python Bien
orders = self.env["service.order"].search([], order="date_in desc", limit=10)
```

```python Mal · trae todo para quedarse con diez
orders = self.env["service.order"].search([]).sorted("date_in", reverse=True)[:10]
```

Donde `sorted` sí gana es cuando el criterio no es un campo almacenado:

```python
orders.sorted(lambda o: o.days_in_shop)
```

## `read_group`: agrupar sin traer registros

Para un tablero o un reporte, lo que querés son totales, no registros.

```python
for tecnico, cantidad, total in self.env["service.order"]._read_group(
    domain=[("state", "!=", "cancel")],
    groupby=["user_id"],
    aggregates=["id:count", "amount_total:sum"],
):
    print(tecnico.name, cantidad, total)
```

PostgreSQL hace el `GROUP BY` y te devuelve **las filas agrupadas**, no los registros. Si tenés cincuenta mil órdenes y diez técnicos, esto devuelve diez tuplas.

Fijate que el valor agrupado viene como **recordset** —`tecnico` es un `res.users`, no un id—, así que podés leerle los campos directamente.

Es la diferencia entre un tablero que carga al instante y uno que hace esperar. Lo retomamos en la lección de rendimiento del curso de producción.

## Recorrer relaciones y el prefetch

```python
for order in orders:
    print(order.partner_id.name)
```

Parece una consulta por vuelta —el clásico problema N+1— pero **el ORM de Odoo lo evita solo**. Cuando leés un campo de un registro que forma parte de un recordset, Odoo trae ese campo **para todos los registros del recordset de una vez**. Es el *prefetch*.

Por eso el bucle de arriba hace dos consultas, no doscientas.

Pero el prefetch tiene un límite que conviene conocer: **funciona dentro de un mismo recordset**. Si rompés el recordset en pedazos, lo perdés:

```python Mal · pierde el prefetch
for order_id in ids:
    order = self.env["service.order"].browse(order_id)
    print(order.partner_id.name)
```

Ahí cada `browse` crea un recordset nuevo de un solo registro, y cada lectura es una consulta propia. Es el mismo bucle y es órdenes de magnitud más lento.

**Trabajá siempre con el recordset entero.**

## La tabla de decisión

| Querés | Usá |
|---|---|
| Traer registros según una condición | `search` con dominio |
| Solo la cantidad | `search_count` |
| Partir un recordset que ya tenés | `filtered` |
| Filtrar por algo que el dominio no expresa | `filtered` |
| Sacar un campo o navegar una relación | `mapped` |
| Ordenar un resultado de búsqueda | el `order=` del `search` |
| Ordenar por algo no almacenado | `sorted` |
| Totales y conteos agrupados | `_read_group` |

> **Quedate con esto**
> `search` pregunta a PostgreSQL, las otras tres trabajan sobre memoria. Si una condición se puede escribir como dominio, va en el dominio — traer todo para filtrar después es el error de rendimiento más común en Odoo. Y nunca partas un recordset en `browse` individuales dentro de un bucle: ahí perdés el prefetch y multiplicás las consultas.
