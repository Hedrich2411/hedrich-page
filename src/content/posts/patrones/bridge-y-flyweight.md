---
title: "Bridge y Flyweight"
description: Tipos de mensaje por canales de envío sin multiplicar clases, y 200 000 ítems que pasan de 66 MB a 24 MB compartiendo lo que tienen en común.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Evitar la explosión de subclases y reducir el consumo de memoria compartiendo objetos inmutables.
course: patrones-python
section: estructurales
order: 4
---

Dos patrones de estructura con objetivos distintos: **Bridge** evita que dos dimensiones que cambian por separado se multipliquen en subclases, y **Flyweight** comparte objetos para ahorrar memoria.

## Bridge: mensajes por canales

El sistema manda recordatorios de pago y alertas, por correo y por SMS. Con herencia serían `RecordatorioPorCorreo`, `RecordatorioPorSms`, `AlertaPorCorreo`, `AlertaPorSms`. Sumar WhatsApp agrega dos clases más; sumar un tipo de mensaje, tres.

El Bridge separa las dos dimensiones y las conecta por composición:

```python mensajes.py
class Canal(Protocol):
    def enviar(self, destino: str, asunto: str, cuerpo: str) -> None: ...


class Mensaje:
    def __init__(self, canal: Canal) -> None:
        self.canal = canal


class Recordatorio(Mensaje):
    def mandar(self, destino: str, factura: str, vence: str) -> None:
        self.canal.enviar(destino, "Recordatorio de pago", f"La factura {factura} vence el {vence}.")


class Alerta(Mensaje):
    def mandar(self, destino: str, detalle: str) -> None:
        self.canal.enviar(destino, "URGENTE", detalle.upper())
```

```text Terminal
  [correo] ana@correo.pe | Recordatorio de pago: La factura F001-42 vence el 31/10.
  [sms] +51999888777 | La factura F001-42 vence el 31/10.
  [sms] +51999888777 | EL PSE NO RESPONDE HACE 15 MINUTOS
```

| | Con herencia | Con Bridge |
|---|---|---|
| 2 mensajes × 2 canales | 4 clases | 2 + 2 |
| 3 mensajes × 3 canales | 9 clases | 3 + 3 |

Qué dice el mensaje y cómo viaja cambian por razones distintas y por personas distintas, y el Bridge los deja crecer por separado. Es el principio de [composición sobre herencia](/blog/patrones/principios) aplicado a dos jerarquías.

## Flyweight: compartir lo común

Un import de 200 000 ítems de catálogo. Cada uno tiene descripción y precio propios, pero la moneda y la unidad de medida son casi siempre las mismas. Si cada ítem crea su propio objeto `Moneda("PEN", "S/", 2)`, hay 200 000 copias idénticas.

El Flyweight comparte esos objetos. Tienen que ser **inmutables**, porque los usan miles a la vez, y se obtienen de una fábrica que devuelve siempre la misma instancia:

```python catalogo.py
@dataclass(frozen=True)
class Moneda:
    codigo: str
    simbolo: str
    decimales: int


@cache
def moneda(codigo: str) -> Moneda:
    return {"PEN": Moneda("PEN", "S/", 2), "USD": Moneda("USD", "US$", 2)}[codigo]
```

```text Terminal · moneda("PEN") is moneda("PEN")
True
```

Medido con `tracemalloc`, creando 200 000 ítems:

```text Terminal
  cada ítem con su moneda y unidad        66.3 MB
  moneda y unidad compartidas             31.2 MB
  compartidas y con __slots__             23.6 MB
```

Compartir moneda y unidad redujo la memoria a menos de la mitad. `@dataclass(slots=True)` la bajó otro cuarto: sin `__slots__`, cada instancia lleva un diccionario para sus atributos; con `__slots__`, los atributos van en lugares fijos.

Python ya hace flyweight por su cuenta con los enteros chicos, los strings cortos que parecen identificadores y `None`, `True` y `False`. Para tus objetos, `@cache` sobre una fábrica, o un `Enum`, cuyos miembros son únicos por definición.

## Cuándo no

Bridge, cuando hay dos dimensiones que de verdad varían; con un solo canal, es ceremonia. Flyweight, cuando hay **muchos** objetos repetidos y la memoria importa; para cien objetos, no vale la complejidad. Medí primero con `tracemalloc`.

> **Quedate con esto**
> Bridge separa dos jerarquías que cambian por separado, como qué se dice y por dónde se manda, y convierte una multiplicación de clases en una suma. Flyweight comparte objetos inmutables entre miles de usos, con una fábrica con `@cache`; sumado a `__slots__`, en el ejemplo bajó la memoria de 66 MB a 24 MB. Los dos, cuando el problema existe y está medido.
