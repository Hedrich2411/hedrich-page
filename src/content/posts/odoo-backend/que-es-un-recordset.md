---
title: "Qué es un recordset y cómo explorarlo en odoo shell"
description: El recordset es la abstracción central de Odoo y no es una lista. Entenderlo bien cambia cómo escribís todo lo demás.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, python]
goal: Manejar env, browse y ensure_one, y probar código en vivo sin reiniciar el servidor.
course: odoo-backend-framework
section: recordsets
order: 1
---

Hasta acá escribimos modelos. Ahora empezamos a escribir lógica, y para eso hay que entender bien la pieza central del ORM.

**Un recordset es una colección de registros de un mismo modelo**, y puede tener cero, uno o un millón. La parte que confunde es que es las dos cosas a la vez: se comporta como una colección cuando lo recorrés, y como un registro cuando leés un campo.

## El taller de pruebas: `odoo shell`

Antes de teoría, la herramienta. Odoo trae un intérprete de Python con el ORM ya cargado:

```bash Terminal · Nativo
./odoo-bin shell -c odoo.conf -d taller
```

```bash Terminal · Con Docker
docker compose run --rm odoo odoo shell -d taller
```

Adentro tenés `env` listo, y podés probar cualquier cosa sin reiniciar el servidor ni escribir un método para ver qué devuelve.

**Es la forma más rápida de aprender el ORM.** Todo lo que sigue, probalo ahí mientras leés.

Una advertencia que ahorra confusión: **el shell no hace commit solo**. Lo que crees o modifiques se descarta al salir, salvo que escribas `env.cr.commit()`. Para explorar eso está bien —no ensuciás la base—, pero si creaste algo y «no quedó», esa es la razón.

## `self` es un recordset

```python
def marcar_lista(self):
    for order in self:
        order.state = "ready"
```

En cualquier método de un modelo, `self` **es un recordset**. No es «el registro actual»: es el conjunto de registros sobre el que se llamó al método.

Si el usuario selecciona cinco órdenes en una lista y aprieta el botón, `self` tiene cinco. Por eso se itera.

Y por eso el error más común de Odoo es este:

```python Mal · Falla apenas haya más de un registro
def marcar_lista(self):
    self.state = "ready"
```

Con un registro funciona. Con dos, Odoo lanza un error que habla de «expected singleton». Si ves esa palabra en un traceback, buscá dónde trataste un recordset como si fuera uno solo.

## `env`: la puerta a todo lo demás

```python
self.env["service.order"]          # un recordset vacío de ese modelo
self.env.user                      # el usuario que ejecuta
self.env.company                   # la compañía activa
self.env.context                   # el contexto
self.env.cr                        # el cursor de la base
self.env.ref("service_workshop.seq_service_order")   # un registro por su identificador externo
```

`self.env["modelo"]` te devuelve **un recordset vacío**, y eso alcanza para llamar métodos de modelo como `search` o `create`. Es la forma de trabajar con un modelo distinto al tuyo.

```python
# desde service.order, buscar clientes
partners = self.env["res.partner"].search([("customer_rank", ">", 0)])
```

## Un recordset vacío no explota

Esta es una propiedad que a Odoo le sale muy bien y que conviene aprovechar:

```python
order.partner_id.name          # si no hay cliente, devuelve False, no un error
order.line_ids.mapped("subtotal")   # si no hay líneas, devuelve []
for line in order.line_ids:    # sin líneas, el bucle no corre
    ...
```

Leer un campo de un recordset vacío devuelve el valor «falso» del tipo: `False` para texto, `0` para números, un recordset vacío para relaciones. **No lanza excepción.**

Eso permite escribir código sin guardas por todos lados. Pero tiene su contracara: un `if order.partner_id.name == "Juan"` sobre un recordset vacío simplemente da `False`, sin avisarte de que no había cliente.

## `browse`: de ids a recordset

```python
order = env["service.order"].browse(7)
orders = env["service.order"].browse([7, 8, 9])
```

`browse` **no consulta la base**. Arma el recordset con esos ids y no lee nada hasta que pedís un campo. Por eso es barato aunque le pases mil ids.

Y por eso también es permisivo: `browse(99999)` con un id inexistente no falla en ese momento. Falla después, cuando intentes leer.

Para limpiar los que no existen:

```python
orders = env["service.order"].browse(ids).exists()
```

`exists()` devuelve solo los que realmente están en la base. Es la guarda correcta cuando los ids vienen de afuera —de una URL, de una API, de un sistema externo.

## `ensure_one()`: exigir que sea uno solo

Hay métodos que solo tienen sentido sobre un registro: abrir un formulario, imprimir un documento, mandar un correo específico.

```python
def abrir_portal(self):
    self.ensure_one()
    return {"type": "ir.actions.act_url", "url": f"/taller/{self.code}"}
```

`ensure_one()` lanza un error si `self` no tiene exactamente un registro. **Es documentación ejecutable**: deja explícito el contrato del método y falla con un mensaje claro en vez de hacer algo raro.

Ponelo en todo método que asuma un solo registro. Cuesta una línea.

## Cómo se comportan

```python
len(orders)              # cuántos hay
bool(orders)             # False si está vacío
orders[0]                # el primero, como recordset de uno
orders.ids               # la lista de ids
for order in orders:     # cada vuelta es un recordset de uno
    ...
```

Un detalle que importa: **al iterar, cada elemento sigue siendo un recordset**, de un solo registro. No es un objeto distinto. Por eso adentro del bucle podés llamar métodos y leer campos con la misma sintaxis.

Y se combinan como conjuntos:

```python
a | b     # unión
a & b     # intersección
a - b     # diferencia
```

Es la forma limpia de juntar resultados de dos búsquedas sin duplicados ni listas intermedias.

## El orden importa, y lo define el modelo

Un recordset viene ordenado por el `_order` del modelo —acordate de la primera lección de ORM—. `search` lo respeta salvo que le pases otro orden.

Si el orden te importa para la lógica y no solo para mostrar, **declaralo explícitamente** en la llamada en vez de confiar en el default, que alguien puede cambiar en el modelo más adelante.

## Probalo ahora

```python odoo shell · Explorando el taller
>>> orders = env["service.order"].search([])
>>> len(orders)
1
>>> orders.code
'TAL/0001'
>>> orders.partner_id.name
'Cliente de prueba'
>>> orders.line_ids.mapped("name")
['Cambio de pantalla', 'Mano de obra']
>>> vacio = env["service.order"].browse(99999)
>>> vacio.exists()
service.order()
>>> bool(vacio.exists())
False
```

Fijate la penúltima línea: `service.order()` es cómo Python muestra un recordset vacío. Lo vas a ver seguido en los logs y ahora sabés qué significa.

> **Quedate con esto**
> `self` siempre es un recordset, nunca un registro, y de ahí sale el error de «singleton» que te va a aparecer la primera semana. `browse` no consulta nada hasta que leés un campo, leer de un recordset vacío devuelve falso en vez de fallar, y `ensure_one()` convierte una suposición en un contrato.
