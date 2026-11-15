---
title: "Retry y Circuit Breaker"
description: Reintentar el envío de un comprobante al PSE con espera exponencial y jitter, dejar de insistir cuando el servicio está caído, y los patrones para transacciones entre servicios.
date: 2026-10-19
topic: Backend
tags: [python, patrones, distribuidos]
goal: Tolerar fallas transitorias de servicios externos sin empeorarlas, y coordinar operaciones que cruzan servicios.
course: patrones-python
section: distribuidos
order: 2
---

Enviar un comprobante al PSE, el proveedor que lo valida ante SUNAT, falla a veces: un timeout, una conexión cortada. La mayoría de esas fallas se arreglan solas en segundos. Dos patrones las manejan: **Retry** insiste cuando vale la pena, y **Circuit Breaker** deja de insistir cuando no.

## Retry: espera exponencial con jitter

```python resiliencia.py
def reintentar[**P, R](
    intentos: int = 4, base: float = 0.1, tope: float = 2.0, ante: tuple[type[Exception], ...] = (ConnectionError, TimeoutError)
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorador(funcion: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(funcion)
        def envoltura(*args: P.args, **kwargs: P.kwargs) -> R:
            for intento in range(1, intentos + 1):
                try:
                    return funcion(*args, **kwargs)
                except ante as error:
                    if intento == intentos:
                        raise
                    espera = random.uniform(0, min(tope, base * 2**intento))
                    print(f"  intento {intento} falló ({error}); espero {espera:.2f}s")
                    time.sleep(espera)
            raise AssertionError("inalcanzable")

        return envoltura

    return decorador


@reintentar()
def enviar_al_pse(numero: str) -> str: ...
```

```text Terminal
  intento 1 falló (timeout); espero 0.05s
  intento 2 falló (timeout); espero 0.22s
  F001-42 aceptado
  sin reintentos para un error que no es transitorio: RUC del receptor inválido
```

Cada parte evita un problema concreto:

- **Solo errores transitorios.** `ante` lista los que vale la pena reintentar. Un RUC inválido va a seguir siendo inválido: reintentarlo es perder tiempo y llenar el log.
- **Espera exponencial**: 0.2, 0.4, 0.8 s como máximo. Si el servicio está saturado, reintentar al instante lo satura más.
- **Jitter**: la espera es un número **al azar** entre cero y ese máximo. Sin él, mil clientes que fallaron juntos reintentan juntos, y vuelven a tumbar el servicio en el mismo instante.
- **Un tope de intentos y de espera.** El último error se relanza; nadie espera para siempre.

Y la condición previa: **la operación tiene que ser idempotente**. Si el primer intento llegó al PSE pero la respuesta se perdió, el reintento manda el comprobante otra vez. El PSE lo tiene que reconocer por su número y no duplicarlo. Si la operación no es idempotente, como un cobro, se manda con una clave de idempotencia que el servidor recuerda.

En proyectos reales, la biblioteca `tenacity` trae todo esto configurable; el decorador de arriba es lo que hace por dentro.

## Circuit Breaker: dejar de insistir

Si el PSE está caído una hora, cada envío espera sus timeouts y sus reintentos: los workers quedan ocupados esperando algo que no va a responder. Un **interruptor** cuenta las fallas, y al pasar un umbral **se abre**: las llamadas fallan al instante sin intentar.

```python resiliencia.py
class Interruptor:
    def __init__(self, fallas_para_abrir: int, segundos_abierto: float) -> None:
        self._umbral = fallas_para_abrir
        self._espera = segundos_abierto
        self.estado = Estado.CERRADO
        self._fallas = 0
        self._abierto_desde = 0.0

    def llamar[R](self, funcion: Callable[[], R]) -> R:
        if self.estado is Estado.ABIERTO:
            if time.monotonic() - self._abierto_desde < self._espera:
                raise CircuitoAbierto("PSE caído: no se intenta")
            self.estado = Estado.SEMIABIERTO
        try:
            resultado = funcion()
        except Exception:
            self._fallar()
            raise
        self.estado = Estado.CERRADO
        self._fallas = 0
        return resultado

    def _fallar(self) -> None:
        self._fallas += 1
        if self.estado is Estado.SEMIABIERTO or self._fallas >= self._umbral:
            self.estado = Estado.ABIERTO
            self._abierto_desde = time.monotonic()
```

```text Terminal · Interruptor(fallas_para_abrir=3, segundos_abierto=1.0)
  llamada 1: ConnectionError 0.30s  → cerrado
  llamada 2: ConnectionError 0.30s  → cerrado
  llamada 3: ConnectionError 0.30s  → abierto
  llamada 4: CircuitoAbierto 0.00s  → abierto
  llamada 5: CircuitoAbierto 0.00s  → abierto
  llamada 6: CircuitoAbierto 0.00s  → abierto
  después de 1 s, PSE recuperado: aceptado → cerrado
```

Tres estados, que son un [State](/blog/patrones/state):

- **Cerrado**: las llamadas pasan y se cuentan las fallas.
- **Abierto**: falla al instante. De 0.3 s por llamada pasó a 0. Los comprobantes quedan en la cola para después, y el servicio caído no recibe más carga.
- **Semiabierto**: pasado el tiempo, deja pasar **una** llamada de prueba. Si anda, cierra; si falla, vuelve a abrir.

Los dos patrones se combinan: el reintento va **dentro** del interruptor, así un servicio caído no acumula reintentos.

## Transacciones entre servicios

Con [microservicios](/blog/patrones/mvc-microservicios-serverless), «cobrar y descontar stock» deja de ser un `COMMIT`. Tres patrones para eso:

- **Two-phase commit (2PC)**: un coordinador pregunta a todos «¿podés confirmar?» y, si todos dicen que sí, ordena confirmar. Garantiza atomicidad, pero si el coordinador cae a mitad, todos quedan bloqueados esperando. Casi no se usa entre servicios HTTP.
- **Saga**: una secuencia de pasos locales, cada uno con su **compensación**. Si el paso tres falla, se ejecutan las compensaciones del dos y del uno: se reembolsa el pago, se devuelve el stock. No hay atomicidad, hay consistencia eventual, y la compensación es una acción de negocio, como una nota de crédito.
- **Sidecar**: un proceso que corre al lado de cada servicio y le resuelve lo transversal: reintentos, circuit breaker, TLS, métricas. Es lo que hacen los service mesh como Istio o Linkerd en Kubernetes, para no repetir este código en cada servicio y cada lenguaje.

> **Quedate con esto**
> Reintentá solo errores transitorios, con espera exponencial, jitter y un tope, y solo operaciones idempotentes. Un circuit breaker deja de llamar a un servicio caído y prueba con una sola llamada después de un tiempo. Entre servicios no hay transacciones: una saga con compensaciones reemplaza al `ROLLBACK`.
