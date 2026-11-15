---
title: "Servicios de dominio: reglas que no son de nadie"
description: Lo que queda por acreditar de una factura depende de la factura y de todas sus notas. Esa regla no es un método de ninguna de las dos.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, ddd]
goal: Distinguir reglas de una entidad, reglas entre varias y coordinación, y ubicar cada una.
course: clean-architecture-python
section: dominio
order: 4
---

La regla que quedó pendiente en [agregados](/blog/clean-architecture/agregados): **las notas de crédito de un comprobante, sumadas, no pueden superar su total**. Las notas rechazadas por SUNAT no cuentan, porque nunca tuvieron efecto.

## Por qué no es un método

¿De quién es esta regla?

**De la factura no.** Un `factura.credito_disponible()` necesitaría las notas adentro de la factura. El agregado crecería con cada nota y leer cualquier factura cargaría todas sus correcciones.

**De la nota tampoco.** Una nota no sabe que existen otras.

Cuando una regla del negocio necesita varios agregados y no pertenece naturalmente a ninguno, es un **servicio de dominio**. En Python, casi siempre, una función:

```python dominio/credito.py
def credito_disponible(original: Comprobante, notas: Iterable[Comprobante]) -> Decimal:
    acreditado = sum((nota.total for nota in notas if nota.estado is not Estado.RECHAZADO), Decimal(0))
    return original.total - acreditado


def exigir_credito(original: Comprobante, notas: Iterable[Comprobante], nueva: Comprobante) -> None:
    disponible = credito_disponible(original, notas)
    if nueva.total > disponible:
        raise ErrorDeDominio(f"La nota supera lo que queda por acreditar de {original.numero}: S/ {disponible}")
```

Recibe agregados ya cargados, no repositorios. No lee, no guarda, no sabe qué base hay. Es tan pura como `Comprobante`.

Fijate dónde está «las rechazadas no cuentan»: en el dominio, no en un `WHERE estado != 'rechazado'` del repositorio. Si estuviera en SQL, el fake tendría que repetirla para que los tests digan la verdad, y la regla sería invisible para quien lee `dominio/`. `notas_de()` devuelve todas; decidir cuáles cuentan es negocio.

## Quién la llama

```python aplicacion/notas.py
@dataclass
class EmitirNotaDeCredito:
    uow: UnidadDeTrabajo
    hoy: Callable[[], date] = hoy_en_lima

    def ejecutar(self, solicitud: SolicitudNota) -> Comprobante:
        with self.uow:
            original = self.uow.comprobantes.obtener(solicitud.referencia, bloquear=True)
            if original is None:
                raise ErrorDeDominio(f"No existe el comprobante {solicitud.referencia}")
            nota = Comprobante.emitir_nota_de_credito(
                numero=NumeroComprobante(solicitud.serie, self.uow.series.siguiente(solicitud.serie)),
                original=original,
                sustento=solicitud.sustento,
                items=solicitud.items,
                fecha=self.hoy(),
            )
            exigir_credito(original, self.uow.comprobantes.notas_de(original.numero), nota)
            self.uow.comprobantes.agregar(nota)
            self.uow.confirmar()
        return nota
```

Este es un caso de uso, el tema de la [sección siguiente](/blog/clean-architecture/casos-de-uso). La diferencia con el servicio de dominio es justo la que importa:

| | Servicio de dominio | Caso de uso |
|---|---|---|
| Decide | Una regla del negocio | Nada |
| Hace | Calcula sobre lo que recibe | Lee, bloquea, numera, guarda |
| Conoce | Entidades y value objects | Puertos y dominio |
| Vive en | `dominio/` | `aplicacion/` |

Si el servicio de dominio empieza a recibir un repositorio, se está convirtiendo en caso de uso. Si el caso de uso empieza a tener un `if` sobre el total, se está comiendo una regla.

## Tres lugares para una regla

| Tipo de regla | Ejemplo | Dónde |
|---|---|---|
| De una entidad | Una factura exige RUC | `Comprobante.emitir()` |
| De construcción | La nota copia el cliente del original | La fábrica |
| Entre agregados | Las notas no superan el total | `dominio/credito.py` |

Y lo que no es regla, como leer, bloquear o numerar, es coordinación y va en el caso de uso.

## Funciones, no clases

No hace falta un `ServicioDeCredito` con un método. En Python, un módulo con funciones es un servicio de dominio perfectamente válido. La clase aparece cuando el servicio tiene configuración propia, como una tabla de tasas que se inyecta.

## Los tests

```python tests/test_notas.py · Extracto
def test_no_se_acredita_mas_que_el_total() -> None:
    uow, _ = con_factura()
    emitir = EmitirNotaDeCredito(uow, hoy=hoy)
    emitir.ejecutar(nota("1500"))

    with pytest.raises(ErrorDeDominio, match="S/ 590.00"):
        emitir.ejecutar(nota("600"))


def test_una_nota_rechazada_no_cuenta() -> None:
    uow, factura = con_factura()
    emitir = EmitirNotaDeCredito(uow, hoy=hoy)
    emitir.ejecutar(nota("1500")).rechazar("Sustento insuficiente")

    assert credito_disponible(factura, uow.comprobantes.notas_de(factura.numero)) == Decimal("2360.00")
    emitir.ejecutar(nota("1900"))
```

La factura es de S/ 2,360.00. Una nota de S/ 1,500 más IGV acredita 1,770.00 y deja 590.00; la de 600 más IGV, 708.00, no entra.

> **Quedate con esto**
> Un servicio de dominio es una regla del negocio que necesita varios agregados y no pertenece a ninguno. Recibe objetos ya cargados y no hace I/O; en Python suele ser una función. Las reglas, incluso «las rechazadas no cuentan», viven en el dominio y no en una consulta SQL. Y el caso de uso coordina sin decidir: si recibe una regla, se la está robando al dominio.
