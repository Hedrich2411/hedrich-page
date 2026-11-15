---
title: "Tipos que sostienen la arquitectura"
description: Type hints, mypy estricto y lo que el curso usa del módulo typing. Cuándo un NewType alcanza y cuándo hace falta un value object.
date: 2026-10-19
topic: Backend
tags: [python, mypy, tipos]
goal: Usar los tipos para que una herramienta verifique los contratos entre capas, no la memoria del equipo.
course: clean-architecture-python
section: fundamentos
order: 3
---

Python no mira los type hints al ejecutar. `def emitir(items: list[Item])` acepta un string sin quejarse. Los tipos sirven porque mypy los lee antes de correr, y en una arquitectura por capas eso importa más que en un script: **los tipos son los contratos entre capas**. Si el adaptador SQL no cumple lo que el caso de uso espera, querés enterarte en el CI y no en producción.

## Lo básico que usa el curso

| Escritura | Para qué | Ejemplo en el curso |
|---|---|---|
| `X \| None` | Puede faltar | `documento: Documento \| None = None` |
| `tuple[Item, ...]` | Inmutable, de cualquier largo | Los ítems de un comprobante |
| `Iterable[T]` en parámetros | Aceptar listas, tuplas o generadores | `Comprobante.emitir(items: Iterable[Item])` |
| `list[T]` en retornos | Prometer algo concreto | `pendientes() -> list[Comprobante]` |
| `Callable[[], date]` | Una función como dependencia | `hoy` en los casos de uso |
| `Self` | El tipo de la propia clase | `__enter__` de la unidad de trabajo |

La regla de los parámetros: **pedí lo mínimo, devolvé lo concreto**. `emitir` recibe `Iterable[Item]` y lo convierte en `tuple`; quien llama puede pasar lo que tenga.

## Enum, Literal o NewType

`TipoComprobante` es un `StrEnum`. Podría ser `Literal["01", "03", "07"]`, y mypy lo verificaría igual. El enum gana porque tiene nombre (`TipoComprobante.FACTURA` se lee; `"01"` no), se puede recorrer y vive en un solo lugar. `Literal` queda para parámetros chicos y locales.

`NewType` crea un tipo distinto que no cuesta nada en ejecución:

```python Python · NewType
Ruc = NewType("Ruc", str)
Dni = NewType("Dni", str)


def consultar_padron(ruc: Ruc) -> None: ...


dni = Dni("45879632")
consultar_padron(dni)
```

```text Terminal
error: Argument 1 to "consultar_padron" has incompatible type "Dni"; expected "Ruc"  [arg-type]
```

Pero no valida nada: `Ruc("hola")` es un `Ruc` válido para mypy. Por eso el curso usa un value object, `Documento`, que verifica el dígito al construirse. La regla práctica: **si el valor tiene reglas, value object; si solo hay que no confundirlo con otro string, `NewType`**.

## Alias y genéricos

Desde Python 3.12 un alias se declara con `type`, y un genérico sin `TypeVar`:

```python aplicacion/importar.py · Alias
type Resultado = Importado | Fallido
```

```python aplicacion/eventos.py · Genérico
def suscribir[E: Evento](self, tipo: type[E], manejador: Callable[[E], None]) -> None:
    self._manejadores[tipo].append(manejador)
```

`suscribir(ComprobanteRechazado, avisar)` exige que `avisar` reciba un `ComprobanteRechazado`. Si le pasás una función que espera otro evento, mypy lo rechaza.

## Exhaustividad con `assert_never`

```python adaptadores/impresion.py · Cada estado tiene su texto
def _estado(estado: Estado) -> str:
    match estado:
        case Estado.PENDIENTE:
            return "Pendiente de envío a SUNAT"
        case Estado.ACEPTADO:
            return "Aceptado por SUNAT"
        case Estado.RECHAZADO:
            return "Rechazado por SUNAT"
        case _:
            assert_never(estado)
```

Si mañana alguien agrega `Estado.ANULADO` al dominio y se olvida de la impresión:

```text Terminal · mypy src
src\facturacion\adaptadores\impresion.py:92: error: Argument 1 to "assert_never" has incompatible type "Literal[Estado.ANULADO]"; expected "Never"  [arg-type]
```

Con un diccionario `{Estado.PENDIENTE: "...", ...}` el olvido aparece como `KeyError` en producción. Con `match` y `assert_never`, en el CI.

## `Any`, con cuidado

`Any` apaga la verificación. En el curso aparece una vez, adentro del bus de eventos, porque un diccionario que guarda manejadores de tipos distintos no se puede tipar con precisión. Lo importante es que no se escape: `suscribir` es genérico y estricto, y `Any` queda en una línea privada.

## Configurar mypy

```toml pyproject.toml
[tool.mypy]
strict = true
```

`strict` exige tipos en todas las funciones, prohíbe `Any` implícitos y avisa de `# type: ignore` que ya no hacen falta. En un proyecto nuevo, desde el día uno.

En uno existente, de a módulos:

```toml pyproject.toml · Adopción gradual
[tool.mypy]
strict = true

[[tool.mypy.overrides]]
module = ["facturacion.legado.*"]
ignore_errors = true
```

Lo nuevo nace estricto y lo viejo sale de la lista a medida que se toca. Para bibliotecas sin tipos, `ignore_missing_imports = true` en un override para ese módulo, nunca global.

Y para no esperar al CI, un hook de pre-commit:

```yaml .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: mypy
        name: mypy
        entry: uv run mypy src tests
        language: system
        types: [python]
        pass_filenames: false
```

`pass_filenames: false` porque mypy necesita ver el proyecto entero para seguir los imports, no solo los archivos que cambiaron.

> **Quedate con esto**
> Los tipos son los contratos entre capas y mypy es quien los hace cumplir. Pedí lo mínimo en los parámetros y devolvé lo concreto. `NewType` distingue, un value object además valida. `match` con `assert_never` convierte un caso olvidado en un error del CI. Y `strict = true` desde el principio, o de a módulos en un proyecto que ya existe.
