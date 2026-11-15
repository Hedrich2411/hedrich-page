---
title: "Una estrategia de tests que acompaña a las capas"
description: Qué probar en cada capa, tests de contrato para que los fakes no mientan, un test de punta a punta y cómo mantener todo en menos de un segundo.
date: 2026-10-19
topic: Backend
tags: [python, pytest, testing]
goal: Tener una suite que dé confianza para cambiar cualquier capa sin volverse lenta ni frágil.
course: clean-architecture-python
section: produccion
order: 2
---

```text Terminal
$ uv run pytest -q
........................................................................ [ 73%]
..........................                                               [100%]
98 passed in 0.57s
```

Noventa y ocho tests en poco más de medio segundo, y ninguno necesita una base de datos externa, red ni un servidor levantado. No es suerte: es lo que permite la separación en capas.

## Qué se prueba en cada capa

| Capa | Archivos | Tests | Contra qué |
|---|---|---|---|
| Dominio | `test_valores`, `test_comprobante` | 29 | Nada |
| Aplicación | `test_emitir`, `test_enviar`, `test_notas`, `test_eventos`, `test_importar` | 19 | Fakes |
| Adaptadores | `test_sql`, `test_pse`, `test_api`, `test_paginas`, `test_impresion`, `test_exportar`, `test_observabilidad` | 33 | SQLite en memoria, `MockTransport`, `TestClient` |
| Contrato | `test_contrato_comprobantes` | 10 | Fake y SQL, los mismos tests |
| Punta a punta | `test_punta_a_punta` | 1 | Todo junto |
| Arquitectura | `test_arquitectura` | 6 | El código fuente |

Cada capa prueba **lo suyo**. Las reglas se prueban en el dominio y no se repiten en la API; la API prueba que un `ErrorDeDominio` llegue como 422 con su mensaje.

## Los tests como señal de diseño

Un test difícil de escribir casi siempre es un diseño que se queja. Si probar el cálculo del IGV pide una sesión de base de datos, la regla está en el lugar equivocado. Si un caso de uso necesita cinco mocks, tiene demasiadas dependencias. Antes de buscar una biblioteca de mocks más potente, preguntate qué te está diciendo el test.

## Organización

```text tests/
tests/
├── conftest.py      # fixtures compartidas: fabrica (SQLite) y api (TestClient)
├── datos.py         # constantes: EMPRESA, FACTURA, FACTURA_JSON, hoy()
├── fakes.py         # implementaciones en memoria de los puertos
└── test_*.py        # un archivo por módulo
```

**Fixtures para lo que tiene ciclo de vida**: una base nueva por test, un cliente HTTP. **Constantes para lo inmutable**: `EMPRESA` es un value object congelado y no necesita fixture. Un archivo `datos.py` que se importa es más fácil de seguir que diez fixtures encadenadas.

## Tests de contrato

El riesgo de los fakes es que se comporten distinto que lo real. La respuesta es correr los mismos tests contra las dos implementaciones, como vimos en [sustitución de Liskov](/blog/clean-architecture/sustitucion-de-liskov): una fixture parametrizada con `["memoria", "sql"]` y cinco tests que corren dos veces cada uno. Si el fake miente, falla el test del fake.

## Punta a punta, pero uno

```python tests/test_punta_a_punta.py
def test_emitir_enviar_y_consultar(api: TestClient, fabrica: sessionmaker[Session]) -> None:
    api.post("/comprobantes", json=FACTURA_JSON)
    sunat = httpx.MockTransport(lambda _: httpx.Response(200, json={"aceptado": True}))
    pse = PseHttp(httpx.Client(base_url="https://pse.test", transport=sunat))

    assert EnviarPendientes(UnidadSql(fabrica), pse).ejecutar() == 1
    assert api.get("/comprobantes/F001-1").json()["estado"] == "aceptado"
    assert "Aceptado por SUNAT" in api.get("/comprobantes/F001-1/impreso").text
```

API, caso de uso, SQL, adaptador HTTP real con transporte falso, presentador y plantilla, todo en un test. Prueba que las piezas encajan. Uno o dos alcanzan: son los que se rompen por razones ajenas a lo que probás y los más difíciles de diagnosticar cuando fallan.

## El tiempo

Los casos de uso reciben `hoy` como parámetro, así que los tests pasan una fecha fija sin parchear el reloj. No hace falta `freezegun`. Las fechas formateadas, como el `19/10/2026` del impreso, se prueban con esa misma fecha.

## Parametrizar cuando los casos son la especificación

La tabla de `en_letras` en [presentadores](/blog/clean-architecture/presentadores) tiene diez casos y una sola función de test. Leída de arriba abajo, es la especificación de cómo se escribe un monto en castellano. Cuando un bug aparezca, se agrega una fila.

## Que siga siendo rápida

```text Terminal · uv run pytest --durations=3
0.05s setup    tests/test_api.py::test_emitir_y_consultar
0.02s call     tests/test_api.py::test_emitir_y_consultar
0.02s call     tests/test_punta_a_punta.py::test_emitir_enviar_y_consultar
```

El más lento tarda 50 milisegundos, y casi todo es crear la app de FastAPI. Cuando la suite crezca:

- **`pytest -x --lf`** en el día a día: corta en el primer fallo y empieza por los que fallaron la última vez.
- **Tests contra PostgreSQL de verdad** con una marca, `@pytest.mark.postgres`, que en tu máquina se saltean con `-m "not postgres"` y en el CI corren.
- **`pytest-xdist`** recién cuando la suite pase los varios segundos. Antes, el costo de arrancar los procesos se come la ganancia.

## Lo que no se prueba

- Que FastAPI devuelva 422 ante un JSON mal formado: es el framework, y ya tiene sus tests.
- Las plantillas: son humildes a propósito.
- Propiedades triviales y dataclasses sin lógica.

> **Quedate con esto**
> Cada capa prueba lo suyo: reglas en el dominio, coordinación con fakes, traducción en los adaptadores. Los tests de contrato evitan que los fakes mientan, y uno o dos tests de punta a punta prueban que todo encaja. Un test difícil de escribir es un diseño que se queja. Y con el tiempo inyectado y sin red, la suite entera corre en menos de un segundo.
