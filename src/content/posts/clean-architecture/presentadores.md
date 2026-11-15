---
title: "Presentadores: el comprobante impreso"
description: "El dominio dice F001-42 y 2360.00; el papel dice F001-00000042, S/ 2,360.00 y «SON: DOS MIL TRESCIENTOS SESENTA CON 00/100 SOLES». Ese trabajo tiene un lugar."
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, jinja2]
goal: Separar el formato de presentación en un presentador testeable y dejar la plantilla sin lógica.
course: clean-architecture-python
section: adaptadores
order: 4
---

El cliente quiere su comprobante impreso, o en PDF. Entre lo que sabe el dominio y lo que va en el papel hay un montón de decisiones:

| El dominio tiene | El impreso muestra |
|---|---|
| `NumeroComprobante("F001", 42)` | `F001-00000042` |
| `date(2026, 10, 19)` | `19/10/2026` |
| `Decimal("2360.00")` | `S/ 2,360.00` |
| `Decimal("2.000")`, como vuelve de la base | `2` |
| `TipoComprobante.FACTURA` | `FACTURA ELECTRÓNICA` |
| El total | `SON: DOS MIL TRESCIENTOS SESENTA CON 00/100 SOLES` |

El monto en letras es la leyenda que lleva todo comprobante peruano, y la parte con más lógica.

## Dónde no va

**En el dominio no.** Que el correlativo se imprima con ocho dígitos no es una regla del negocio; es un formato. El día que cambie el diseño del impreso no tiene por qué tocarse `comprobante.py`.

**En la plantilla tampoco.** Jinja2 permite filtros y lógica, pero una plantilla con cálculos no se puede probar sin renderizar HTML y buscar texto adentro. Y la segunda plantilla, un ticket o un correo, repite la lógica.

**En el endpoint tampoco.** Mezcla HTTP con formato y no se reusa desde el CLI.

## El objeto humilde

El patrón se llama *humble object*: lo difícil de testear, renderizar, se vuelve tan tonto que no necesita tests, y toda la lógica pasa a un objeto que sí se prueba fácil. Acá, un **presentador** que convierte la entidad en un **view model** hecho solo de strings:

```python adaptadores/impresion.py · El view model
@dataclass(frozen=True)
class LineaImpresa:
    descripcion: str
    cantidad: str
    precio_unitario: str
    importe: str


@dataclass(frozen=True)
class ComprobanteImpreso:
    titulo: str
    numero: str
    fecha: str
    cliente: str
    documento: str
    referencia: str
    lineas: tuple[LineaImpresa, ...]
    subtotal: str
    igv: str
    total: str
    en_letras: str
    estado: str
```

```python adaptadores/impresion.py · El presentador
def presentar(c: Comprobante) -> ComprobanteImpreso:
    documento = c.cliente.documento
    return ComprobanteImpreso(
        titulo=_titulo(c.tipo),
        numero=_numero(c.numero),
        fecha=c.fecha.strftime("%d/%m/%Y"),
        cliente=c.cliente.nombre,
        documento=f"{documento.tipo.name} {documento.numero}" if documento else "",
        referencia=f"Modifica a {_numero(c.referencia)}: {c.sustento}" if c.referencia else "",
        lineas=tuple(
            LineaImpresa(i.descripcion, _cantidad(i.cantidad), _soles(i.precio_unitario), _soles(i.valor_venta))
            for i in c.items
        ),
        subtotal=_soles(c.subtotal),
        igv=_soles(c.igv),
        total=_soles(c.total),
        en_letras=en_letras(c.total),
        estado=_estado(c.estado),
    )


def _numero(numero: NumeroComprobante) -> str:
    return f"{numero.serie}-{numero.correlativo:08d}"


def _soles(monto: Decimal) -> str:
    return f"S/ {monto:,.2f}"


def _cantidad(cantidad: Decimal) -> str:
    return f"{cantidad.normalize():f}"
```

`normalize()` saca los ceros que agrega la columna `Numeric(12, 3)`: `2.000` pasa a `2` y `1.500` a `1.5`. El `:f` evita que `100` salga como `1E+2`. `_titulo` y `_estado` son un `match` con `assert_never`, como en [tipos](/blog/clean-architecture/tipos): si aparece un estado nuevo, mypy avisa que el impreso no sabe mostrarlo.

## El monto en letras

```python adaptadores/impresion.py · En letras
def en_letras(monto: Decimal) -> str:
    soles, centimos = divmod(int(monto * 100), 100)
    return f"SON: {_entero(soles).upper()} CON {centimos:02d}/100 SOLES"


def _entero(n: int) -> str:
    if n == 0:
        return "cero"
    millones, resto = divmod(n, 1_000_000)
    miles, unidades = divmod(resto, 1_000)
    partes = []
    if millones:
        partes.append("un millón" if millones == 1 else f"{_apocope(_hasta_999(millones))} millones")
    if miles:
        partes.append("mil" if miles == 1 else f"{_apocope(_hasta_999(miles))} mil")
    if unidades:
        partes.append(_hasta_999(unidades))
    return " ".join(partes)


def _hasta_999(n: int) -> str:
    if n == 100:
        return "cien"
    centenas, resto = divmod(n, 100)
    if resto < 30:
        decenas = _UNIDADES[resto]
    else:
        d, u = divmod(resto, 10)
        decenas = f"{_DECENAS[d]} y {_UNIDADES[u]}" if u else _DECENAS[d]
    return " ".join(p for p in (_CENTENAS[centenas], decenas) if p)


def _apocope(texto: str) -> str:
    if texto.endswith("veintiuno"):
        return texto.removesuffix("veintiuno") + "veintiún"
    if texto.endswith("uno"):
        return texto.removesuffix("uno") + "un"
    return texto
```

`_UNIDADES` va de «uno» a «veintinueve», porque hasta ahí el castellano escribe una sola palabra; `_DECENAS` y `_CENTENAS` son las tablas de siempre. Lo que tiene trampa es el idioma: «cien» pero «ciento uno», «un mil» no existe, y antes de «mil» o «millones» el «uno» se apocopa: «veintiún mil», «ciento un mil», «treinta y un millones». Los casos son la especificación, y por eso el test es una tabla:

```python tests/test_impresion.py · Extracto
@pytest.mark.parametrize(
    ("monto", "texto"),
    [
        ("100.00", "SON: CIEN CON 00/100 SOLES"),
        ("101.10", "SON: CIENTO UNO CON 10/100 SOLES"),
        ("21000.00", "SON: VEINTIÚN MIL CON 00/100 SOLES"),
        ("101999.99", "SON: CIENTO UN MIL NOVECIENTOS NOVENTA Y NUEVE CON 99/100 SOLES"),
        ("31500000.00", "SON: TREINTA Y UN MILLONES QUINIENTOS MIL CON 00/100 SOLES"),
    ],
)
def test_en_letras(monto: str, texto: str) -> None:
    assert en_letras(Decimal(monto)) == texto
```

## La plantilla, humilde

```html adaptadores/plantillas/impreso.html · Extracto
<h1>{{ c.titulo }}</h1>
<p><strong>{{ c.numero }}</strong> · {{ c.fecha }}</p>
<p>{{ c.cliente }}{% if c.documento %} · {{ c.documento }}{% endif %}</p>
{% for l in c.lineas %}
<tr><td>{{ l.descripcion }}</td><td class="monto">{{ l.cantidad }}</td><td class="monto">{{ l.precio_unitario }}</td><td class="monto">{{ l.importe }}</td></tr>
{% endfor %}
<p class="monto">Op. gravada {{ c.subtotal }}<br>IGV 18 % {{ c.igv }}<br><strong>Total {{ c.total }}</strong></p>
<p>{{ c.en_letras }}</p>
```

Imprime campos y recorre una lista. Nada que probar. Y como `Jinja2Templates` escapa el HTML por defecto, un cliente llamado `<script>` se imprime como texto.

## La ruta

```python adaptadores/paginas.py · El impreso
    @rutas.get("/comprobantes/{numero}/impreso")
    def impreso(request: Request, numero: str) -> Response:
        with nueva_unidad() as uow:
            comprobante = uow.comprobantes.obtener(NumeroComprobante.desde_texto(numero))
        if comprobante is None:
            raise HTTPException(404, f"No existe el comprobante {numero}")
        return _PLANTILLAS.TemplateResponse(request, "impreso.html", {"c": presentar(comprobante)})
```

El mismo `presentar()` sirve para un PDF con WeasyPrint o para el cuerpo de un correo. Un ticket de 80 mm para impresora térmica es otra plantilla con el mismo view model.

```python tests/test_impresion.py · El presentador
def test_presentar() -> None:
    factura = Comprobante.emitir(
        TipoComprobante.FACTURA,
        NumeroComprobante("F001", 42),
        EMPRESA,
        [Item("Mouse", Decimal("2.000"), Decimal("49.9000"))],
        hoy(),
    )

    impreso = presentar(factura)

    assert impreso.numero == "F001-00000042"
    assert impreso.lineas == (LineaImpresa("Mouse", "2", "S/ 49.90", "S/ 99.80"),)
    assert impreso.total == "S/ 117.76"
```

> **Quedate con esto**
> El formato de presentación no es del dominio ni de la plantilla: es de un presentador que convierte la entidad en un view model de strings. La plantilla queda tan tonta que no necesita tests; el presentador se prueba con un `assert`. Un `match` con `assert_never` garantiza que cada estado tenga su texto. Y el mismo view model sirve para HTML, PDF o ticket.
