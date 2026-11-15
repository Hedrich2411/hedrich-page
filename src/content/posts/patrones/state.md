---
title: "State"
description: Los estados de un pedido con una tabla de transiciones, y una suscripción cuyo comportamiento cambia según el estado, con una clase por estado.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Modelar objetos que cambian de comportamiento según su estado sin una cadena de if.
course: patrones-python
section: comportamiento
order: 4
---

Un pedido pasa por pendiente, pagado, enviado y entregado, y en el camino se puede cancelar. Uno enviado no se cancela; uno entregado no cambia más. Si cada método del pedido revisa el estado con `if`, las reglas quedan repartidas y alguna se olvida.

Hay dos formas de resolverlo, según cuánto cambie el comportamiento entre estados.

## Una tabla de transiciones

Cuando los estados solo restringen **qué cambios se permiten**, una tabla alcanza:

```python pedidos.py
class EstadoPedido(StrEnum):
    PENDIENTE = "pendiente"
    PAGADO = "pagado"
    ENVIADO = "enviado"
    ENTREGADO = "entregado"
    CANCELADO = "cancelado"


TRANSICIONES: dict[EstadoPedido, set[EstadoPedido]] = {
    EstadoPedido.PENDIENTE: {EstadoPedido.PAGADO, EstadoPedido.CANCELADO},
    EstadoPedido.PAGADO: {EstadoPedido.ENVIADO, EstadoPedido.CANCELADO},
    EstadoPedido.ENVIADO: {EstadoPedido.ENTREGADO},
    EstadoPedido.ENTREGADO: set(),
    EstadoPedido.CANCELADO: set(),
}


class Pedido:
    def __init__(self, numero: str) -> None:
        self.numero = numero
        self.estado = EstadoPedido.PENDIENTE

    def pasar_a(self, nuevo: EstadoPedido) -> None:
        if nuevo not in TRANSICIONES[self.estado]:
            raise TransicionInvalida(f"{self.numero}: no se puede pasar de {self.estado} a {nuevo}")
        self.estado = nuevo
```

```text Terminal
P-1042: no se puede pasar de enviado a cancelado
```

Toda la máquina de estados entra en una pantalla, se puede dibujar y se puede probar recorriendo la tabla. Para la mayoría de los casos, como pedidos, tickets o comprobantes, es lo que conviene.

## El patrón State: una clase por estado

Una suscripción a un software: en **prueba** se puede usar tres veces; **activa**, sin límite; **en gracia** después de vencer, se puede usar con un aviso; **vencida**, no. Lo que cambia no es solo qué transición se permite: es **qué hace cada operación**. Ahí, una clase por estado:

```python suscripcion.py
class Estado:
    def pagar(self, s: "Suscripcion") -> None:
        raise TransicionInvalida(f"no se puede pagar en estado {type(self).__name__}")

    def usar(self, s: "Suscripcion") -> str:
        raise TransicionInvalida(f"no se puede usar en estado {type(self).__name__}")

    def vencer(self, s: "Suscripcion") -> None:
        pass


class Prueba(Estado):
    def pagar(self, s: "Suscripcion") -> None:
        s.estado = Activa()

    def usar(self, s: "Suscripcion") -> str:
        s.usos_de_prueba += 1
        if s.usos_de_prueba > 3:
            s.estado = Vencida()
            raise TransicionInvalida("se terminó la prueba")
        return f"uso de prueba {s.usos_de_prueba} de 3"


class Activa(Estado):
    def usar(self, s: "Suscripcion") -> str:
        return "uso ilimitado"

    def vencer(self, s: "Suscripcion") -> None:
        s.estado = EnGracia()


class Suscripcion:
    def __init__(self) -> None:
        self.estado: Estado = Prueba()
        self.usos_de_prueba = 0

    def usar(self) -> str:
        return self.estado.usar(self)
```

```text Terminal
Prueba → uso de prueba 1 de 3
Prueba → uso de prueba 2 de 3
Prueba → uso de prueba 3 de 3
Vencida → se terminó la prueba
Activa → uso ilimitado
EnGracia → uso permitido, con aviso de pago pendiente
```

`Suscripcion` delega todo en su estado actual, y cada estado decide qué hacer y a cuál pasar. Agregar un estado nuevo, como «suspendida por fraude», es una clase nueva; ningún `if` existente cambia. La clase base define el comportamiento por defecto: si un estado no sobrescribe `pagar` o `usar`, la operación no se permite. `EnGracia` y `Vencida` siguen la misma forma.

## Cuál

| | Tabla de transiciones | Clase por estado |
|---|---|---|
| Los estados cambian | Qué transiciones se permiten | Qué hace cada operación |
| Se lee | De un vistazo | Repartida en clases |
| Se guarda en la base | Directo: el valor del enum | Hay que traducir clase ↔ valor |

La última fila pesa: el estado se guarda en una columna. Con una tabla es un `StrEnum` que va y viene tal cual. Con clases, necesitás un mapeo, `{"prueba": Prueba, ...}`, para reconstruirlo al leer.

Para máquinas grandes, con estados anidados o eventos con condiciones, existe la biblioteca `transitions`.

> **Quedate con esto**
> Si los estados solo limitan qué cambios se permiten, una tabla `dict[Estado, set[Estado]]` con un `StrEnum`: se lee de un vistazo y se guarda tal cual. Si cada estado cambia lo que hacen las operaciones, el patrón State: una clase por estado, con el objeto delegando en el estado actual. En los dos casos, una transición inválida es una excepción, nunca un cambio silencioso.
