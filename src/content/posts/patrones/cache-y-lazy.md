---
title: "Cache-aside, memoización y carga perezosa"
description: El producto más visto leído de Redis en lugar de la base, el tipo de cambio calculado una vez por fecha, y el cache en un método que nunca libera su objeto.
date: 2026-10-19
topic: Backend
tags: [python, patrones, rendimiento]
goal: No repetir trabajo caro, y no hacerlo hasta que haga falta.
course: patrones-python
section: rendimiento
order: 1
---

Tres patrones con una misma idea: el trabajo más rápido es el que no se hace. Cache-aside y memoización evitan **repetirlo**; la carga perezosa evita hacerlo **antes de tiempo**.

## Cache-aside: Redis delante de la base

La página del producto más vendido se pide cien veces por minuto, y cada vez consulta la base. Con **cache-aside**, la aplicación mira primero el cache; si no está, lo lee de la base y lo deja guardado:

```python productos.py
def producto(sku: str) -> dict[str, str]:
    clave = f"producto:{sku}"
    if (guardado := redis.get(clave)) is not None:
        return json.loads(guardado)
    datos = leer_producto_de_la_base(sku)
    redis.set(clave, json.dumps(datos), ex=300)
    return datos


def actualizar_precio(sku: str, precio: str) -> None:
    # ... UPDATE en la base ...
    redis.delete(f"producto:{sku}")
```

```text Terminal
cache-aside: 100 lecturas, 1 a la base, 0.06s, TTL 300s
después de invalidar: 2 consultas a la base
```

Cien lecturas, una consulta. Las decisiones que importan:

- **`ex=300` es el TTL**: a los cinco minutos la clave expira sola. Aunque algo falle al invalidar, el dato viejo no dura para siempre.
- **Al escribir, se borra la clave**, no se actualiza. La próxima lectura la vuelve a llenar desde la base. Escribir el valor nuevo en el cache abre una carrera: dos actualizaciones simultáneas pueden dejarlo con el valor equivocado.
- **El cache es opcional.** Si Redis no responde, la aplicación tiene que seguir funcionando contra la base, más lenta. Un cache que tumba la aplicación al caerse es una dependencia más, no una optimización.

Lo que se cachea: lo que se lee mucho más de lo que cambia y puede estar unos minutos desactualizado. Un catálogo, sí. El stock en el checkout, no.

## Memoización: el resultado de una función pura

Si una función devuelve siempre lo mismo para los mismos argumentos, su resultado se guarda la primera vez. `functools` lo trae:

```python tipo_de_cambio.py
@lru_cache(maxsize=1024)
def tipo_de_cambio(fecha: str) -> float:
    ...
```

```text Terminal · 50 llamadas con la misma fecha
memoización: 0.10s, CacheInfo(hits=49, misses=1, maxsize=1024, currsize=1)
```

Una sola llamada real; las otras 49 salieron del cache. `cache_info()` sirve para confirmar que el cache se usa.

- **`@cache`** no tiene límite. Con argumentos que se repiten poco, crece hasta llenar la memoria.
- **`@lru_cache(maxsize=N)`** descarta lo menos usado cuando se llena. El que conviene casi siempre.
- **Los argumentos tienen que ser hashables**: un `dict` o una lista no sirven como argumento.
- **El cache vive en el proceso.** Con cuatro workers de Gunicorn hay cuatro caches, y reiniciar los vacía. Para compartir, Redis.

Y solo para funciones puras: memoizar una función que lee la hora o la base devuelve datos viejos sin aviso. El tipo de cambio de una fecha pasada no cambia; el de hoy, sí.

### La trampa: cache en un método

```python reporte.py
class Reporte:
    @cache
    def total(self) -> int:
        return sum(self.filas)
```

```text Terminal
Reporte liberado: False (cache en el método lo retiene)
```

El cache guarda `self` como parte de la clave, y el cache es global, de la función. **Ningún `Reporte` se libera nunca**: cada uno que llamó a `total()` queda en memoria para siempre. Ruff lo marca como B019. Para cachear por instancia está `cached_property`.

## Carga perezosa: recién cuando se usa

`cached_property` calcula un atributo la primera vez que se lee y lo guarda en la instancia:

```python reporte.py
class Reporte:
    @cached_property
    def filas(self) -> list[int]:
        print("  calculando filas (una vez)")
        return list(range(100_000))
```

```text Terminal · r.filas leído dos veces
  calculando filas (una vez)
```

Si nadie lee `filas`, nunca se calcula. Si se lee dos veces, se calcula una. Y se libera con el objeto.

La otra forma es la **importación perezosa**. Una dependencia pesada que se usa en una sola función se importa adentro de esa función:

```python exportar.py
def exportar_excel(filas: list[dict[str, str]], ruta: str) -> None:
    import pandas as pd

    pd.DataFrame(filas).to_excel(ruta, index=False)
```

```text Terminal · con el módulo importado, sin llamar a exportar_excel
lazy import: 'pandas' in sys.modules = False
```

pandas tarda en importarse; con esto, solo lo paga quien exporta. Sirve para comandos de consola y funciones serverless, donde el tiempo de arranque se nota en cada ejecución.

El lado oscuro de la carga perezosa es el **N+1** de los ORM: una relación que se carga recién al leerla, dentro de un bucle de cien pedidos, son cien consultas. Ahí lo perezoso sale caro, y se carga todo junto con `selectinload` en SQLAlchemy o `prefetch_related` en Django.

> **Quedate con esto**
> Cache-aside: leé del cache, si no está andá a la base y guardalo con TTL; al escribir, borrá la clave. El cache tiene que poder caerse sin tumbar nada. Memoizá funciones puras con `lru_cache`, nunca métodos: retienen `self` para siempre. La carga perezosa, con `cached_property` o un import adentro de la función, posterga el trabajo hasta que hace falta, salvo dentro de un bucle.
