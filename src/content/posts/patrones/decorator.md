---
title: "Decorator"
description: Medir el tiempo de cualquier función con @, y sumar caché y logs a un cliente de API envolviéndolo, sin tocar su código. Y por qué el orden de los envoltorios importa.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Agregar comportamiento a funciones y objetos existentes sin modificarlos.
course: patrones-python
section: estructurales
order: 2
---

El **Decorator** agrega responsabilidades a un objeto envolviéndolo con otro que tiene la misma interfaz. Python lo tiene en la sintaxis, con `@`, para funciones; para objetos, es componer.

## Decorar funciones

Medir cuánto tarda cualquier función sin tocarla:

```python medicion.py
def cronometrar[**P, R](funcion: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(funcion)
    def envoltura(*args: P.args, **kwargs: P.kwargs) -> R:
        inicio = time.perf_counter()
        try:
            return funcion(*args, **kwargs)
        finally:
            log.info("%s tardó %.0f ms", funcion.__name__, (time.perf_counter() - inicio) * 1000)

    return envoltura


@cronometrar
def generar_reporte(mes: str) -> str:
    """Reporte de ventas del mes."""
    time.sleep(0.12)
    return f"reporte-{mes}.xlsx"
```

```text Terminal
INFO generar_reporte tardó 120 ms
reporte-2026-10.xlsx | generar_reporte | Reporte de ventas del mes.
```

**`functools.wraps`** copia el nombre y la documentación de la función original. Sin él, la función decorada se llama `envoltura`, y eso rompe los logs, la ayuda y los frameworks que registran funciones por su nombre.

**`[**P, R]`** con `ParamSpec` hace que mypy siga viendo la firma real de la función decorada, con sus argumentos y su tipo de retorno.

**`finally`** registra el tiempo también cuando la función lanza una excepción.

## Decorar objetos

La consulta de RUC a una API externa tarda 200 ms. Se puede sumar caché y log sin tocar el cliente, envolviéndolo con objetos que cumplen la misma interfaz:

```python ruc.py
class ConsultaRuc(Protocol):
    def buscar(self, ruc: str) -> Contribuyente: ...


class ConsultaRucConCache:
    def __init__(self, interna: ConsultaRuc, segundos: float) -> None:
        self._interna = interna
        self._segundos = segundos
        self._cache: dict[str, tuple[float, Contribuyente]] = {}

    def buscar(self, ruc: str) -> Contribuyente:
        guardado = self._cache.get(ruc)
        if guardado and time.monotonic() - guardado[0] < self._segundos:
            return guardado[1]
        contribuyente = self._interna.buscar(ruc)
        self._cache[ruc] = (time.monotonic(), contribuyente)
        return contribuyente


class ConsultaRucConLog:
    def __init__(self, interna: ConsultaRuc) -> None:
        self._interna = interna

    def buscar(self, ruc: str) -> Contribuyente:
        log.info("consultando RUC %s", ruc)
        return self._interna.buscar(ruc)
```

```python Armado
consulta = ConsultaRucConLog(ConsultaRucConCache(ConsultaRucHttp(), segundos=3600))
```

```text Terminal
5 búsquedas, 1 llamada HTTP, 0.20s
```

Cada envoltorio hace una sola cosa y se combinan como piezas.

### El orden importa

Con el log **afuera** de la caché, cada una de las cinco búsquedas se registra. Con el log **adentro**, solo la que llegó a la API:

```text Resultado, cinco búsquedas del mismo RUC
consulta = ConsultaRucConLog(ConsultaRucConCache(http))   → 5 líneas de log
consulta = ConsultaRucConCache(ConsultaRucConLog(http))   → 1 línea de log
```

Ninguna es incorrecta: una mide el uso, la otra las llamadas reales a la API. Pero hay que elegir a propósito. Con decoradores de funciones pasa lo mismo: el más cercano a `def` se aplica primero.

## Cuándo no

Si el comportamiento extra es parte esencial de la clase, va en la clase. El decorador es para lo transversal: medición, caché, reintentos, permisos, logs. Y una pila de seis envoltorios es difícil de depurar: los errores aparecen con un traceback que atraviesa todas las capas.

> **Quedate con esto**
> En funciones, `@decorador` con `functools.wraps` y `ParamSpec` para conservar nombre y firma. En objetos, una clase que envuelve a otra con la misma interfaz, ideal para caché, logs y reintentos sobre clientes de APIs. El orden de los envoltorios cambia el resultado: elegilo a propósito.
