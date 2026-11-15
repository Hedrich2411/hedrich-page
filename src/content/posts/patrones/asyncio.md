---
title: "Futures y asyncio"
description: Pedir el tipo de cambio a cuatro bancos y quedarte con el que llega primero, rastrear veinte envíos de a cinco, cortar lo que tarda demasiado y reaccionar a un flujo de precios.
date: 2026-10-19
topic: Backend
tags: [python, patrones, concurrencia]
goal: Lanzar trabajo concurrente, limitarlo y manejar sus errores y tiempos con futures y asyncio.
course: patrones-python
section: concurrencia
order: 2
---

Un **future** es un resultado que todavía no llegó: lanzás el trabajo, recibís el future, y le pedís el resultado cuando lo necesitás. Es la base de los pools de la lección anterior, y de asyncio.

## Futures: lo que llega primero

El tipo de cambio de cuatro bancos, procesado a medida que llega cada uno:

```python tipo_de_cambio.py
with ThreadPoolExecutor() as pool:
    futuros = {pool.submit(tipo_de_cambio, b): b for b in ["BCP", "BBVA", "Interbank", "Scotiabank"]}
    for futuro in as_completed(futuros):
        banco, valor = futuro.result()
        print(f"  llegó {banco}: {valor}")
```

```text Terminal
  llegó Scotiabank: 3.702
  llegó BBVA: 3.692
  llegó BCP: 3.673
  llegó Interbank: 3.7
```

`submit` devuelve un future al instante; `as_completed` los entrega en el orden en que terminan, no en el que se lanzaron. Si el trabajo lanzó una excepción, `futuro.result()` la vuelve a lanzar ahí.

## asyncio: miles de esperas en un hilo

Con hilos, cada espera ocupa un hilo del sistema. **asyncio** hace todas las esperas en un solo hilo: cada `await` le devuelve el control al bucle de eventos, que avanza otra tarea mientras tanto. Sirve para lo mismo que los hilos, esperar I/O, pero escala a miles de conexiones.

Rastrear veinte envíos en la API de un courier que acepta cinco consultas a la vez:

```python tracking.py
async def consultar_tracking(guia: str, limite: asyncio.Semaphore) -> str:
    async with limite:
        await asyncio.sleep(0.2)
        if guia == "G-13":
            raise ConnectionError(f"{guia}: el courier no responde")
        return f"{guia}: en reparto"


async def con_gather(guias: list[str]) -> None:
    limite = asyncio.Semaphore(5)
    resultados = await asyncio.gather(*(consultar_tracking(g, limite) for g in guias), return_exceptions=True)
    errores = [r for r in resultados if isinstance(r, Exception)]
```

```text Terminal
  gather: 20 guías, 1 error, 0.81s (de a 5)
```

- **`Semaphore(5)`** limita cuántas tareas están adentro a la vez. Sin él, salen las veinte juntas y el courier te bloquea.
- **`return_exceptions=True`** devuelve los errores mezclados con los resultados, en lugar de lanzar el primero y perder el resto. Diecinueve guías bien, una con error.

### TaskGroup: todo o nada

Cuando una falla invalida el trabajo entero, `asyncio.TaskGroup`, de Python 3.11, **cancela las tareas pendientes** al primer error:

```python tracking.py
try:
    async with asyncio.TaskGroup() as tg:
        for g in guias:
            tg.create_task(consultar_tracking(g, limite))
except* ConnectionError as grupo:
    print(f"  TaskGroup: canceló el resto; {len(grupo.exceptions)} error: {grupo.exceptions[0]}")
```

```text Terminal
  TaskGroup: canceló el resto; 1 error: G-13: el courier no responde
```

Los errores llegan agrupados en un `ExceptionGroup`, y `except*` atrapa los de un tipo. `gather` para «quiero todo lo que se pueda»; `TaskGroup` para «si algo falla, paro todo».

### Cortar lo que tarda

Ninguna llamada externa debería esperar indefinidamente:

```python Uso
try:
    async with asyncio.timeout(0.5):
        await lento()
except TimeoutError:
    print("  timeout: cortado a los 0.5 s")
```

```text Terminal
  timeout: cortado a los 0.5 s
```

### La regla de oro

Una sola llamada bloqueante, como `time.sleep`, `requests.get` o un driver de base síncrono, **congela el bucle entero**: todas las tareas esperan. Dentro de código async se usan bibliotecas async, como `httpx` o `asyncpg`, y lo que no tenga versión async se manda a un hilo con `await asyncio.to_thread(funcion, args)`.

## Programación reactiva: flujos de eventos

Un precio que cambia, mensajes de un websocket, líneas de un log: datos que **llegan solos**, y el código reacciona a cada uno. Es [Observer](/blog/patrones/observer) aplicado a un flujo. En asyncio, un generador asíncrono:

```python alertas.py
async def precios_en_vivo() -> AsyncIterator[float]:
    for precio in (3.701, 3.712, 3.698, 3.735, 3.740):
        await asyncio.sleep(0.05)
        yield precio


async def alertas() -> None:
    async for precio in precios_en_vivo():
        if precio > 3.73:
            print(f"  alerta: dólar a {precio}")
```

```text Terminal
  alerta: dólar a 3.735
  alerta: dólar a 3.74
```

En la vida real, `precios_en_vivo` lee de un websocket. Para combinar flujos con operadores como filtrar, agrupar por ventana de tiempo o descartar repetidos, existe RxPY, la versión Python de ReactiveX.

## Actores y paso de mensajes

Dos modelos más que aparecen en sistemas concurrentes:

- **Actor**: un objeto con estado propio y una cola de mensajes, que los procesa de a uno. Nadie toca su estado desde afuera, así que no hacen falta locks. En asyncio, una tarea que lee de su `asyncio.Queue`.
- **Paso de mensajes**: las partes no comparten memoria, se mandan mensajes. Es el [modelo de workers](/blog/patrones/hilos-y-procesos) con una cola, y lo que hacen los procesos con `multiprocessing.Queue`.

La idea común: **compartir memoria entre hilos obliga a sincronizar**; mandar mensajes, no.

> **Quedate con esto**
> Un future es un resultado pendiente; `as_completed` te los da a medida que terminan. asyncio hace miles de esperas en un hilo: limitá con `Semaphore`, juntá con `gather` si querés todo lo posible o con `TaskGroup` si una falla cancela el resto, y poné `timeout` a cada llamada externa. Nunca bloquees el bucle: lo síncrono va a `to_thread`. Los flujos se consumen con `async for`.
