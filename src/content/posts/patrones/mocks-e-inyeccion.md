---
title: "Mocks e inyección de dependencias"
description: Probar un cotizador en dólares sin llamar a la SBS, por qué un mock sin spec acepta cualquier typo, y cómo FastAPI cambia una dependencia en los tests con una línea.
date: 2026-10-19
topic: Backend
tags: [python, patrones, testing, fastapi]
goal: Diseñar código que reciba sus dependencias para poder reemplazarlas en los tests, y usar mocks sin que mientan.
course: patrones-python
section: calidad
order: 1
---

Un cotizador convierte dólares a soles con el tipo de cambio de la SBS. En los tests no se puede llamar a la SBS: es lento, el valor cambia cada día, y si se cae, el test falla por algo que no es tu código.

El problema se resuelve en el diseño, antes que en el test.

## Inyección de dependencias

Si el cotizador crea su propio cliente de la SBS adentro, no hay forma de cambiarlo. Si lo **recibe**, sí:

```python cotizador.py
class TipoDeCambio(Protocol):
    def venta(self, moneda: str) -> Decimal: ...


class Cotizador:
    def __init__(self, tipo_de_cambio: TipoDeCambio) -> None:
        self._tc = tipo_de_cambio

    def en_soles(self, monto_usd: Decimal) -> Decimal:
        return (monto_usd * self._tc.venta("USD")).quantize(Decimal("0.01"))
```

Eso es toda la inyección de dependencias: **pasar lo que se necesita en lugar de crearlo**. Sin framework ni contenedor. El `Protocol` dice qué necesita el cotizador, y cualquier objeto con un método `venta` sirve: el cliente real en producción, uno fijo en los tests.

Es la alternativa al [Singleton](/blog/patrones/singleton) global: una instancia única que se crea una vez al arrancar y se pasa a quien la necesita, en lugar de que cada uno la vaya a buscar. Y es el [principio de inversión de dependencias](/blog/clean-architecture/depender-de-abstracciones) aplicado.

## Mocks: con spec o mienten

`unittest.mock` crea objetos que fingen ser otros y registran cómo se los llamó:

```python test_cotizador.py
tc = create_autospec(TipoDeCambioSbs, instance=True)
tc.venta.return_value = Decimal("3.712")

assert Cotizador(tc).en_soles(Decimal("100")) == Decimal("371.20")
tc.venta.assert_called_once_with("USD")
```

```text Terminal
mock: 371.20 | llamado con: call('USD')
```

**`create_autospec`** es lo importante. Copia la firma de la clase real, y falla si el código la llama mal:

```text Terminal · tc.venta("USD", fecha="2026-10-19")
autospec atrapa la firma equivocada: got an unexpected keyword argument 'fecha'
```

Un `Mock()` a secas acepta **cualquier cosa**, incluido un typo:

```text Terminal · suelto = Mock(); suelto.vneta("USD")
un Mock sin spec acepta un typo: 1
```

El test pasa y el código está roto: `vneta` no existe en la clase real. Peor todavía cuando alguien renombra `venta` en la clase real y los tests con `Mock()` siguen en verde. Siempre `create_autospec` o `Mock(spec=Clase)`.

### Un fake suele ser mejor

Para dependencias que se usan en muchos tests, una clase falsa escrita a mano es más clara que configurar un mock en cada test:

```python fakes.py
class TipoDeCambioFijo:
    def venta(self, moneda: str) -> Decimal:
        return Decimal("3.75")
```

Se lee sin conocer la API de `mock`, mypy la verifica contra el `Protocol`, y no hay `return_value` repartidos por los tests. Los mocks quedan para verificar **interacciones**: que se mandó el correo, que se llamó una vez y no dos. El curso de Clean Architecture dedica una lección a [tests con fakes](/blog/clean-architecture/tests-con-fakes).

## FastAPI: `dependency_overrides`

FastAPI trae inyección de dependencias con `Depends`. La ruta declara lo que necesita, y FastAPI lo crea:

```python api.py
def tipo_de_cambio() -> TipoDeCambio:
    return TipoDeCambioSbs()


@app.get("/cotizar")
def cotizar(usd: Decimal, tc: Annotated[TipoDeCambio, Depends(tipo_de_cambio)]) -> dict[str, str]:
    return {"soles": str(Cotizador(tc).en_soles(usd))}
```

En el test, una línea cambia la dependencia por el fake:

```python test_api.py
app.dependency_overrides[tipo_de_cambio] = TipoDeCambioFijo
cliente = TestClient(app)
assert cliente.get("/cotizar", params={"usd": "100"}).json() == {"soles": "375.00"}
app.dependency_overrides.clear()
```

```text Terminal
FastAPI con override: {'soles': '375.00'}
```

El `clear()` al final importa: `app` es un objeto global, y un override olvidado se filtra a los tests siguientes. En pytest va en una fixture con `yield`, para que se limpie aunque el test falle.

## `patch`: el último recurso

`mock.patch("modulo.requests.get")` reemplaza algo **donde se importó**, sin tocar el diseño. Funciona, pero acopla el test a cómo está escrito el código por dentro: si `cotizador.py` cambia `requests` por `httpx`, el test se rompe sin que el comportamiento haya cambiado. Si necesitás `patch` para probar algo tuyo, es una señal de que esa dependencia debería inyectarse. Para código de terceros que no controlás, `patch` es legítimo.

> **Quedate con esto**
> Inyectar es pasar las dependencias en lugar de crearlas, y es lo que hace testeable al código. Los mocks siempre con `create_autospec`: un `Mock()` sin spec acepta typos y firmas equivocadas. Para dependencias que se repiten, un fake escrito a mano. En FastAPI, `dependency_overrides`, limpiado al terminar. `patch` es el último recurso.
