---
title: "Anti-patrones"
description: El argumento por defecto que comparte pedidos entre clientes, True que pasa por número, el except que se traga todo, y lo que ruff encuentra en un archivo de ocho errores. Más los anti-patrones de diseño.
date: 2026-10-19
topic: Backend
tags: [python, patrones, calidad]
goal: Reconocer los errores de estilo y de diseño más comunes en Python, y dejar que las herramientas atrapen los que se pueden automatizar.
course: patrones-python
section: calidad
order: 2
---

Un anti-patrón es una solución que parece razonable y trae más problemas de los que resuelve. Algunos son de una línea y una herramienta los encuentra sola. Otros son de diseño, y solo los ve una persona.

## El argumento por defecto mutable

```python carrito.py
def agregar_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items
```

```text Terminal · agregar_item("pedido-1"), agregar_item("pedido-2")
default mutable: ['pedido-1', 'pedido-2'] ['pedido-1', 'pedido-2']
```

Dos llamadas independientes comparten la lista. El valor por defecto se crea **una vez, al definir la función**, no en cada llamada. En un servidor, el carrito de un cliente le aparece al siguiente. La forma correcta:

```python carrito.py
def agregar_item(item: str, items: list[str] | None = None) -> list[str]:
    items = [] if items is None else items
    items.append(item)
    return items
```

```text Terminal
con None:        ['pedido-1'] ['pedido-2']
```

En dataclasses, por la misma razón, `field(default_factory=list)`.

## Comparar tipos con `type()`

```text Terminal
type() == int con True: False | isinstance: True | bool primero: True
```

`type(x) == int` rechaza subclases, y `isinstance(x, int)` las acepta. Lo correcto casi siempre es `isinstance`, pero tiene su trampa: `bool` es subclase de `int`, así que `isinstance(True, int)` es verdadero y `True + True` da 2. En el [intérprete de reglas](/blog/patrones/iterator-e-interpreter), un `true` que llegó del JSON se intentó convertir a `Decimal` como si fuera un número. Cuando `bool` y `int` se tratan distinto, se pregunta por `bool` **primero**.

## Pedir permiso en lugar de perdón

```python lectura.py
if os.path.exists(ruta):
    contenido = open(ruta).read()
```

Entre el `exists` y el `open`, otro proceso puede borrar el archivo. En Python se prefiere **EAFP**, *easier to ask forgiveness than permission*: intentarlo y manejar el error.

```python lectura.py
try:
    with open(ruta) as f:
        contenido = f.read()
except FileNotFoundError:
    contenido = None
```

```text Terminal
EAFP: no existe, y no hubo carrera entre preguntar y abrir
```

El `with` además cierra el archivo, cosa que el `open(ruta).read()` deja librada al recolector de basura.

## Concatenar en un bucle

```text Terminal · armar un TXT de 20 000 líneas, 20 veces
20 000 filas, 20 veces: += 0.030s, join 0.004s
```

Cada `+=` sobre un `str` puede crear un texto nuevo. CPython optimiza algunos casos, pero no se puede contar con eso: `"\n".join(filas)` arma el texto de una vez y fue siete veces más rápido.

## Lo que ruff encuentra solo

Un archivo con los errores de siempre:

```python malo.py
from os import *
import json, sys

cache = {}

def agregar_item(item, items=[]):
    items.append(item)
    return items

def es_numero(x):
    if type(x) == int:
        return True
    return False

def leer(ruta):
    try:
        return open(ruta).read()
    except:
        return None
```

```text Terminal · uvx ruff check --select E,F,B,SIM malo.py
malo.py:1:1: F403 `from os import *` used; unable to detect undefined names
malo.py:2:1: E401 [*] Multiple imports on one line
malo.py:2:8: F401 [*] `json` imported but unused
malo.py:2:14: F401 [*] `sys` imported but unused
malo.py:6:30: B006 Do not use mutable data structures for argument defaults
malo.py:11:5: SIM103 Return the condition `type(x) == int` directly
malo.py:11:8: E721 Use `is` and `is not` for type comparisons, or `isinstance()` for isinstance checks
malo.py:18:5: E722 Do not use bare `except`
Found 8 errors.
```

- **`from os import *`** trae decenas de nombres sin que se vea cuáles. `os.open` pisa al `open` de Python, con otra firma.
- **`except:` a secas** atrapa todo, incluido `KeyboardInterrupt`, y el `return None` esconde el error real. Si algo falla al leer, nadie se entera.
- **El `cache` global** no aparece en la lista: ruff no lo marca, pero es estado compartido entre todas las llamadas, que crece sin límite y no se puede reemplazar en un test.

Lo que se puede automatizar, se automatiza: ruff en el editor y en el CI, con las reglas `B` y `SIM` además de las de por defecto. Así la revisión de código queda para lo que una herramienta no ve.

## Anti-patrones de diseño

Estos no los marca ninguna herramienta:

- **Clase dios**: un `PedidoService` de 2 000 líneas que valida, calcula, guarda, factura y manda correos. Todo cambio lo toca, y todo test lo necesita entero. Se parte por [responsabilidad](/blog/clean-architecture/responsabilidad-unica).
- **Patrones por todos lados**: una fábrica abstracta para un solo producto, un Strategy con una sola estrategia, una interfaz para una clase que nunca va a tener otra implementación. Cada capa es código que leer y que no aporta. Un patrón se agrega cuando resuelve un problema que ya tenés, no uno que imaginás.
- **Obsesión por los primitivos**: un RUC como `str`, un monto como `float`, en todo el sistema. La validación queda repartida y un monto en dólares se suma con uno en soles. Un [value object](/blog/clean-architecture/value-objects) lo resuelve una vez.
- **Copiar y pegar**: la misma regla de descuento en tres lugares, y cuando cambia, se actualizan dos.
- **Nombres que mienten**: `obtener_cliente()` que además lo crea si no existe. El que la llama no espera un `INSERT`.

> **Quedate con esto**
> Nunca un mutable como valor por defecto. `isinstance` antes que `type()`, y `bool` antes que `int`. Intentá y manejá el error en lugar de preguntar antes. `join` en lugar de `+=` en bucles. Nada de `import *` ni `except:` a secas. Dejá que ruff atrape lo automatizable, y guardá la revisión para el diseño: clases dios, patrones sin problema que resolver y primitivos donde hace falta un tipo.
