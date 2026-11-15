---
title: "Adapter y Facade"
description: Dos SDK de pago con APIs incompatibles detrás de una sola interfaz, y un checkout que esconde inventario, cobro, facturación y correo detrás de un método.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Aislar el código de las APIs de terceros y simplificar el uso de subsistemas complejos.
course: patrones-python
section: estructurales
order: 1
---

Los dos patrones envuelven código existente. **Adapter** traduce una interfaz que no encaja a la que tu código espera. **Facade** ofrece una entrada simple a varias piezas que hay que usar juntas.

## Adapter: dos SDK, una interfaz

Cada pasarela trae su SDK, y no se parecen en nada:

```python sdks.py · Código de terceros, que no podés cambiar
class SdkTarjetas:
    def create_charge(self, amount: int, currency: str, source: str) -> dict[str, Any]:
        return {"id": "ch_9f2", "status": "succeeded", "amount": amount}


class SdkBilletera:
    def pagar(self, celular: str, importe: str) -> tuple[bool, str]:
        return (True, "OP-55120")
```

Uno quiere céntimos enteros y devuelve un dict; el otro, soles como texto y devuelve una tupla. Tu código quiere una sola cosa:

```python pagos.py
@dataclass(frozen=True)
class Cobro:
    aprobado: bool
    referencia: str


class Pasarela(Protocol):
    def cobrar(self, monto: Decimal, medio: str) -> Cobro: ...


class AdaptadorTarjetas:
    def __init__(self, sdk: SdkTarjetas) -> None:
        self._sdk = sdk

    def cobrar(self, monto: Decimal, medio: str) -> Cobro:
        centimos = int((monto * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        respuesta = self._sdk.create_charge(amount=centimos, currency="PEN", source=medio)
        return Cobro(respuesta["status"] == "succeeded", respuesta["id"])


class AdaptadorBilletera:
    def __init__(self, sdk: SdkBilletera) -> None:
        self._sdk = sdk

    def cobrar(self, monto: Decimal, medio: str) -> Cobro:
        ok, operacion = self._sdk.pagar(celular=medio, importe=f"{monto:.2f}")
        return Cobro(ok, operacion)
```

```text Terminal
AdaptadorTarjetas Cobro(aprobado=True, referencia='ch_9f2')
AdaptadorBilletera Cobro(aprobado=True, referencia='OP-55120')
```

Las rarezas de cada proveedor, como los céntimos, el formato del importe o qué significa `"succeeded"`, quedan en un solo archivo. Cuando el proveedor saca la versión 3 de su SDK, cambia el adaptador y nada más. Y en los tests se reemplaza la pasarela entera por un fake que cumple el mismo `Protocol`.

El adaptador también **traduce errores**: las excepciones propias del SDK se convierten en las tuyas, para que el resto del código no tenga que importar nada del proveedor.

## Facade: el checkout

Pagar una compra toca cuatro subsistemas, en orden, y con una compensación si el cobro falla:

```python checkout.py
class Checkout:
    def __init__(self, inventario: Inventario, pasarela: Pasarela, facturacion: Facturacion, correo: Correo) -> None:
        self._inventario = inventario
        self._pasarela = pasarela
        self._facturacion = facturacion
        self._correo = correo

    def pagar(self, compra: Compra) -> str:
        self._inventario.reservar(compra.sku, compra.cantidad)
        cobro = self._pasarela.cobrar(compra.monto, compra.medio)
        if not cobro.aprobado:
            self._inventario.liberar(compra.sku, compra.cantidad)
            raise RuntimeError("pago rechazado")
        boleta = self._facturacion.emitir_boleta(compra.cliente, compra.monto)
        self._correo.enviar(compra.correo, f"Gracias por tu compra, boleta {boleta}")
        return boleta
```

```text Terminal
  inventario: reservadas 2 de POLO-M
  facturación: boleta para Ana Quispe por S/ 71.00
  correo a ana@correo.pe: Gracias por tu compra, boleta B001-118
  → B001-118
```

El endpoint de la API, el CLI y el job nocturno llaman a `checkout.pagar(compra)`. El orden de los pasos y la liberación del stock si el pago falla viven en un solo lugar.

Una fachada **no prohíbe** usar los subsistemas directamente: el reporte de stock sigue hablando con `Inventario`. Solo da un camino corto para el caso común. Si la fachada empieza a tener veinte métodos, dejó de ser una fachada y se convirtió en un objeto que hace todo.

En el [curso de Clean Architecture](/blog/clean-architecture/casos-de-uso), los casos de uso cumplen este papel, y los adaptadores son exactamente este patrón.

> **Quedate con esto**
> Un adaptador traduce una API de terceros, sus datos y sus errores, a la interfaz que tu código espera, y deja las rarezas del proveedor en un solo archivo. Una fachada ofrece un método simple para una operación que coordina varios subsistemas, sin impedir usarlos por separado.
