---
title: "Factory Method y Abstract Factory"
description: Elegir la pasarela de pago según la configuración sin un if por proveedor, y armar familias coherentes de objetos para producción y sandbox.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Centralizar la creación de objetos para que el resto del código no dependa de clases concretas.
course: patrones-python
section: creacionales
order: 1
---

La tienda cobra con tarjeta, con billetera digital, y en desarrollo con una pasarela de prueba. Cuál se usa lo decide la configuración. Sin una fábrica, cada lugar que cobra termina con su propio `if`:

```python Mal · la decisión repetida en cada lugar
if config["PASARELA"] == "tarjeta":
    pasarela = PasarelaTarjeta(config["TARJETA_CLAVE"])
elif config["PASARELA"] == "billetera":
    pasarela = PasarelaBilletera(config["BILLETERA_COMERCIO"])
```

## Factory Method: constructores con nombre

En Python, el *factory method* más común es un `@classmethod` que construye la instancia desde otra fuente. La biblioteca estándar está llena: `datetime.fromisoformat`, `dict.fromkeys`, `Path.home`.

```python pasarelas.py
@dataclass
class PasarelaTarjeta:
    clave_secreta: str

    @classmethod
    def desde_config(cls, config: Mapping[str, str]) -> "PasarelaTarjeta":
        return cls(clave_secreta=config["TARJETA_CLAVE"])

    def cobrar(self, monto: Decimal, medio: str) -> str:
        return f"tarjeta:{medio}:{monto}"
```

El constructor recibe lo que la clase necesita; `desde_config` sabe de dónde sacarlo. Así la clase se puede crear en un test con `PasarelaTarjeta("sk_test")`, sin armar una configuración entera.

## Una fábrica con un diccionario

```python pasarelas.py
PASARELAS: dict[str, Callable[[Mapping[str, str]], Pasarela]] = {
    "tarjeta": PasarelaTarjeta.desde_config,
    "billetera": PasarelaBilletera.desde_config,
    "prueba": PasarelaDePrueba.desde_config,
}


def crear_pasarela(nombre: str, config: Mapping[str, str]) -> Pasarela:
    try:
        fabrica = PASARELAS[nombre]
    except KeyError:
        raise ValueError(f"pasarela desconocida: {nombre!r}; disponibles: {', '.join(PASARELAS)}") from None
    return fabrica(config)
```

```text Terminal
billetera:COM-77:999888777:59.00
pasarela desconocida: 'cripto'; disponibles: tarjeta, billetera, prueba
```

Sumar un proveedor es una clase y una línea en el diccionario. El error dice qué opciones hay, que es lo que vas a necesitar a las 3 de la mañana con una variable de entorno mal escrita.

## Abstract Factory: familias que van juntas

En sandbox no alcanza con cambiar la pasarela: los comprobantes no tienen que ir al almacenamiento de producción, ni los correos a clientes reales. Son **familias** de objetos que tienen que ser coherentes entre sí. Una fábrica abstracta crea la familia completa:

```python entornos.py
class Entorno(Protocol):
    def pasarela(self) -> Pasarela: ...
    def almacen(self) -> Almacen: ...
    def notificador(self) -> Notificador: ...


class Sandbox:
    def pasarela(self) -> Pasarela:
        return PasarelaDePrueba()

    def almacen(self) -> Almacen:
        return AlmacenLocal()

    def notificador(self) -> Notificador:
        return CorreoAConsola()


def cerrar_venta(entorno: Entorno, monto: Decimal) -> None:
    cobro = entorno.pasarela().cobrar(monto, "tok_123")
    ruta = entorno.almacen().guardar("F001-42.pdf", b"%PDF")
    entorno.notificador().enviar("cliente@correo.pe", f"Pago {cobro}, comprobante en {ruta}")
```

```text Terminal · cerrar_venta(Sandbox(), Decimal("59.00"))
[sandbox] no se manda a cliente@correo.pe: Pago prueba:59.00, comprobante en /tmp/F001-42.pdf
```

`Produccion` implementa los mismos tres métodos con S3, SMTP y la pasarela real. Es imposible terminar con la pasarela de prueba y el correo real mezclados, que es exactamente el error que se comete configurando pieza por pieza.

## Cuándo no

Si hay una sola implementación, no hace falta fábrica: llamá al constructor. La fábrica aparece cuando la decisión de **qué clase** depende de algo externo, como la configuración o el tipo de dato que llegó.

> **Quedate con esto**
> En Python, el factory method es un `@classmethod` como `desde_config`, y una fábrica es un diccionario de constructores con un error que lista las opciones. Abstract Factory crea familias de objetos que tienen que ir juntos, como todo lo de sandbox o todo lo de producción. Con una sola implementación, el constructor alcanza.
