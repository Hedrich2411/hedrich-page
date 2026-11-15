---
title: "Los cuellos de botella típicos"
description: Los patrones que aparecen una y otra vez, y cómo se arreglan.
date: 2026-10-11
topic: ERP
tags: [odoo, performance, postgresql]
goal: Reconocer los problemas que explican casi todo.
course: odoo-produccion
section: performance
order: 2
---

Después de perfilar unas cuantas instancias, los problemas se repiten. Esta lección es esa lista, con los números que saqué midiendo sobre el módulo del taller.

Y empieza con la regla que ordena todo lo demás: **medí primero**. Cada arreglo de acá tiene un coste —código más difícil de leer, un índice más que mantener— y pagarlo sin un perfil que lo justifique es trabajo tirado.

## 1. El N+1

El más común y el más caro. El mismo trabajo, tres formas:

```python odoo shell
# ❌ un browse por registro: rompe el prefetch
ids = Order.search([]).ids
for oid in ids:
    o = Order.browse(oid)
    total += len(o.line_ids)
```

```python
# ✅ el recordset entero: el ORM agrupa el acceso
ordenes = Order.search([])
total = sum(len(o.line_ids) for o in ordenes)
```

```python
# ✅✅ si solo querés contar, que cuente la base
env["service.order.line"]._read_group([], [], ["__count"])
```

Medido con el profiler sobre 403 órdenes:

| | Consultas | Duración |
|---|---|---|
| `browse` dentro del bucle | **404** | **170 ms** |
| El recordset entero | 2 | 5 ms |
| `_read_group` | 1 | 0.5 ms |

Treinta y tres veces, y trescientas cuarenta veces.

### Dónde se rompe el prefetch

El ORM agrupa los accesos **de los registros que están en el mismo recordset**. Lo que rompe esa agrupación:

**`browse()` de a uno.** Cada uno es su propio recordset de un elemento. No hay con quién agruparse.

**`search()` dentro de un bucle.** Lo mismo, multiplicado.

**Sacar un registro de su recordset.** Un `filtered()` que devuelve uno solo, guardarlo en una variable y usarlo después.

Y la regla práctica: **si en el perfil ves N consultas para N registros, el prefetch se rompió**. Buscá dónde se separaron.

### La excepción que vale la pena conocer

```python
for orden in ordenes:
    orden.write({"state": "done"})       # 500 llamadas
```

```python
ordenes.write({"state": "done"})         # 1 llamada
```

Lo medí sobre 500 líneas, y el resultado no es el que uno espera:

| | Consultas | Duración |
|---|---|---|
| `write` uno por uno | 12 | **244.7 ms** |
| Un `write` al recordset | 14 | **70.6 ms** |

**Las consultas son prácticamente las mismas.** El ORM acumula los cambios y los vuelca de una, así que esto no es un N+1 de SQL. Los 174 ms de diferencia son **puro Python**: quinientas veces el ciclo de `write` con sus validaciones, sus disparos de recompute y su contabilidad interna.

El arreglo es el mismo, pero vale saber por qué: buscarlo en el SQL del perfil no lo encuentra. Está en las trazas de Python.

## 2. Campos calculados almacenados

Un `compute` con `store=True` se recalcula cada vez que cambia algo de lo que declara en `@api.depends`. Si las dependencias están mal puestas, se recalcula de más y la escritura se vuelve lenta sin motivo aparente.

```python
# ❌ se dispara ante cualquier cambio de la línea
@api.depends("line_ids")
def _compute_amount_total(self):
    ...
```

```python
# ✅ solo ante lo que de verdad lo afecta
@api.depends("line_ids.quantity", "line_ids.price_unit")
def _compute_amount_total(self):
    ...
```

Y la pregunta previa, que es la que más ahorra: **¿hace falta que esté almacenado?**

| | |
|---|---|
| `store=True` | escribir cuesta, leer es gratis, se puede buscar y ordenar |
| `store=False` | escribir es gratis, leer cuesta cada vez, no se puede buscar |

Si el campo se lee en una lista o se usa en un filtro, almacenado. Si se ve solo al abrir un formulario, probablemente no hace falta.

En el perfil se reconoce fácil: una escritura que debería ser una consulta y dispara veinte, con `_compute_*` en las trazas.

## 3. Índices que faltan

El más fácil de arreglar y el que más rinde. Lo medí sobre 52.000 órdenes:

```sql
explain (analyze, buffers)
select id from service_order where state = 'done' and date_in >= '2026-01-01';
```

```text ❌ sin índice
Seq Scan on service_order  (cost=0.00..2029.89 rows=9160)
                           (actual time=0.014..6.272 rows=9301 loops=1)
  Filter: ((date_in >= '2026-01-01') AND (state = 'done'))
  Rows Removed by Filter: 43492
Execution Time: 6.473 ms
```

```text ✅ con índice en state
Bitmap Heap Scan on service_order  (cost=108.19..1485.34 rows=9277)
                                   (actual time=0.407..2.003 rows=9301 loops=1)
  ->  Bitmap Index Scan on idx_demo_state  (actual time=0.311..0.311 rows=9301)
        Index Cond: (state = 'done')
Execution Time: 2.192 ms
```

Tres veces más rápido. Pero el número no es lo importante: **lo importante es la línea `Rows Removed by Filter: 43492`**.

Esa línea dice que PostgreSQL leyó 52.793 filas para quedarse con 9.301 y tirar 43.492. Cuando la ves en un plan, hay un índice faltando. Es la señal más confiable que existe y no requiere interpretar costes.

Cómo declararlo, del lado de Odoo:

```python
state = fields.Selection(..., index=True)
```

Y para los filtros que siempre van juntos, un índice compuesto:

```python
class ServiceOrder(models.Model):
    _idx_fecha = models.Index("(partner_id, date_in DESC)")
```

**El orden de las columnas importa.** Un índice `(partner_id, date_in)` sirve para buscar por `partner_id` solo, o por los dos; no sirve para buscar por `date_in` solo.

Dónde ponerlos, sin adivinar:

**Los `Many2one` que usás para filtrar.** Odoo ya indexa algunos, no todos.

**Los campos de los filtros del search view.** Si está en la barra de búsqueda, se va a usar.

**Los campos de los dominios de las reglas de registro.** Esos corren en *cada* consulta.

Y lo que no: **no indexes todo**. Cada índice hace las escrituras más lentas y ocupa disco. El `log_min_duration_statement` de la lección de PostgreSQL te dice cuáles hacen falta de verdad.

## 4. Reglas de registro

Acá hay folclore que conviene desarmar con una medición.

Una regla de registro se mete como condición en **todas** las consultas del modelo. La del técnico del taller es:

```xml
<field name="domain_force">[('user_id', '=', user.id)]</field>
```

Y el SQL que produce:

```sql
SELECT "service_order"."id" FROM "service_order"
 WHERE "service_order"."active" IS TRUE
   AND "service_order"."user_id" IN (6)
```

Medido sobre 52.000 registros, con y sin la regla:

```text
      sin regla (sudo):  4.0 ms
  con regla de técnico:  4.3 ms
```

**Una regla simple es prácticamente gratis.** Se convierte en una condición más sobre una columna indexada, y PostgreSQL ni se despeina.

Lo que sí cuesta es una regla que cruza relaciones:

```xml
<field name="domain_force">[('partner_id.category_id.name', '!=', 'x')]</field>
```

```sql
SELECT "service_order"."id" FROM "service_order"
  LEFT JOIN "service_equipment" AS "service_order__equipment_id" ON (...)
  LEFT JOIN "res_partner" AS "service_order__equipment_id__partner_id" ON (...)
  LEFT JOIN "res_partner" AS "service_order__partner_id" ON (...)
  ...
```

Un `LEFT JOIN` por cada salto de relación, **en cada consulta del modelo**. En mi base de prueba la diferencia de tiempo no se notó —son pocos datos y los joins van por clave primaria—, y eso también es parte de la lección: **el coste depende de tus volúmenes y hay que medirlo en tu base, no asumirlo**.

Lo que sí es estructural: si la regla se puede escribir contra una columna del propio modelo en vez de cruzando relaciones, escribila así. A veces vale la pena un campo `related` con `store=True` solo para que la regla sea plana.

## 5. Los assets y el peso del cliente

No todo lo lento es el servidor. Si la primera carga tarda pero las acciones son rápidas, el problema es el navegador.

Lo que se revisa, con la pestaña Red del navegador:

**El bundle.** Cada módulo instalado suma sus archivos a `web.assets_backend`. Veinte módulos que no usás son veinte módulos de JavaScript que el navegador descarga igual.

**Que el modo desarrollador esté apagado.** Con el modo normal, el bundle va minificado. Como vimos en el curso de web framework, `?debug=assets` **no** sirve los archivos sueltos —es el mismo bundle sin minificar y con source maps—, pero igual pesa bastante más.

**Que el caché funcione.** Los assets llevan un hash en la URL y se pueden cachear para siempre. Si Nginx no lo hace, cada carga baja todo de nuevo. Es el bloque `location /web/assets` de la lección de Nginx.

**Las imágenes.** Logos sin optimizar en informes y en el portal, imágenes de producto a resolución completa en una lista de miniaturas.

## El orden

Después de perfilar, atacá en este orden. Está puesto por relación entre lo que cuesta arreglarlo y lo que devuelve:

1. **Índices.** Una línea de código, efecto medible.
2. **El N+1.** Suele ser mover dos líneas fuera de un bucle.
3. **Dependencias de los `compute`.** Un `@api.depends` más preciso.
4. **`store=True` donde no hace falta.** Un cambio de una palabra.
5. **Reglas de registro que cruzan relaciones.** Cuesta más, pero toca todas las consultas.
6. **Assets.** Si la lentitud es de carga inicial.
7. **Parámetros de PostgreSQL.** Lo último, y solo si lo anterior ya está.

**Ese último punto es a propósito.** Es tentador empezar por ahí porque es el que no toca código. Pero si el problema es un N+1, ningún `shared_buffers` lo arregla: solo hace que las cuatrocientas consultas sean un poco menos lentas cada una.

## Medir después

Repito lo de la lección anterior porque es lo que más se saltea: **corré el mismo perfil con el arreglo puesto**.

La tabla de los tres perfiles del N+1 salió de hacer exactamente eso. Es lo que te dice si el cambio sirvió, cuánto, y si vale la pena el código extra que agregaste.

Y a veces la respuesta es que no. Eso también es un resultado: revertís y seguís con el siguiente punto de la lista.

> **Quedate con esto**
> El N+1 es el rey: 404 consultas y 170 ms contra 2 y 5 ms. Pero escribir de a uno **no** es un N+1 de SQL —las consultas son casi las mismas, los 174 ms de diferencia son Python—, así que buscalo en las trazas y no en el SQL. Para los índices, la señal es `Rows Removed by Filter` en el plan, no el tiempo. Una regla de registro simple es gratis; la que cruza relaciones mete un `LEFT JOIN` por salto en cada consulta. Y el orden es índices, N+1, computes, reglas, assets y **al final** PostgreSQL: afinar la base no arregla un N+1, solo lo hace un poco menos lento.
