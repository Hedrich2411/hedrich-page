---
title: "Que la arquitectura no se degrade"
description: Un linter que rompe el build cuando el dominio importa SQLAlchemy, y lo que ninguna herramienta puede revisar.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, ci]
goal: Convertir la regla de dependencias en un chequeo automático del CI.
course: clean-architecture-python
section: produccion
order: 4
---

Toda esta estructura se rompe con una línea. Un viernes a la tarde alguien necesita algo de la base en una regla del comprobante y escribe, en `dominio/comprobante.py`:

```python dominio/comprobante.py · El import del viernes
from sqlalchemy.orm import Session
```

Funciona y los tests pasan. En seis meses el dominio depende de la base en diez lugares y nadie sabe desde cuándo.

Una convención que depende de que todos se acuerden no es una regla. Hay que hacer que el build falle.

## import-linter

[import-linter](https://import-linter.readthedocs.io/) analiza los imports del paquete y verifica contratos. Con dos alcanza:

```toml pyproject.toml
[tool.importlinter]
root_package = "facturacion"
include_external_packages = true

[[tool.importlinter.contracts]]
name = "Las dependencias apuntan hacia el dominio"
type = "layers"
layers = [
    "facturacion.web | facturacion.cli",
    "facturacion.arranque",
    "facturacion.adaptadores",
    "facturacion.aplicacion",
    "facturacion.dominio",
]

[[tool.importlinter.contracts]]
name = "El centro no conoce frameworks"
type = "forbidden"
source_modules = ["facturacion.dominio", "facturacion.aplicacion"]
forbidden_modules = ["sqlalchemy", "fastapi", "pydantic", "httpx"]
```

**`layers`** es la regla de dependencias, literal: cada capa puede importar las de abajo y nunca las de arriba. `web | cli` en la misma línea significa que están al mismo nivel y tampoco se importan entre sí.

**`forbidden`** cubre lo que `layers` no ve: las dependencias de terceros. `include_external_packages = true` es lo que permite nombrarlas.

```text Terminal
$ uv run lint-imports
Las dependencias apuntan hacia el dominio KEPT
El centro no conoce frameworks KEPT

Contracts: 2 kept, 0 broken.
```

Con el import del viernes:

```text Terminal · Con sqlalchemy en el dominio
El centro no conoce frameworks
------------------------------

facturacion.aplicacion is not allowed to import sqlalchemy:

-   facturacion.aplicacion.puertos -> facturacion.dominio.comprobante (l.4)
    facturacion.dominio.comprobante -> sqlalchemy (l.1)
```

Lo detecta aunque sea indirecto: `aplicacion` no importa SQLAlchemy, pero importa el dominio, que sí. La cadena completa dice exactamente qué línea arreglar.

## En el CI

```yaml .github/workflows/ci.yml
name: ci
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --locked
      - run: uv run lint-imports
      - run: uv run mypy src tests
      - run: uv run pytest
```

Los tres chequeos tardan segundos. `lint-imports` va primero porque es el más rápido y el que mejor explica el problema.

## mypy como parte del contrato

Los puertos son `Protocol`, y Python no verifica en ejecución que un adaptador los cumpla. Si `ComprobantesSql.pendientes` pierde el parámetro `limite`, nada falla hasta que el cron corre en producción.

`mypy --strict` lo detecta en el momento en que se pasa una `UnidadSql` donde se espera una `UnidadDeTrabajo`. Por eso está en el CI con el mismo peso que los tests.

## Funciones de fitness propias

import-linter mira imports. Hay reglas de la arquitectura que no son imports: «el dominio no lee el reloj», «el dominio no imprime ni lee variables de entorno». Una *función de fitness* es un test que verifica una propiedad de la arquitectura, y se escribe con lo que ya tenés:

```python tests/test_arquitectura.py
DOMINIO = Path(facturacion.dominio.__file__).parent
EFECTOS = {"now", "today", "utcnow", "open", "print", "environ", "getenv", "random", "uuid4"}


def nombres_usados(archivo: Path) -> set[str]:
    arbol = ast.parse(archivo.read_text(encoding="utf-8"))
    return {n.attr for n in ast.walk(arbol) if isinstance(n, ast.Attribute)} | {
        n.id for n in ast.walk(arbol) if isinstance(n, ast.Name)
    }


@pytest.mark.parametrize("archivo", sorted(DOMINIO.glob("*.py")), ids=lambda p: p.name)
def test_el_dominio_no_toca_el_mundo(archivo: Path) -> None:
    usados = nombres_usados(archivo) & EFECTOS
    assert not usados, f"{archivo.name} usa {sorted(usados)}"
```

`ast` lee el código sin ejecutarlo. Un `datetime.now()` o un `print` en cualquier archivo de `dominio/` rompe el build:

```text Terminal · Con un print en dominio/credito.py
E       AssertionError: credito.py usa ['print']
```

Es una heurística: busca nombres, no entiende el código, y una variable llamada `today` daría un falso positivo. Para una regla así alcanza, y el día que moleste se ajusta la lista. Lo importante es que **la regla existe en un lugar que corre solo**, y no en la memoria de quien revisa el PR.

## Lo que ningún linter ve

import-linter garantiza la dirección de los imports, no que las reglas estén en el lugar correcto. Esto pasa el linter sin problemas:

```python adaptadores/api.py · Mal · una regla de negocio en el endpoint
@app.post("/comprobantes", status_code=201)
def emitir(datos: ComprobanteIn) -> ComprobanteOut:
    if datos.tipo == "03" and sum(i.cantidad * i.precio_unitario for i in datos.items) > 700:
        ...
```

Para eso queda el code review, con tres preguntas:

- **¿Hay un `if` sobre el negocio fuera de `dominio/`?** Los adaptadores traducen, no deciden.
- **¿Alguien asigna un estado en lugar de llamar a un método?** Un `c.estado = ...` fuera de la entidad se saltea las transiciones.
- **¿Hay una abstracción nueva con una sola implementación?** El costo de cada capa tiene que estar justificado.

> **Quedate con esto**
> La regla de dependencias se verifica con import-linter en el CI: un contrato de capas y otro que prohíbe frameworks en el centro, que detecta también los imports indirectos. mypy estricto es lo que hace cumplir los `Protocol`. Lo que no es un import, como «el dominio no lee el reloj», se vuelve una función de fitness con `ast`. Y dónde están las reglas no lo ve ninguna herramienta: eso es trabajo del code review.
