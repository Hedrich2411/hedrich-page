---
title: "Testear sin base de datos"
description: Fakes en memoria en lugar de mocks. Tests de casos de uso que corren en milisegundos y sobreviven a un refactor.
date: 2026-10-19
topic: Backend
tags: [python, pytest, testing]
goal: Testear los casos de uso con dobles que se comportan como la infraestructura real.
course: clean-architecture-python
section: aplicacion
order: 4
---

Toda la separación de las lecciones anteriores tiene un primer pago concreto: el caso de uso se puede testear con clases de quince líneas en lugar de una base de datos.

## Un fake, no un mock

Con `unittest.mock`, el test de emitir quedaría así:

```python Mal · el test conoce la implementación
def test_emitir():
    uow = MagicMock()
    uow.series.siguiente.return_value = 1
    EmitirComprobante(uow).ejecutar(solicitud)
    uow.comprobantes.agregar.assert_called_once()
    uow.confirmar.assert_called_once()
```

Pasa, y verifica **cómo** está escrito el caso de uso, no **qué** hace. Si renombrás `agregar` a `guardar` en el puerto y en el adaptador pero te olvidás del caso de uso, en producción revienta con `AttributeError` y el test sigue verde: un `MagicMock` acepta cualquier método. Y si reordenás las llamadas, el test se rompe aunque el resultado sea el mismo.

Un fake es una implementación real del puerto, solo que en memoria:

```python tests/fakes.py · Persistencia en memoria
class ComprobantesEnMemoria:
    def __init__(self) -> None:
        self.guardados: dict[NumeroComprobante, Comprobante] = {}

    def agregar(self, comprobante: Comprobante) -> None:
        self.guardados[comprobante.numero] = comprobante

    def obtener(self, numero: NumeroComprobante, bloquear: bool = False) -> Comprobante | None:
        return self.guardados.get(numero)

    def notas_de(self, numero: NumeroComprobante) -> list[Comprobante]:
        return [c for c in self.guardados.values() if c.referencia == numero]

    def pendientes(self, limite: int) -> list[Comprobante]:
        return [c for c in self.guardados.values() if c.estado is Estado.PENDIENTE][:limite]

    def actualizar_estado(self, comprobante: Comprobante) -> None:
        self.guardados[comprobante.numero] = comprobante


class SeriesEnMemoria:
    def __init__(self, *series: str) -> None:
        self.ultimos = dict.fromkeys(series, 0)

    def siguiente(self, serie: str) -> int:
        if serie not in self.ultimos:
            raise ErrorDeDominio(f"La serie {serie} no está registrada")
        self.ultimos[serie] += 1
        return self.ultimos[serie]


class UnidadEnMemoria:
    def __init__(self, *series: str) -> None:
        self.comprobantes = ComprobantesEnMemoria()
        self.series = SeriesEnMemoria(*series)
        self.confirmado = False

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def confirmar(self) -> None:
        self.confirmado = True
```

mypy verifica que `UnidadEnMemoria` cumple `UnidadDeTrabajo`: si el puerto cambia, el fake deja de tipar. Y el test pregunta por el resultado, qué quedó guardado, no por las llamadas.

## Los tests

```python tests/test_emitir.py
def test_emite_con_el_siguiente_correlativo() -> None:
    uow = UnidadEnMemoria("F001")
    emitir = EmitirComprobante(uow, hoy=lambda: date(2026, 10, 19))

    emitir.ejecutar(solicitud())
    segundo = emitir.ejecutar(solicitud())

    assert segundo.numero == NumeroComprobante("F001", 2)
    assert segundo.fecha == date(2026, 10, 19)
    assert uow.comprobantes.obtener(segundo.numero) is segundo
    assert uow.confirmado


def test_regla_incumplida_no_confirma() -> None:
    uow = UnidadEnMemoria("F001")
    with pytest.raises(ErrorDeDominio):
        EmitirComprobante(uow).ejecutar(solicitud(cliente=Cliente("Ana")))
    assert not uow.confirmado
    assert not uow.comprobantes.guardados


def test_serie_no_registrada() -> None:
    with pytest.raises(ErrorDeDominio, match="F999"):
        EmitirComprobante(UnidadEnMemoria("F001")).ejecutar(solicitud("F999"))
```

```text Terminal
$ uv run pytest tests/test_valores.py tests/test_comprobante.py tests/test_emitir.py -q
................................                                         [100%]
32 passed in 0.04s
```

## Lo que el fake no prueba

`UnidadEnMemoria` no deshace nada: su `__exit__` no hace rollback. Si `SeriesEnMemoria` avanzó y después la emisión falla, el contador queda avanzado. Para estos tests da igual, porque verifican que no se confirme, pero significa que **la atomicidad real no está probada acá**.

Es normal. Cada nivel de test cubre una cosa:

| Test | Qué prueba | Contra qué | Velocidad |
|---|---|---|---|
| Dominio | Reglas | Nada | Instantáneo |
| Casos de uso | Coordinación | Fakes | Instantáneo |
| Adaptadores | Que SQL, HTTP y la API cumplen el contrato | SQLite, transporte falso, `TestClient` | Rápido |

En [el repositorio con SQLAlchemy](/blog/clean-architecture/repositorio-sqlalchemy), un test contra una base real prueba que el correlativo no se pierde cuando falla la emisión. Lo importante es que entre los tres niveles no quede nada sin cubrir, no que cada test cubra todo.

## La regla del fake

Un fake vale lo que se parece a lo real. `SeriesEnMemoria` lanza el mismo `ErrorDeDominio` que el adaptador SQL ante una serie que no existe; si no, `test_serie_no_registrada` probaría el fake y no el caso de uso.

Cuando aparezca en producción un bug que los tests no vieron, la primera pregunta es si el fake se comporta distinto que lo real. Casi siempre es eso. La forma de no depender de la memoria es un test de contrato que corra contra las dos implementaciones, como el de [sustitución de Liskov](/blog/clean-architecture/sustitucion-de-liskov).

> **Quedate con esto**
> Los fakes implementan el puerto en memoria y los tests verifican estado, no llamadas; por eso sobreviven a un refactor. mypy garantiza que el fake cumple el contrato. Lo que el fake no puede probar, como las transacciones reales, lo prueban los tests del adaptador. Y un fake que no se comporta como lo real es un test que miente.
