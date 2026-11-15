---
title: "Chain of Responsibility"
description: La aprobación de órdenes de compra según el monto pasando por jefe, gerente y directorio, y por qué los middlewares de cualquier framework web son este mismo patrón.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Pasar un pedido por una cadena de manejadores donde cada uno decide si lo resuelve o lo deriva.
course: patrones-python
section: comportamiento
order: 5
---

Las órdenes de compra se aprueban según el monto: hasta S/ 5 000 el jefe de compras, hasta S/ 50 000 el gerente, más que eso el directorio. Y si el proveedor es nuevo, el jefe no puede aprobar, sin importar el monto.

**Chain of Responsibility** pasa el pedido por una cadena: cada eslabón lo resuelve o lo deriva al siguiente.

## La cadena de aprobación

```python aprobaciones.py
class Aprobador:
    def __init__(self, cargo: str, limite: Decimal | None, siguiente: "Aprobador | None" = None) -> None:
        self.cargo = cargo
        self.limite = limite
        self.siguiente = siguiente

    def aprobar(self, orden: OrdenDeCompra) -> str:
        if self.puede(orden):
            return f"{orden.numero} (S/ {orden.monto:,}) la aprueba {self.cargo}"
        if self.siguiente is None:
            raise LookupError(f"nadie puede aprobar {orden.numero}")
        return self.siguiente.aprobar(orden)

    def puede(self, orden: OrdenDeCompra) -> bool:
        return self.limite is None or orden.monto <= self.limite


class Compras(Aprobador):
    def puede(self, orden: OrdenDeCompra) -> bool:
        return not orden.proveedor_nuevo and super().puede(orden)


cadena = Compras("jefe de compras", Decimal(5_000),
                 Aprobador("gerente", Decimal(50_000),
                           Aprobador("directorio", None)))
```

```text Terminal
OC-101 (S/ 1,200) la aprueba jefe de compras
OC-102 (S/ 18,500) la aprueba gerente
OC-103 (S/ 1,200) la aprueba gerente
OC-104 (S/ 240,000) la aprueba directorio
```

La OC-103 es de S/ 1 200, pero con un proveedor nuevo: el jefe la deriva y la aprueba el gerente. La regla especial vive en `Compras`, sin tocar a los demás.

Lo que gana la cadena:

- **Quien pide no sabe quién resuelve.** El sistema llama a `cadena.aprobar(orden)`.
- **La cadena se arma con configuración.** Si mañana aparece un subgerente entre jefe y gerente, se agrega un eslabón.
- **El final está definido.** Si nadie puede, `LookupError`. Una cadena que termina en silencio pierde pedidos.

## Los middlewares son una cadena

Cada framework web es una cadena de responsabilidad: el pedido HTTP pasa por autenticación, registro, compresión, y cada middleware decide si sigue o corta. En su forma más simple, una función que recibe el pedido y al siguiente:

```python middlewares.py
def autenticacion(pedido: dict[str, str], siguiente: Manejador) -> str:
    if "token" not in pedido:
        return "401 sin token"
    return siguiente(pedido)


def registro(pedido: dict[str, str], siguiente: Manejador) -> str:
    respuesta = siguiente(pedido)
    print(f"  log: {pedido.get('ruta')} → {respuesta}")
    return respuesta


def armar(manejador: Manejador, *middlewares: Middleware) -> Manejador:
    for middleware in reversed(middlewares):
        manejador = (lambda m, s: lambda p: m(p, s))(middleware, manejador)
    return manejador


app = armar(lambda p: "200 ok", registro, autenticacion)
```

```text Terminal
  log: /reportes → 200 ok
  log: /reportes → 401 sin token
```

`autenticacion` corta la cadena cuando falta el token; `registro` la deja seguir y actúa a la vuelta, con la respuesta. Es exactamente el `@app.middleware("http")` de FastAPI, o los middlewares de Django: el orden en que se declaran es el orden de la cadena, y cambiarlo cambia el resultado. Si `registro` estuviera después de `autenticacion`, los pedidos rechazados no quedarían en el log.

## Cuándo no

Si siempre resuelve el mismo manejador según una condición simple, como un tipo de documento, un diccionario de manejadores es más directo. La cadena brilla cuando **cada eslabón decide con su propio criterio**, y el orden importa.

> **Quedate con esto**
> Una cadena pasa el pedido de eslabón en eslabón hasta que uno lo resuelve, y quien pide no sabe quién. Cada eslabón tiene su criterio y la cadena se arma por configuración. Definí qué pasa si nadie lo resuelve. Los middlewares web son este patrón, y su orden es el orden de la cadena.
