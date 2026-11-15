---
title: "Command y Memento"
description: Un cambio masivo de precios que se puede deshacer y rehacer, tareas serializables para una cola, y un carrito que vuelve atrás después de probar un cupón.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Convertir acciones en objetos para deshacerlas o encolarlas, y guardar el estado de un objeto para restaurarlo.
course: patrones-python
section: comportamiento
order: 3
---

Dos patrones que suelen ir juntos cuando hay que volver atrás. **Command** convierte una acción en un objeto. **Memento** guarda una foto del estado de un objeto para restaurarlo.

## Command: deshacer un cambio de precios

El panel de administración permite cambiar precios en lote. Un error al tipear un precio en una lista de cien, y el «deshacer» es lo único que salva la tarde. Cada cambio es un objeto que sabe ejecutarse y deshacerse:

```python precios.py
class Comando(Protocol):
    def ejecutar(self) -> None: ...
    def deshacer(self) -> None: ...


@dataclass
class CambiarPrecio:
    catalogo: dict[str, Decimal]
    sku: str
    nuevo: Decimal
    anterior: Decimal | None = None

    def ejecutar(self) -> None:
        self.anterior = self.catalogo[self.sku]
        self.catalogo[self.sku] = self.nuevo

    def deshacer(self) -> None:
        assert self.anterior is not None
        self.catalogo[self.sku] = self.anterior
```

Un historial guarda lo hecho y lo deshecho:

```python precios.py
class Historial:
    def __init__(self) -> None:
        self._hechos: list[Comando] = []
        self._deshechos: list[Comando] = []

    def ejecutar(self, comando: Comando) -> None:
        comando.ejecutar()
        self._hechos.append(comando)
        self._deshechos.clear()

    def deshacer(self) -> None:
        comando = self._hechos.pop()
        comando.deshacer()
        self._deshechos.append(comando)

    def rehacer(self) -> None:
        comando = self._deshechos.pop()
        comando.ejecutar()
        self._hechos.append(comando)
```

```text Terminal
aplicado: {'POLO-M': Decimal('29.90'), 'CASACA-L': Decimal('159.90')}
deshacer: {'POLO-M': Decimal('29.90'), 'CASACA-L': Decimal('189.90')}
rehacer:  {'POLO-M': Decimal('29.90'), 'CASACA-L': Decimal('159.90')}
```

`self._deshechos.clear()` al ejecutar algo nuevo es la regla de todo editor: después de un cambio nuevo, ya no se puede rehacer lo anterior.

### Comandos que viajan

El otro uso de Command es **encolar trabajo**. Una tarea como «enviar el comprobante F001-42» se describe con datos, se serializa y la ejecuta otro proceso:

```python tareas.py
@dataclass(frozen=True)
class EnviarComprobante:
    numero: str
    reintentos: int = 0
```

```text Terminal
a la cola: {"numero": "F001-42", "reintentos": 0} → EnviarComprobante(numero='F001-42', reintentos=0)
```

Es lo que hacen Celery, RQ o Dramatiq por debajo: el comando es el nombre de la tarea más sus argumentos. Que lleve solo datos simples, como un número de comprobante, y no objetos enteros, es lo que permite serializarlo y reintentarlo.

## Memento: probar un cupón

El cliente prueba un cupón que cambia cantidades y precios. Si no le conviene, todo vuelve a como estaba. Más simple que deshacer cada cambio es guardar una foto antes:

```python carrito.py
@dataclass(frozen=True)
class Memento:
    items: dict[str, int]
    cupon: str | None


@dataclass
class Carrito:
    items: dict[str, int] = field(default_factory=dict)
    cupon: str | None = None

    def guardar(self) -> Memento:
        return Memento(deepcopy(self.items), self.cupon)

    def restaurar(self, memento: Memento) -> None:
        self.items = deepcopy(memento.items)
        self.cupon = memento.cupon
```

```text Terminal
tentativo: Carrito(items={'POLO-M': 6}, cupon='VERANO50')
restaurado: Carrito(items={'POLO-M': 2}, cupon=None)
```

El `deepcopy` es imprescindible, en las dos direcciones: sin él, el memento comparte el diccionario con el carrito y la foto cambia junto con el original, como viste en [Prototype](/blog/patrones/prototipo-y-pool).

## Cuál

| | Command | Memento |
|---|---|---|
| Guarda | La acción | El estado |
| Deshacer cuesta | Lo que cueste la operación inversa | Una copia del estado por cada punto |
| Conviene | Estado grande, cambios chicos | Estado chico, cambios complejos de invertir |

En una base de datos, las dos cosas ya existen: una transacción con `ROLLBACK` es un memento, y una tabla de auditoría con cada cambio es un historial de comandos.

> **Quedate con esto**
> Command convierte una acción en un objeto con `ejecutar` y `deshacer`, y un historial de dos pilas da deshacer y rehacer. Con solo datos simples adentro, el comando se serializa y viaja a una cola de tareas. Memento guarda una foto del estado para restaurarla, con `deepcopy` para que no comparta nada con el original.
