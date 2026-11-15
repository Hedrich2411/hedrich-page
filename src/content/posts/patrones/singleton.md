---
title: "Singleton"
description: El patrón más usado y más criticado. Por qué en Python un módulo ya es un singleton, cómo leer la configuración una sola vez con functools.cache, y el precio que se paga en los tests.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Tener una única instancia cuando de verdad hace falta, sin estado global escondido.
course: patrones-python
section: creacionales
order: 4
---

Un **Singleton** garantiza que una clase tenga una sola instancia, accesible desde cualquier lado. Los casos legítimos son pocos: la configuración leída una vez, el logger, un pool de conexiones.

## La versión clásica

```python singleton.py
class SingletonClasico:
    _instancia = None

    def __new__(cls) -> "SingletonClasico":
        if cls._instancia is None:
            cls._instancia = super().__new__(cls)
            cls._instancia.contador = 0
        return cls._instancia
```

```text Terminal
clásico: True 1
```

Funciona, y casi nunca hace falta escribirlo.

## Un módulo ya es un singleton

Python importa cada módulo una sola vez y guarda el objeto en `sys.modules`:

```text Terminal
los módulos ya son singletons: True
```

Una variable en `configuracion.py` es única en todo el programa. Es la forma idiomática.

## La configuración, una vez

Para algo que se calcula, como leer el entorno, `functools.cache` sobre una función sin argumentos:

```python configuracion.py
@dataclass(frozen=True)
class Configuracion:
    base_de_datos: str
    pse_url: str
    depuracion: bool


@cache
def configuracion() -> Configuracion:
    print("leyendo el entorno")
    return Configuracion(
        base_de_datos=os.environ.get("DATABASE_URL", "sqlite://"),
        pse_url=os.environ.get("PSE_URL", "https://pse.example.pe"),
        depuracion=os.environ.get("DEBUG") == "1",
    )
```

```text Terminal
leyendo el entorno
True CacheInfo(hits=1, misses=1, maxsize=None, currsize=1)
```

La primera llamada lee; las siguientes devuelven el mismo objeto. `frozen=True` evita que alguien lo modifique y le cambie la configuración a todo el programa. Es el patrón que recomienda la documentación de FastAPI para sus *settings*.

## El precio: los tests

Un singleton es **estado global**, y el estado global se filtra entre tests:

```text Terminal
sin limpiar: False
leyendo el entorno
después de cache_clear: True
```

Un test cambió `DEBUG=1`, pero la configuración ya estaba cacheada: sigue diciendo `False`. Hay que acordarse de `configuracion.cache_clear()`. Con el singleton clásico es peor: no hay un `cache_clear`, y el contador del ejemplo sobrevive de un test al siguiente.

La salida es no llamar al singleton desde adentro del código, sino **pasarlo**:

```python Bien
class Cotizador:
    def __init__(self, config: Configuracion) -> None:
        self._config = config
```

El punto de entrada llama a `configuracion()` una vez y se la pasa a quien la necesita; el test le pasa una `Configuracion` armada a mano. La instancia sigue siendo única en producción, y el código no depende de que lo sea. Es la [inyección de dependencias](/blog/patrones/mocks-e-inyeccion).

> **Quedate con esto**
> En Python, un módulo ya es un singleton, y `@cache` sobre una función sin argumentos cubre «calcularlo una vez». Que sea inmutable, con `frozen=True`. Un singleton es estado global: se filtra entre tests y esconde dependencias. Creálo una vez en el punto de entrada y pasalo como argumento.
