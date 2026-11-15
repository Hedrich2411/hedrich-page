---
title: "Throttling"
description: Respetar el límite de llamadas por segundo de una API externa con una cubeta de fichas, y frenar con 429 a una IP que manda pedidos de más.
date: 2026-10-19
topic: Backend
tags: [python, patrones, distribuidos]
goal: Limitar cuántas operaciones se hacen por unidad de tiempo, tanto hacia afuera como hacia adentro.
course: patrones-python
section: distribuidos
order: 1
---

El **throttling** limita cuántas operaciones pasan por segundo. Se usa en dos direcciones:

- **Hacia afuera**: la API de un courier acepta 10 llamadas por segundo. Si mandás más, te bloquea.
- **Hacia adentro**: tu API no puede dejar que un solo cliente, o un bot, consuma toda la capacidad.

## La cubeta de fichas

El algoritmo más usado es el **token bucket**: una cubeta con capacidad para N fichas, que se recarga a un ritmo fijo. Cada operación gasta una ficha; sin fichas, se espera o se rechaza. La capacidad permite **ráfagas cortas**, y el ritmo de recarga fija el promedio.

```python limites.py
class CubetaDeFichas:
    def __init__(self, por_segundo: float, rafaga: int) -> None:
        self._por_segundo = por_segundo
        self._capacidad = rafaga
        self._fichas = float(rafaga)
        self._ultima = time.monotonic()
        self._candado = threading.Lock()

    def _recargar(self) -> None:
        ahora = time.monotonic()
        self._fichas = min(self._capacidad, self._fichas + (ahora - self._ultima) * self._por_segundo)
        self._ultima = ahora

    def intentar(self) -> bool:
        with self._candado:
            self._recargar()
            if self._fichas >= 1:
                self._fichas -= 1
                return True
            return False

    def esperar(self) -> None:
        while True:
            with self._candado:
                self._recargar()
                if self._fichas >= 1:
                    self._fichas -= 1
                    return
                falta = (1 - self._fichas) / self._por_segundo
            time.sleep(falta)
```

Detalles que no son opcionales:

- **`time.monotonic()`**, no `time.time()`. El reloj del sistema puede saltar hacia atrás cuando se sincroniza con NTP, y la cuenta de fichas se rompe.
- **El `Lock`**: varios hilos comparten la cubeta. Sin él, dos hilos leen «queda una ficha» al mismo tiempo y las dos pasan.
- **`esperar` duerme fuera del candado**, para no bloquear a los demás hilos mientras espera.

## Hacia afuera: esperar

Antes de cada llamada al courier, `esperar()`:

```text Terminal · 25 llamadas con CubetaDeFichas(por_segundo=10, rafaga=5)
25 llamadas a 10/s con ráfaga de 5: 2.00s
  primeras 6: 0.00 0.00 0.00 0.00 0.00 0.10
```

Las primeras cinco salieron juntas, porque la cubeta empezó llena. Desde la sexta, una cada 0.1 s. Veinte llamadas a 10 por segundo son dos segundos, exactos.

Si la API igual responde **429 Too Many Requests**, mirá el encabezado `Retry-After`: dice cuántos segundos esperar antes de volver a intentar.

## Hacia adentro: rechazar

Para tu propia API, una cubeta por cliente, por IP o por token, y rechazar con 429 en lugar de esperar:

```python limites.py
por_ip: dict[str, CubetaDeFichas] = {}


def permitir(ip: str) -> bool:
    cubeta = por_ip.setdefault(ip, CubetaDeFichas(por_segundo=1, rafaga=10))
    return cubeta.intentar()
```

```text Terminal
30 pedidos seguidos de una IP: 10 aceptados, 20 con 429
```

Diez pasaron, la ráfaga; los otros veinte llegaron demasiado rápido.

Esta versión tiene dos límites que en producción importan:

- **Vive en un proceso.** Con cuatro workers o tres servidores, cada uno tiene su cubeta y el límite real se multiplica. La cubeta va en Redis, con un script atómico, para que todas las instancias compartan la cuenta.
- **El diccionario crece sin límite**: una entrada por IP que alguna vez llegó. Con Redis se resuelve con el TTL de cada clave.

Por eso, en la práctica, el límite hacia adentro se pone en el borde: Nginx con `limit_req`, el API Gateway del proveedor de nube, o un middleware como `slowapi` para FastAPI con Redis detrás. Escribir la cubeta sirve para entender qué configurás.

> **Quedate con esto**
> La cubeta de fichas permite ráfagas de N y un promedio de M por segundo. Hacia afuera, esperá antes de llamar y respetá `Retry-After`; hacia adentro, rechazá con 429. Usá `time.monotonic()` y un lock. Con más de un proceso, la cuenta tiene que estar en Redis, o en el proxy delante de la aplicación.
