---
title: "Value objects: RUC, números de comprobante y plata"
description: Objetos chicos, inmutables y siempre válidos. Dónde vive la validación del RUC y por qué la plata no es float.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Modelar los valores del negocio para que un dato inválido no pueda existir.
course: clean-architecture-python
section: dominio
order: 1
---

En el endpoint de [la primera lección](/blog/clean-architecture/por-que-clean-architecture) un RUC era un `str`. Eso obliga a cada función que recibe un RUC a preguntarse si alguien ya lo validó. La respuesta suele ser «creo que sí».

Un value object cambia la pregunta: **si tenés un `Documento`, es válido**. No hay forma de construir uno que no lo sea.

## Un error para todo el dominio

```python dominio/errores.py
class ErrorDeDominio(Exception):
    """Una regla de negocio no se cumple. El mensaje es para quien usa el sistema."""
```

Una sola excepción, no `RucInvalidoError`, `SerieInvalidaError` y treinta más que nadie atrapa por separado. Lo que importa es el mensaje, que llega tal cual al usuario, y que la API sepa que es un error de negocio y no un bug. Para eso alcanza una clase.

## El documento del cliente

```python dominio/valores.py · Documento
_FACTORES_RUC = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)


class TipoDocumento(StrEnum):
    DNI = "1"
    RUC = "6"


@dataclass(frozen=True)
class Documento:
    tipo: TipoDocumento
    numero: str

    def __post_init__(self) -> None:
        if self.tipo is TipoDocumento.DNI and not _digitos(self.numero, 8):
            raise ErrorDeDominio(f"DNI inválido: {self.numero}")
        if self.tipo is TipoDocumento.RUC and not _ruc_valido(self.numero):
            raise ErrorDeDominio(f"RUC inválido: {self.numero}")


def _digitos(texto: str, largo: int) -> bool:
    return len(texto) == largo and texto.isascii() and texto.isdigit()


def _ruc_valido(ruc: str) -> bool:
    if not _digitos(ruc, 11):
        return False
    suma = sum(int(d) * f for d, f in zip(ruc, _FACTORES_RUC))
    return int(ruc[-1]) == (11 - suma % 11) % 10
```

**`frozen=True`.** Un RUC no cambia; si cambia, es otro RUC. La inmutabilidad deja pasarlo a cualquier lado sin miedo a que alguien lo modifique a medio camino.

**La validación en `__post_init__`.** Corre en cada construcción. No existe «crear y después validar».

**Igualdad por valor.** `dataclass` genera un `__eq__` que compara campos: dos `Documento` con el mismo tipo y número son iguales aunque sean objetos distintos. Eso es lo que significa «valor».

**`isascii()` antes de `isdigit()`.** `"２0131312955".isdigit()` es `True`: el primer carácter es un 2 de ancho completo, de los que llegan copiando desde un PDF. `int()` lo acepta. Ese RUC guardado así no va a coincidir nunca con el real en una búsqueda.

Los valores `"1"` y `"6"` son los del catálogo 06 de SUNAT. Usar los códigos oficiales como valor del enum ahorra una tabla de traducción al mandar el comprobante.

## El número del comprobante

```python dominio/valores.py · NumeroComprobante
@dataclass(frozen=True)
class NumeroComprobante:
    serie: str
    correlativo: int

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[FB][A-Z0-9]{3}", self.serie):
            raise ErrorDeDominio(f"Serie inválida: {self.serie}")
        if not 1 <= self.correlativo <= 99_999_999:
            raise ErrorDeDominio(f"Correlativo fuera de rango: {self.correlativo}")

    def __str__(self) -> str:
        return f"{self.serie}-{self.correlativo}"

    @classmethod
    def desde_texto(cls, texto: str) -> "NumeroComprobante":
        serie, _, correlativo = texto.partition("-")
        if not (correlativo.isascii() and correlativo.isdigit()):
            raise ErrorDeDominio(f"Número de comprobante inválido: {texto}")
        return cls(serie, int(correlativo))
```

`F001-42` es un concepto del negocio, no un string con un guion. Como objeto, `desde_texto` es el único lugar que sabe parsearlo, y en el resto del código no aparece ningún `split("-")`.

`NumeroComprobante` no sabe si la `F` corresponde a una factura. Eso depende del tipo de comprobante, así que es una regla del comprobante, no del número. Va en la próxima lección.

## La plata no es `float`

```python Python
>>> 0.1 + 0.2
0.30000000000000004
>>> round(2.675, 2)
2.67
```

`2.675` en binario es `2.67499999…`. Aplicado al IGV:

| Valor de venta | IGV con `float` | IGV con `Decimal` |
|---|---|---|
| S/ 10.25 | 1.84 | 1.85 |
| S/ 2.75 | 0.49 | 0.50 |

Un céntimo de diferencia en un documento que SUNAT valida. La solución es `Decimal` con redondeo explícito:

```python dominio/valores.py · redondear
_CENTIMO = Decimal("0.01")


def redondear(monto: Decimal) -> Decimal:
    return monto.quantize(_CENTIMO, rounding=ROUND_HALF_UP)
```

Dos detalles que muerden:

- **`Decimal("2.675")`, nunca `Decimal(2.675)`.** El segundo hereda el error del float: vale `2.67499999999999982236431605997495353221893310546875`.
- **`ROUND_HALF_UP` explícito.** El default de `Decimal` es el redondeo bancario: `Decimal("0.125")` redondea a `0.12`. La regla comercial es hacia arriba en la mitad.

`redondear` es una función, no una clase `Dinero`. Con una sola moneda, envolver `Decimal` no agrega ninguna regla. El día que aparezcan los dólares, ese es el momento de crear `Monto(valor, moneda)`.

## El test

```python tests/test_valores.py · Extracto
def test_ruc_con_digito_verificador_correcto() -> None:
    assert Documento(TipoDocumento.RUC, "20131312955").numero == "20131312955"


@pytest.mark.parametrize("ruc", ["20131312956", "2013131295", "2013131295A", "２0131312955"])
def test_ruc_invalido(ruc: str) -> None:
    with pytest.raises(ErrorDeDominio, match="RUC inválido"):
        Documento(TipoDocumento.RUC, ruc)
```

Sin fixtures, sin base de datos, sin mocks. Así se ve testear una regla que no depende de nada.

> **Quedate con esto**
> Un value object es inmutable, se compara por valor y se valida al construirse: si existe, es válido. Con una sola `ErrorDeDominio` alcanza. La plata va en `Decimal` construido desde strings y con `ROUND_HALF_UP` explícito. Y `isdigit()` acepta dígitos que no son ASCII.
