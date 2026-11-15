---
title: "Sustitución de Liskov: cumplir el contrato, no solo la firma"
description: Una subclase o un adaptador que acepta los mismos tipos pero se comporta distinto rompe a quien lo usa. Cómo se ve en Python y cómo se protege con tests de contrato.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, solid, testing]
goal: Reconocer cuándo una implementación no es sustituible y protegerlo con tests de contrato.
course: clean-architecture-python
section: solid
order: 3
---

Barbara Liskov lo formuló en 1987, y en criollo dice: **si un código funciona con un tipo, tiene que funcionar con cualquier subtipo sin saber cuál le tocó**. Los tipos coinciden casi siempre. Lo que se rompe es el comportamiento.

## Una jerarquía que parece obvia

Muchos sistemas de venta tienen proformas: cotizaciones que se imprimen igual que una factura pero no se mandan a SUNAT. En el lenguaje del negocio, «una proforma es un tipo de comprobante». Traducido literal:

```python Mal · una subclase que no puede hacer lo que promete el padre
class Proforma(Comprobante):
    def aceptar(self) -> None:
        raise ErrorDeDominio("Una proforma no se envía a SUNAT")
```

mypy no se queja: la firma es la misma. Pero las proformas también nacen `pendiente`, así que `EnviarPendientes` las encuentra, las manda al PSE y, cuando el PSE responde, la llamada a `aceptar()` explota en medio del lote.

El problema no es el `raise`. Es que **`Proforma` no cumple el contrato de `Comprobante`**: un comprobante se envía, se acepta o se rechaza. Una proforma no hace nada de eso. Que se impriman parecido no la convierte en subtipo.

La salida es no heredar: una `Proforma` propia, con lo que necesita, y si comparten formato de impresión, que compartan el [presentador](/blog/clean-architecture/presentadores), no la jerarquía.

Fijate el contraste con la nota de crédito del curso. Es la misma clase `Comprobante` con `tipo = NOTA_DE_CREDITO` y una referencia, porque **sí** es sustituible: se envía, se acepta, se rechaza y tiene total. Lo distinto es cómo nace, y eso lo resuelve una [fábrica](/blog/clean-architecture/agregados), no una subclase.

## El contrato que mypy no ve

Con `Protocol` no hay herencia, pero Liskov aplica igual. El contrato de `Pse` no es solo la firma `enviar(comprobante) -> RespuestaSunat`; también es **«si no hubo respuesta, lanzá `PseNoDisponible`»**. `EnviarPendientes` depende de eso para reintentar.

Un segundo adaptador para otro proveedor:

```python Mal · cumple la firma, rompe el contrato
class PseOtroProveedor:
    def enviar(self, comprobante: Comprobante) -> RespuestaSunat:
        respuesta = self._cliente.post("/v2/invoices", json=_a_json(comprobante))
        return RespuestaSunat(respuesta.json()["accepted"], respuesta.json().get("error", ""))
```

mypy lo acepta. Pero ante un timeout deja escapar `httpx.ReadTimeout`, `EnviarPendientes` no lo reconoce, y el cron termina con un traceback en lugar de dejar el lote para la próxima corrida.

Las tres partes del contrato que los tipos no capturan:

| Parte | En el curso |
|---|---|
| Precondiciones: qué se exige de la entrada | `pendientes(limite)` respeta el límite |
| Postcondiciones: qué se garantiza a la salida | `pendientes` devuelve en orden de emisión |
| Excepciones: qué puede fallar y cómo | `Pse.enviar` lanza `PseNoDisponible` si no hubo respuesta |

Un subtipo puede ser más tolerante con la entrada y más estricto con la salida, nunca al revés.

## Tests de contrato

La forma de proteger esto es escribir los tests **contra el contrato** y correrlos contra cada implementación:

```python tests/test_contrato_comprobantes.py · Extracto
@pytest.fixture(params=["memoria", "sql"])
def uow(request: pytest.FixtureRequest, fabrica: sessionmaker[Session]) -> UnidadDeTrabajo:
    if request.param == "memoria":
        return UnidadEnMemoria("F001", "FC01")
    return UnidadSql(fabrica)


def test_pendientes_en_orden_de_emision_y_con_limite(uow: UnidadDeTrabajo) -> None:
    for _ in range(3):
        emitir(uow)
    with uow:
        assert [str(c.numero) for c in uow.comprobantes.pendientes(2)] == ["F001-1", "F001-2"]
```

```text Terminal
tests/test_contrato_comprobantes.py::test_pendientes_en_orden_de_emision_y_con_limite[memoria] PASSED
tests/test_contrato_comprobantes.py::test_pendientes_en_orden_de_emision_y_con_limite[sql] PASSED
```

Cada test corre dos veces, una por implementación. Si el fake en memoria devolviera los pendientes en otro orden que SQL, falla el test del fake, y te enterás de que [tus tests con fakes](/blog/clean-architecture/tests-con-fakes) estaban probando algo que producción no hace.

Si sumás un adaptador nuevo, como un repositorio sobre otra base, agregás un `param` y hereda todos los tests de contrato.

> **Quedate con esto**
> Liskov dice que cualquier implementación tiene que poder reemplazar a otra sin que quien la usa se entere. La firma la verifica mypy; el comportamiento (precondiciones, postcondiciones y excepciones) no. «Es un tipo de» en el lenguaje del negocio no alcanza para heredar. Y los tests de contrato, parametrizados por implementación, son la forma práctica de que fakes y adaptadores digan lo mismo.
