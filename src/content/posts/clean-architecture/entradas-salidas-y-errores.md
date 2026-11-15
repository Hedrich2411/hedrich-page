---
title: "Lo que entra, lo que sale y cuándo falla"
description: Request models, respuestas y la eterna pregunta de excepciones o Result, con un import de ventas desde CSV donde la respuesta cambia.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Elegir cómo un caso de uso recibe datos, devuelve resultados y comunica errores, según quién lo llama.
course: clean-architecture-python
section: aplicacion
order: 2
---

Un caso de uso tiene tres bordes que diseñar: lo que recibe, lo que devuelve y cómo avisa que algo salió mal. No hay una respuesta única para ninguno de los tres. Depende de quién lo llama.

## Lo que entra

`EmitirComprobante` recibe una `SolicitudEmision` con tipos del dominio: `Cliente`, `Item`, `TipoComprobante`. Su llamador, la API, ya convirtió el JSON y validó la forma con Pydantic. Para cuando llega, el RUC ya es un `Documento` válido.

Las ventas del día que exporta el sistema de reservas llegan en un CSV que nadie validó. Para eso, un request model con texto plano:

```python aplicacion/importar.py · El request model
@dataclass(frozen=True)
class VentaImportada:
    tipo: str
    serie: str
    cliente: str
    tipo_documento: str
    numero_documento: str
    descripcion: str
    cantidad: str
    precio_unitario: str

    def a_solicitud(self) -> SolicitudEmision:
        documento = None
        if self.numero_documento:
            documento = Documento(_tipo_documento(self.tipo_documento), self.numero_documento)
        return SolicitudEmision(
            tipo=_tipo_comprobante(self.tipo),
            serie=self.serie,
            cliente=Cliente(self.cliente, documento),
            items=(
                Item(self.descripcion, decimal_desde_texto(self.cantidad), decimal_desde_texto(self.precio_unitario)),
            ),
        )
```

| Request model | Cuándo |
|---|---|
| Con tipos del dominio | El llamador es un adaptador que ya parsea y valida la forma |
| Con texto plano | La entrada viene cruda y el caso de uso tiene que hacerse cargo de convertirla |

Convertir texto en un monto tiene una trampa que vale la pena esconder en una función:

```python dominio/valores.py
def decimal_desde_texto(texto: str) -> Decimal:
    try:
        numero = Decimal(texto.strip())
    except InvalidOperation:
        raise ErrorDeDominio(f"Número inválido: {texto!r}") from None
    if not numero.is_finite():
        raise ErrorDeDominio(f"Número inválido: {texto!r}")
    return numero
```

`Decimal("NaN")` es válido, y `Decimal("NaN") <= 0` no da `False`: lanza `InvalidOperation`. Sin el `is_finite()`, un «NaN» en el CSV revienta dentro de `Item.__post_init__` con una excepción que nadie espera.

## Lo que sale

`EmitirComprobante` devuelve la entidad. Es una elección con costo: quien la recibe podría llamar a `aceptar()` por error. La alternativa es un response model, un `ComprobanteEmitido(numero, total)` en la capa de aplicación, que aísla del todo a los adaptadores.

En este proyecto devolvemos la entidad porque cada adaptador la convierte en el acto, con `ComprobanteOut.de()` o `presentar()`, y un DTO más sería una copia de esos dos. Si los casos de uso los consumen muchos equipos, o si la entidad tiene métodos peligrosos, el response model paga.

## Cuándo falla: excepción o valor

Muchos textos de Clean Architecture, incluido el libro de referencia de este curso, devuelven un `Result` en lugar de lanzar excepciones. El curso usa las dos cosas, cada una donde sirve:

| Situación | Cómo se comunica | En el curso |
|---|---|---|
| Se rompe una regla en una operación interactiva | Excepción | `ErrorDeDominio` → 422 o el formulario con el error |
| Un resultado esperado que el llamador tiene que manejar | Valor | `RespuestaSunat(aceptado=False)`: un rechazo es un resultado normal |
| Algo anormal que corta la operación | Excepción | `PseNoDisponible`: corta el lote |
| Un lote donde un fallo no frena al resto | Valor por elemento | El import de ventas |

La pregunta útil no es «¿excepciones o Result?», sino **¿quién tiene que reaccionar y cuándo?** Si el error sube hasta un borde que lo traduce una vez, una excepción es más simple. Si cada elemento tiene su resultado y hay que seguir, un valor.

## Un resultado por venta

```python aplicacion/importar.py · El caso de uso
@dataclass(frozen=True)
class Importado:
    numero: NumeroComprobante


@dataclass(frozen=True)
class Fallido:
    motivo: str


type Resultado = Importado | Fallido


@dataclass
class ImportarVentas:
    emitir: EmitirComprobante

    def ejecutar(self, ventas: Iterable[VentaImportada]) -> list[Resultado]:
        resultados: list[Resultado] = []
        for venta in ventas:
            try:
                comprobante = self.emitir.ejecutar(venta.a_solicitud())
            except ErrorDeDominio as error:
                resultados.append(Fallido(str(error)))
            else:
                resultados.append(Importado(comprobante.numero))
        return resultados
```

Adentro, `EmitirComprobante` sigue lanzando excepciones. **El borde del lote las convierte en valores**. Y cada venta es una transacción propia: la tercera que falla no deshace las dos primeras.

Quien llama lo recorre con `match`:

```python cli.py · _importar
def _importar(archivo: Path) -> int:
    ventas = leer_ventas(archivo.read_text(encoding="utf-8-sig"))
    resultados = ImportarVentas(EmitirComprobante(UnidadSql(arranque.sesiones()))).ejecutar(ventas)
    fallidos = 0
    for fila, resultado in enumerate(resultados, start=2):
        match resultado:
            case Importado(numero):
                log.info("Fila %d: %s", fila, numero)
            case Fallido(motivo):
                fallidos += 1
                log.warning("Fila %d: %s", fila, motivo)
    return 1 if fallidos else 0
```

Una unión de dataclasses con `match` es el `Result` de Python: mypy sabe que en `case Importado(numero)` hay un número y que en `Fallido` no, y no existe forma de leer `.valor` de un fallo. El código de salida 1 avisa al cron que algo quedó sin importar.

## Dos clases de error en un import

```python adaptadores/ventas_csv.py
def leer_ventas(texto: str) -> list[VentaImportada]:
    return [VentaImportada(**fila) for fila in csv.DictReader(io.StringIO(texto))]
```

Si las columnas del archivo no coinciden, `VentaImportada(**fila)` lanza `TypeError` y **el import entero falla** antes de emitir nada: no es el archivo que esperábamos y hay que arreglarlo. Si una venta está mal, **falla esa venta** y el resto sigue. Archivo mal formado, todo o nada; dato malo, por fila.

```text Terminal · Los mensajes de facturacion importar ventas.csv
Fila 2: B001-1
Fila 3: Número inválido: 'dos'
Fila 4: Una factura solo se emite a un cliente con RUC
```

> **Quedate con esto**
> El request model depende de quién llama: tipos del dominio si el adaptador ya validó, texto plano si la entrada viene cruda. Devolver la entidad es pragmático; un response model aísla más. Las excepciones sirven cuando un borde las traduce una vez; los valores, cuando cada elemento de un lote tiene su resultado. Y en Python, una unión de dataclasses con `match` es un `Result` con chequeo de tipos.
