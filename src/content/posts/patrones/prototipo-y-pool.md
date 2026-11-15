---
title: "Prototype y Object Pool"
description: Clonar la factura del mes pasado sin compartir sus líneas por error, y reutilizar conexiones caras con un pool que no se agota en silencio.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Copiar objetos sin sorpresas de referencias compartidas y reutilizar recursos costosos de crear.
course: patrones-python
section: creacionales
order: 3
---

Dos patrones para no construir desde cero: **Prototype** crea un objeto nuevo copiando uno existente, y **Object Pool** reutiliza objetos que son caros de crear.

## Prototype: la factura recurrente

Una empresa factura un plan mensual. La factura de noviembre es la de octubre con otra fecha. Copiarla es lo natural:

```python recurrentes.py
@dataclass
class Linea:
    descripcion: str
    precio: Decimal


@dataclass
class FacturaRecurrente:
    cliente: str
    fecha: date
    lineas: list[Linea] = field(default_factory=list)
```

```python Mal · la copia comparte la lista
octubre = FacturaRecurrente("Bodega Lucha", date(2026, 10, 1), [Linea("Plan mensual", Decimal("99"))])
noviembre = copy.copy(octubre)
noviembre.fecha = date(2026, 11, 1)
noviembre.lineas.append(Linea("Usuario adicional", Decimal("20")))
```

```text Terminal
copy.copy, octubre: ['Plan mensual', 'Usuario adicional']
```

La factura de **octubre** también ganó la línea. `copy.copy` es una copia superficial: el objeto es nuevo, pero sus atributos apuntan a los mismos objetos, y `lineas` es la misma lista. `dataclasses.replace` hace lo mismo:

```text Terminal
replace comparte la lista: True
```

`copy.deepcopy` copia todo el árbol:

```text Terminal
deepcopy, octubre: ['Plan mensual'] | enero: ['Plan mensual', 'Usuario adicional']
```

| | Copia | Uso |
|---|---|---|
| `copy.copy`, `replace` | El objeto; comparte sus atributos | Objetos con atributos inmutables |
| `copy.deepcopy` | Todo, recursivamente | Objetos con listas, dicts u otros objetos mutables adentro |

La mejor defensa es no tener nada mutable adentro: con `tuple` en lugar de `list` y dataclasses `frozen`, la copia superficial es segura y `replace` alcanza siempre.

## Object Pool: conexiones

Abrir una conexión a PostgreSQL cuesta: TCP, TLS, autenticación. Abrir una por consulta es lento, y abrir cientos a la vez agota el servidor. Un **pool** crea unas pocas y las presta:

```python pool.py
class Pool[T]:
    def __init__(self, crear: Callable[[], T], tamano: int) -> None:
        self._libres: queue.Queue[T] = queue.Queue(maxsize=tamano)
        for _ in range(tamano):
            self._libres.put(crear())

    @contextmanager
    def usar(self, espera: float = 1.0) -> Iterator[T]:
        try:
            recurso = self._libres.get(timeout=espera)
        except queue.Empty:
            raise TimeoutError(f"no hay recursos libres después de {espera}s") from None
        try:
            yield recurso
        finally:
            self._libres.put(recurso)
```

`queue.Queue` ya es segura entre hilos. El `finally` devuelve la conexión aunque la consulta falle; olvidarse de devolverla es la forma más común de agotar un pool.

```text Terminal · 9 hilos, 3 conexiones, consultas de 0.1 s
9 consultas, 3 conexiones, 0.30s
```

Y cuando todas están prestadas, el que pide espera, y si pasa el tiempo, falla con un mensaje claro:

```text Terminal
no hay recursos libres después de 0.2s
```

Un pool sin límite de espera deja los pedidos colgados para siempre; uno sin límite de tamaño, no es un pool.

En la práctica, no lo escribas: SQLAlchemy ya trae uno (`create_engine(url, pool_size=5, max_overflow=10, pool_timeout=30)`), psycopg tiene `psycopg_pool`, y `httpx.Client` reutiliza conexiones HTTP. Lo que sí vas a hacer es **dimensionarlo**: el tamaño del pool por la cantidad de procesos de tu aplicación no puede superar el `max_connections` de PostgreSQL.

> **Quedate con esto**
> `copy.copy` y `replace` comparten lo que hay adentro; `deepcopy` copia todo, y lo mejor es no tener nada mutable adentro. Un pool presta recursos caros y los recupera en un `finally`, con tamaño y tiempo de espera fijos. Usá el de tu biblioteca, y dimensionalo contra el límite del servidor.
