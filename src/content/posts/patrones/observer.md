---
title: "Observer"
description: Cuando un pedido se paga, tres partes del sistema tienen que enterarse. Suscriptores que no se conocen, una falla que no frena a los demás, y la pérdida de memoria que causan los suscriptores olvidados.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Notificar cambios a quien le interese sin que el emisor conozca a los receptores.
course: patrones-python
section: comportamiento
order: 2
---

Cuando un pedido se paga, hay que mandar el comprobante, descontar stock y registrar la venta en analítica. Si el código del pago llama a las tres cosas, cada reacción nueva lo obliga a cambiar. Con **Observer**, el pago avisa «pasó esto» y quien quiera se suscribe.

## Un evento

```python eventos.py
class Evento[T]:
    def __init__(self, nombre: str) -> None:
        self.nombre = nombre
        self._suscriptores: list[Callable[[T], None]] = []

    def suscribir(self, funcion: Callable[[T], None]) -> Callable[[T], None]:
        self._suscriptores.append(funcion)
        return funcion

    def emitir(self, dato: T) -> None:
        for funcion in list(self._suscriptores):
            try:
                funcion(dato)
            except Exception:
                log.exception("falló %s al reaccionar a %s", funcion.__name__, self.nombre)
```

`suscribir` devuelve la función, así que sirve como decorador:

```python reacciones.py
pedido_pagado: Evento[PedidoPagado] = Evento("pedido_pagado")


@pedido_pagado.suscribir
def enviar_comprobante(e: PedidoPagado) -> None:
    print(f"  correo: comprobante de {e.numero} a {e.cliente}")


@pedido_pagado.suscribir
def descontar_stock(e: PedidoPagado) -> None:
    raise ConnectionError("el servicio de inventario no responde")


@pedido_pagado.suscribir
def registrar_venta(e: PedidoPagado) -> None:
    print(f"  analítica: venta de S/ {e.total}")
```

```text Terminal · pedido_pagado.emitir(PedidoPagado("P-1042", "ana@correo.pe", Decimal("71.00")))
ERROR falló descontar_stock al reaccionar a pedido_pagado
Traceback (most recent call last):
  ...
ConnectionError: el servicio de inventario no responde
  correo: comprobante de P-1042 a ana@correo.pe
  analítica: venta de S/ 71.00
```

Tres decisiones que importan:

- **Una falla no frena a los demás.** El inventario caído no impide el correo ni la analítica. El `except Exception` es amplio a propósito, y por eso registra el traceback completo.
- **`list(self._suscriptores)`** recorre una copia: un suscriptor que se desuscribe mientras se emite no rompe el bucle.
- **El dato del evento es inmutable**, un dataclass `frozen`: ningún suscriptor le puede cambiar el pedido a los siguientes.

## La pérdida de memoria clásica

Si un objeto se suscribe con un método, `self.actualizar`, la lista del evento guarda una referencia al objeto. El objeto **nunca se libera** aunque nadie más lo use, y cada pantalla o conexión que se suscribió y se olvidó queda viva para siempre.

`weakref.WeakMethod` guarda una referencia débil, que no impide liberar el objeto:

```python eventos.py
class EventoDebil[T]:
    def __init__(self) -> None:
        self._metodos: list[weakref.WeakMethod] = []

    def suscribir_metodo(self, metodo: Callable[[T], None]) -> None:
        self._metodos.append(weakref.WeakMethod(metodo))

    def emitir(self, dato: T) -> None:
        vivos = [(ref, ref()) for ref in self._metodos]
        self._metodos = [ref for ref, m in vivos if m is not None]
        for _, metodo in vivos:
            if metodo is not None:
                metodo(dato)
```

```text Terminal
tablero vivo: 1 suscriptores: 1
tablero borrado, suscriptores: 0
```

Al borrar el tablero, su suscripción desapareció sola.

## Hasta dónde

Un evento en memoria es síncrono y vive en un proceso: si el proceso muere a mitad de las reacciones, se pierden. Para reacciones que **no se pueden perder**, como descontar stock, el evento va a una cola persistente: una tabla *outbox*, Redis, RabbitMQ. Para las que sí, como un aviso, alcanza con esto. Lo mismo que en los [eventos de dominio](/blog/clean-architecture/eventos-de-dominio) del curso de Clean Architecture.

Y una advertencia de diseño: con muchos eventos, seguir qué pasa cuando se paga un pedido obliga a buscar todos los suscriptores. El acoplamiento bajó, pero el flujo quedó repartido. Usalo para reacciones secundarias, no para el camino principal de una operación.

> **Quedate con esto**
> Observer desacopla a quien emite de quien reacciona: un evento con una lista de funciones, que se suscriben con un decorador. Aislá las fallas de cada suscriptor, recorré una copia de la lista y mandá datos inmutables. Los métodos suscritos retienen su objeto: `WeakMethod` evita la fuga. Y si una reacción no se puede perder, el evento va a una cola persistente.
