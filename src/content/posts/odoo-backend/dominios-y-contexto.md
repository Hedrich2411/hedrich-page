---
title: "Dominios y contexto, los dos que más se malentienden"
description: Notación polaca, operadores y las trampas clásicas de los dominios. Y el contexto, que viaja más lejos de lo que creés.
date: 2026-10-10
topic: ERP
tags: [odoo, xml, python]
goal: Filtrar sin romper y pasar valores por defecto sin hardcodear.
course: odoo-backend-framework
section: vistas
order: 4
---

Dominios y contexto están en todas partes: en los `search`, en las acciones, en los filtros, en los campos relacionales. Y los dos tienen una peculiaridad que hace que todo el mundo se equivoque las primeras veces.

## Un dominio es una lista de condiciones

```python
[("state", "=", "ready")]
[("state", "=", "ready"), ("is_warranty", "=", True)]
```

Cada condición es una tupla de **campo, operador, valor**. Varias condiciones juntas se combinan con **AND implícito**.

## La notación polaca, que es lo raro

Para cualquier combinación que no sea AND, los operadores lógicos van **adelante** de los operandos:

```python
["|", ("state", "=", "ready"), ("state", "=", "done")]
```

Se lee: «OR de lo que sigue», y toma **las dos condiciones siguientes**.

Los operadores son `&` (AND, el implícito), `|` (OR) y `!` (NOT, que toma una sola condición).

### Cómo se escribe uno complejo

La técnica que funciona es **escribir la expresión primero y después traducirla contando operandos**:

> órdenes abiertas **Y** (en garantía **O** de más de 5 días)

```python
[
    ("state", "not in", ["done", "cancel"]),
    "|",
        ("is_warranty", "=", True),
        ("days_in_shop", ">", 5),
]
```

La primera condición va sola con el AND implícito. El `|` toma las dos que le siguen.

Y para tres con OR, el truco es que **los operadores se encadenan**:

```python
["|", "|", ("a", "=", 1), ("b", "=", 2), ("c", "=", 3)]
```

El primer `|` toma «el segundo `|`» y «`c = 3`». El segundo toma `a` y `b`.

Si estás contando con los dedos, no sos el único. **Formatealo con indentación** como arriba y se vuelve legible.

## Los operadores

| Operador | Qué hace |
|---|---|
| `=` `!=` | igual, distinto |
| `>` `>=` `<` `<=` | comparación |
| `in` `not in` | el valor está en la lista |
| `like` `ilike` | contiene; `ilike` ignora mayúsculas |
| `=like` `=ilike` | coincidencia exacta con comodines `%` y `_` |
| `child_of` | el registro o cualquier descendiente |
| `parent_of` | el registro o cualquier ancestro |
| `any` `not any` | sobre una relación, si alguno de los relacionados cumple |

`child_of` es el que aprovecha el `parent_path` de la lección de relaciones: en nuestras categorías de equipo, `[("category_id", "child_of", pc.id)]` trae los de «Cómputo» y los de todas sus subcategorías.

### Navegar relaciones con puntos

```python
[("partner_id.city", "=", "Lima")]
[("line_ids.price_unit", ">", 300)]
```

Funciona y es cómodo, pero **cada punto es un JOIN**. Un dominio con tres niveles sobre una tabla grande se nota.

## Las trampas

**Buscar sobre un campo calculado sin almacenar no funciona.** Lo venimos diciendo desde la sección de ORM, y acá es donde se manifiesta: el dominio se traduce a SQL, y ese campo no existe en la base. El error habla de un campo inválido y no explica por qué.

**Un valor `False` no es lo mismo que «vacío» para todos los tipos.** Para buscar registros sin cliente:

```python
[("partner_id", "=", False)]
```

Para campos de texto, cuidado: un campo nunca escrito es `NULL`, pero uno que se escribió y después se borró puede quedar como cadena vacía. Lo seguro:

```python
["|", ("diagnosis", "=", False), ("diagnosis", "=", "")]
```

**`!=` excluye los nulos.** `[("user_id", "!=", 3)]` **no** devuelve las órdenes sin técnico asignado, porque en SQL `NULL != 3` no es verdadero. Si las querés incluir:

```python
["|", ("user_id", "=", False), ("user_id", "!=", 3)]
```

Esta es la que más silenciosamente da resultados incompletos.

**En XML hay que escapar.** Dentro de un atributo, `>` es `&gt;` y `<` es `&lt;`.

## El contexto

El contexto es **un diccionario que viaja con cada llamada** al servidor. Lleva el idioma del usuario, su zona horaria, la compañía activa, y lo que vos le pongas.

```python
self.env.context          # leerlo
self.with_context(mi_clave=1)   # un recordset nuevo con el contexto modificado
```

`with_context` **no modifica nada**: devuelve otro recordset con el contexto cambiado. Si no usás el resultado, no pasó nada.

```python Mal · el resultado se descarta
self.with_context(lang="en_US")
self.name   # sigue en español
```

```python Bien
self.with_context(lang="en_US").name
```

### Las claves especiales

| Clave | Qué hace |
|---|---|
| `default_campo` | valor por defecto al crear |
| `search_default_filtro` | activa un filtro de la búsqueda |
| `group_by` | agrupa |
| `active_id`, `active_ids`, `active_model` | el registro o registros desde los que se abrió |
| `lang` | idioma |
| `tz` | zona horaria |
| `active_test` | con `False`, incluye los archivados |

### `default_`: pasar valores al crear

```xml
<record id="action_service_order_garantia" model="ir.actions.act_window">
    <field name="name">Órdenes en garantía</field>
    <field name="res_model">service.order</field>
    <field name="view_mode">list,form</field>
    <field name="domain">[('is_warranty', '=', True)]</field>
    <field name="context">{'default_is_warranty': True, 'search_default_abiertas': 1}</field>
</record>
```

Esto es lo que resuelve el problema clásico: el usuario entra por «Órdenes en garantía», crea una, y la nueva ya viene marcada como garantía. Sin eso, tendría que marcarla a mano cada vez.

**`domain` filtra lo que se ve. `context` con `default_` prellena lo que se crea.** Casi siempre van de a pares.

### `active_id`: de dónde vengo

Cuando abrís una acción desde el botón de un formulario, el contexto lleva `active_id` con ese registro. Es lo que usan los asistentes para saber sobre qué actuar, y lo vemos en la lección de wizards.

### `active_test`: ver los archivados

```python
self.env["service.equipment"].with_context(active_test=False).search([])
```

Acordate del campo `active` de la lección de campos: Odoo filtra solo los archivados. Esta es la forma de incluirlos.

## El contexto viaja, y eso corta en los dos sentidos

Lo que ponés en el contexto **sigue viajando** a las llamadas que se hagan desde ahí. Es lo que permite que `default_is_warranty` llegue desde la acción hasta la creación del registro, sin que nadie lo pase a mano.

Pero también significa que un `default_` puesto en un contexto se aplica **a cualquier creación de ese modelo mientras esté activo**, incluso a registros que se crean como efecto secundario de otra cosa. Si un valor por defecto aparece donde no esperabas, mirá qué hay en el contexto.

Y en el otro sentido: si llamás un método con `with_context()` reemplazando todo el diccionario en vez de agregarle claves, podés dejar al usuario sin idioma ni compañía. Por eso `with_context(clave=valor)` —que agrega— es casi siempre lo correcto, y pasar un diccionario entero es la excepción.

> **Quedate con esto**
> En un dominio, los operadores lógicos van adelante y toman las dos condiciones siguientes. `!=` deja afuera los nulos, y esa es la que da resultados incompletos sin avisar. En el contexto, `domain` filtra lo que se ve y `default_` prellena lo que se crea: van juntos. Y `with_context` devuelve un recordset nuevo, no modifica el que tenías.
