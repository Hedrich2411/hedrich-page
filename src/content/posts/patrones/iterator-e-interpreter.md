---
title: "Iterator, Interpreter, y los que Python ya trae"
description: Recorrer una API paginada pidiendo solo las páginas necesarias, un intérprete para reglas de promoción guardadas como JSON, y qué pasó con Mediator y Visitor.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Recorrer colecciones grandes de forma perezosa y evaluar reglas de negocio configurables sin eval.
course: patrones-python
section: comportamiento
order: 6
---

## Iterator: una API paginada

Una API devuelve los pedidos de a 50 por página. El código que los procesa no debería saber de páginas. **Iterator** separa el recorrido de lo que se hace con cada elemento, y en Python es un generador:

```python pedidos.py
def todos_los_pedidos() -> Iterator[dict[str, Any]]:
    pagina: int | None = 1
    while pagina is not None:
        respuesta = api_listar(pagina)
        yield from respuesta["datos"]
        pagina = respuesta["siguiente"]
```

Quien lo usa ve una secuencia de pedidos, y el generador pide páginas **recién cuando se necesitan**:

```python Uso
primeros = list(itertools.islice(todos_los_pedidos(), 60))
```

```text Terminal
60 pedidos leídos, páginas pedidas: [1, 2]
```

De 247 pedidos en cinco páginas, se pidieron dos. Con una lista armada de antemano se habrían descargado las cinco.

Y para insertar en la base de a lotes, `itertools.batched`, de Python 3.12:

```text Terminal · list(itertools.batched(todos_los_pedidos(), 100))
247 pedidos en 3 lotes de hasta 100, páginas pedidas: [1, 2, 3, 4, 5]
```

Un generador mantiene en memoria una página por vez aunque recorra millones de registros. Es la herramienta para leer archivos grandes, resultados de consultas con `yield_per` de SQLAlchemy, o cualquier API con cursor.

## Interpreter: reglas de promoción

Marketing quiere configurar desde un panel quién recibe envío gratis: «total mayor o igual a 200, y además distrito Miraflores o San Isidro, o cliente nuevo». Las reglas se guardan en la base, y cambian sin desplegar.

`eval` sobre un texto que escribe alguien en un panel es una puerta abierta a ejecutar cualquier cosa en tu servidor. **Interpreter** define un lenguaje pequeño como clases, y un evaluador que solo sabe hacer lo que esas clases permiten:

```python reglas.py
@dataclass(frozen=True)
class Campo:
    nombre: str


@dataclass(frozen=True)
class Valor:
    valor: Any


@dataclass(frozen=True)
class Comparacion:
    operador: str
    izquierda: "Expresion"
    derecha: "Expresion"


@dataclass(frozen=True)
class Todas:
    partes: tuple["Expresion", ...]


@dataclass(frozen=True)
class Alguna:
    partes: tuple["Expresion", ...]


type Expresion = Campo | Valor | Comparacion | Todas | Alguna

OPERADORES = {">": lambda a, b: a > b, ">=": lambda a, b: a >= b, "==": lambda a, b: a == b, "en": lambda a, b: a in b}


def evaluar(e: Expresion, contexto: dict[str, Any]) -> Any:
    match e:
        case Campo(nombre):
            return contexto[nombre]
        case Valor(valor):
            return valor
        case Comparacion(op, izq, der):
            return OPERADORES[op](evaluar(izq, contexto), evaluar(der, contexto))
        case Todas(partes):
            return all(evaluar(p, contexto) for p in partes)
        case Alguna(partes):
            return any(evaluar(p, contexto) for p in partes)
```

La regla se guarda como JSON y una función `desde_json` la convierte en ese árbol:

```json Regla guardada en la base
{"y": [{">=": [{"campo": "total"}, 200]},
       {"o": [{"en": [{"campo": "distrito"}, ["Miraflores", "San Isidro"]]},
              {"==": [{"campo": "cliente_nuevo"}, true]}]}]}
```

```text Terminal
regla: (total >= 200 y (distrito en ['Miraflores', 'San Isidro'] o cliente_nuevo == True))
   250 Miraflores  nuevo=False → envío gratis: True
   250 Comas       nuevo=False → envío gratis: False
    90 San Isidro  nuevo=True  → envío gratis: False
   300 Comas       nuevo=True  → envío gratis: True
```

Lo único que la regla puede hacer es leer campos del contexto y compararlos con los operadores del diccionario. Es la idea de JSON Logic, y de los motores de reglas en general.

Armando este ejemplo apareció una trampa: el `true` del JSON llega como `bool`, y en Python **`bool` es subclase de `int`**. El código que convertía números a `Decimal` intentó convertir `True` y falló. La conversión tiene que preguntar por `bool` antes que por `int`. Vuelve en [anti-patrones](/blog/patrones/anti-patrones).

## Mediator y Visitor

El libro clásico tiene dos patrones más de comportamiento que en Python casi no se escriben:

- **Mediator**: los objetos no se hablan entre sí, sino a través de un intermediario. En Python lo cubren un [evento](/blog/patrones/observer) o una cola: los componentes publican y se suscriben.
- **Visitor**: agregar operaciones a una jerarquía de clases sin tocarlas. En Python, `functools.singledispatch` o un `match` sobre los tipos. El `describir` que imprimió la regla de arriba es un visitor:

```python reglas.py
@singledispatch
def describir(e: Any) -> str:
    raise TypeError(e)


@describir.register
def _(e: Comparacion) -> str:
    return f"{describir(e.izquierda)} {e.operador} {describir(e.derecha)}"
```

Una función nueva por operación, registrada por tipo, sin un método `aceptar` en cada clase.

> **Quedate con esto**
> En Python, un Iterator es un generador: el que lo usa ve una secuencia y el generador trabaja solo lo necesario, una página por vez. Interpreter define un lenguaje chico como clases y un evaluador que solo permite lo que vos querés, la alternativa segura a `eval` para reglas configurables. Mediator y Visitor se resuelven con eventos y con `singledispatch` o `match`.
