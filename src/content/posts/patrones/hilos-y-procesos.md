---
title: "Hilos, procesos y el GIL"
description: Consultar veinte RUC en paralelo con un pool de hilos, por qué los hilos no aceleran un cálculo en Python puro, y el modelo de workers con una cola.
date: 2026-10-19
topic: Backend
tags: [python, patrones, concurrencia]
goal: Elegir entre hilos y procesos según si el trabajo espera o calcula, y repartir tareas entre workers con una cola.
course: patrones-python
section: concurrencia
order: 1
---

Antes de paralelizar hay que saber qué hace el trabajo: **¿espera o calcula?** Consultar una API espera la red. Calcular un dígito de control usa el procesador. En Python, la diferencia decide todo.

## El GIL

CPython tiene un **GIL**, *Global Interpreter Lock*: un solo hilo ejecuta código Python a la vez. Mientras un hilo **espera**, sea red, disco o un `sleep`, suelta el GIL y otro avanza. Mientras **calcula** en Python, no lo suelta.

Las mediciones, con Python 3.13 en una máquina de varios núcleos:

```text Terminal
I/O: 20 consultas de 0.2 s
  secuencial                          4.01s
  ThreadPoolExecutor(10)              0.40s
CPU en Python puro: 8 cálculos
  secuencial                          0.53s
  ThreadPoolExecutor(4)               0.53s
  ProcessPoolExecutor(4)              0.26s
CPU en C que suelta el GIL: firmar 8 documentos con pbkdf2
  secuencial                          0.59s
  ThreadPoolExecutor(4)               0.20s
```

Tres resultados:

- **Esperar: hilos.** Veinte consultas de 0.2 s pasaron de 4 s a 0.4 s con diez hilos.
- **Calcular en Python puro: procesos.** Cuatro hilos tardaron lo mismo que uno; cuatro procesos, la mitad. Cada proceso tiene su propio intérprete y su propio GIL.
- **Calcular en C: hilos otra vez.** `hashlib`, NumPy, la compresión con `zlib` sueltan el GIL mientras calculan en C, así que los hilos sí aceleran.

Python 3.13 trae una versión experimental sin GIL, `python3.13t`, y en 3.14 pasó a estar soportada aunque no es la predeterminada. Mientras la versión normal tenga GIL, la regla de arriba sigue en pie.

## Pools: `concurrent.futures`

Crear un hilo o un proceso por tarea es caro y no tiene límite. Un **pool** mantiene un número fijo de workers y les reparte el trabajo:

```python consultas.py
def consultar_ruc(ruc: str) -> str:
    time.sleep(0.2)
    return f"{ruc}: ACTIVO"


with ThreadPoolExecutor(max_workers=10) as pool:
    resultados = list(pool.map(consultar_ruc, rucs))
```

`ProcessPoolExecutor` tiene la misma interfaz. Lo que cambia con procesos:

- **Los argumentos y resultados viajan serializados con `pickle`.** Una función definida dentro de otra, una lambda o una conexión a la base no se pueden mandar.
- **Arrancar procesos cuesta.** En la medición, el pool se calentó con una tarea antes de cronometrar; para trabajos de milisegundos, el arranque se come la ganancia.
- **En Windows y macOS hace falta `if __name__ == "__main__":`**, porque cada proceso nuevo importa el módulo principal.

El tamaño del pool no es «cuantos más, mejor». Para hilos de I/O, el límite real es lo que aguanta el otro lado: una API que permite diez conexiones no va más rápido con cincuenta hilos, te bloquea. Para procesos, el número de núcleos.

## El modelo de workers

Cuando las tareas llegan de a poco, como pedidos que entran a una tienda, un pool con `map` no alcanza. Se arma una **cola** y workers que la vacían:

```python workers.py
def worker(numero: int, tareas: queue.Queue, resultados: list[str]) -> None:
    while True:
        tarea = tareas.get()
        if tarea is None:
            tareas.task_done()
            return
        resultados.append(f"worker {numero} → {consultar_ruc(tarea)}")
        tareas.task_done()


tareas: queue.Queue = queue.Queue(maxsize=100)
hilos = [threading.Thread(target=worker, args=(n, tareas, resultados)) for n in range(3)]
for h in hilos:
    h.start()
for ruc in rucs[:6]:
    tareas.put(ruc)
for _ in hilos:
    tareas.put(None)
tareas.join()
```

```text Terminal
  6 resultados; worker 1 → 20000000002: ACTIVO
```

Qué hace cada pieza:

- **`None` es la señal de terminar**, una por worker. Sin ella, los hilos quedan esperando para siempre.
- **`task_done()` y `join()`**: `join` espera hasta que cada tarea puesta en la cola fue marcada como terminada.
- **`maxsize=100` es contrapresión**: si los workers no dan abasto, `put` se bloquea y frena a quien produce, en lugar de acumular tareas hasta quedarse sin memoria.

El orden de los resultados cambia en cada ejecución: qué worker toma qué tarea depende del sistema operativo. `queue.Queue` ya es segura entre hilos; una lista compartida funciona aquí porque `append` es atómico en CPython, pero para cualquier cosa más compleja que eso, un `threading.Lock`.

Esto es lo que hacen Celery o RQ, con la cola en Redis o RabbitMQ en lugar de en memoria: los workers pueden estar en otras máquinas, y las tareas sobreviven a un reinicio.

> **Quedate con esto**
> Primero preguntá si el trabajo espera o calcula. Si espera, hilos; si calcula en Python puro, procesos, porque el GIL deja ejecutar un solo hilo a la vez; si calcula en C, hilos de nuevo. Usá pools de `concurrent.futures` en lugar de crear hilos a mano. Para tareas que llegan de a poco, una cola con tamaño máximo, workers y una señal de terminar.
