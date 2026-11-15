---
title: "La API con FastAPI"
description: Pydantic en el borde, el dominio adentro y los errores de negocio convertidos en respuestas HTTP en un solo lugar.
date: 2026-10-19
topic: Backend
tags: [python, fastapi, arquitectura]
goal: Exponer los casos de uso por HTTP con endpoints sin lógica de negocio.
course: clean-architecture-python
section: adaptadores
order: 3
---

FastAPI es un adaptador más; en el vocabulario de Clean Architecture, cada endpoint es un **controlador**: recibe la entrada, la convierte y llama al caso de uso. Su trabajo es traducir: HTTP y JSON hacia afuera, casos de uso y entidades hacia adentro. Si un endpoint tiene un `if` sobre una regla de negocio, algo se escapó del dominio.

## Lo que entra

```python adaptadores/api.py · Modelos de entrada
class DocumentoIn(BaseModel):
    tipo: TipoDocumento
    numero: str


class ItemIn(BaseModel):
    descripcion: str = Field(min_length=1)
    cantidad: Decimal = Field(gt=0)
    precio_unitario: Decimal = Field(ge=0)


class ComprobanteIn(BaseModel):
    tipo: TipoComprobante
    serie: str
    cliente_nombre: str = Field(min_length=1)
    cliente_documento: DocumentoIn | None = None
    items: list[ItemIn] = Field(min_length=1)

    def a_solicitud(self) -> SolicitudEmision:
        doc = self.cliente_documento
        return SolicitudEmision(
            tipo=self.tipo,
            serie=self.serie,
            cliente=Cliente(self.cliente_nombre, Documento(doc.tipo, doc.numero) if doc else None),
            items=tuple(Item(i.descripcion, i.cantidad, i.precio_unitario) for i in self.items),
        )
```

Pydantic y el dominio validan cosas distintas:

| Pydantic | Dominio |
|---|---|
| `cantidad` es un número | El RUC tiene un dígito verificador válido |
| `tipo` es `"01"` o `"03"` | Una factura exige RUC |
| Hay al menos un ítem | La serie corresponde al tipo |

Pydantic valida **la forma** del request; el dominio, **las reglas**. Que `cantidad > 0` esté en los dos no es una duplicación que moleste: Pydantic lo rechaza señalando el campo exacto, y el dominio lo exige venga de donde venga el ítem, porque un import de Excel no pasa por Pydantic.

Reusar `TipoDocumento` y `TipoComprobante` del dominio en los modelos es correcto: el adaptador depende del dominio, no al revés. Lo que no va es un `BaseModel` dentro del dominio.

`a_solicitud` es el único lugar donde el JSON se convierte en objetos del negocio. Si el RUC es inválido, `Documento(...)` lanza `ErrorDeDominio` ahí mismo.

## Lo que sale

```python adaptadores/api.py · Modelo de salida
class ComprobanteOut(BaseModel):
    numero: str
    fecha: date
    estado: Estado
    subtotal: Decimal
    igv: Decimal
    total: Decimal

    @classmethod
    def de(cls, c: Comprobante) -> "ComprobanteOut":
        return cls(numero=str(c.numero), fecha=c.fecha, estado=c.estado, subtotal=c.subtotal, igv=c.igv, total=c.total)
```

La entidad no se devuelve directo. La respuesta es un contrato con quien consume la API y no tiene por qué cambiar cada vez que cambia la entidad. Pydantic serializa los `Decimal` como string, `"2360.00"`, sin pasar por float.

## La app

```python adaptadores/api.py · Endpoints
def crear_app(nueva_unidad: Callable[[], UnidadDeTrabajo], consultas: ConsultasSql) -> FastAPI:
    app = FastAPI(title="Facturación")

    @app.exception_handler(ErrorDeDominio)
    async def regla_incumplida(_: Request, error: ErrorDeDominio) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.post("/comprobantes", status_code=201)
    def emitir(datos: ComprobanteIn) -> ComprobanteOut:
        comprobante = EmitirComprobante(nueva_unidad()).ejecutar(datos.a_solicitud())
        return ComprobanteOut.de(comprobante)

    @app.get("/comprobantes/{numero}")
    def ver(numero: str) -> ComprobanteOut:
        with nueva_unidad() as uow:
            comprobante = uow.comprobantes.obtener(NumeroComprobante.desde_texto(numero))
        if comprobante is None:
            raise HTTPException(404, f"No existe el comprobante {numero}")
        return ComprobanteOut.de(comprobante)

    return app
```

Es un extracto. `consultas` alimenta [el listado](/blog/clean-architecture/lecturas) y la exportación, y la versión completa de `crear_app` suma las [páginas HTML](/blog/clean-architecture/interfaz-web) con `app.include_router(...)`, un middleware de [observabilidad](/blog/clean-architecture/observabilidad) y un `GET /salud` que usan [Docker y Kubernetes](/blog/linux/docker) para saber si la API está viva.

**Un solo manejador de errores de negocio.** Cualquier `ErrorDeDominio`, venga del RUC, de la serie o del tope de la boleta, sale como 422 con su mensaje. Ningún endpoint tiene un `try`. Un error que no es de dominio es un bug y sale como 500, que es lo correcto.

**`ver` usa el repositorio directo, sin caso de uso.** Leer un comprobante por número no coordina nada, y un `ObtenerComprobante` que solo llama a `obtener` es una capa que no aporta. Clean Architecture no exige que todo pase por un caso de uso; exige que las dependencias apunten hacia adentro.

**Una unidad de trabajo nueva por request.** FastAPI corre los endpoints `def` en un pool de threads. Una sola `UnidadSql` compartida guarda su sesión en `self._sesion`, y dos requests simultáneos pisarían la misma. Por eso `crear_app` recibe una fábrica y no una instancia.

**`crear_app` recibe sus dependencias.** No lee variables de entorno ni crea el engine. Eso permite testearla con SQLite en memoria, y es lo que hace el arranque en la lección siguiente.

FastAPI tiene su propio mecanismo, `Depends`, con `dependency_overrides` para los tests, y funciona igual de bien. Elegí la closure porque deja todo el cableado a la vista en una función y no necesita overrides.

## Los tests

```python tests/conftest.py · La app sobre SQLite en memoria
@pytest.fixture
def api(fabrica: sessionmaker[Session]) -> TestClient:
    return TestClient(crear_app(lambda: UnidadSql(fabrica), ConsultasSql(fabrica)))
```

```python tests/test_api.py · Extracto
def test_emitir_y_consultar(api: TestClient) -> None:
    creado = api.post("/comprobantes", json=FACTURA)
    assert creado.status_code == 201
    assert creado.json()["numero"] == "F001-1"
    assert creado.json()["total"] == "2360.00"

    assert api.get("/comprobantes/F001-1").json()["estado"] == "pendiente"
    assert api.get("/comprobantes/F001-9").status_code == 404


def test_regla_de_negocio_es_422(api: TestClient) -> None:
    sin_ruc = {**FACTURA, "cliente_documento": None}
    respuesta = api.post("/comprobantes", json=sin_ruc)
    assert respuesta.status_code == 422
    assert respuesta.json() == {"detail": "Una factura solo se emite a un cliente con RUC"}
```

Estos tests prueban la traducción: códigos HTTP, formato del JSON y que el error llegue con su mensaje. Las reglas ya están probadas en el dominio y acá no se repiten.

> **Quedate con esto**
> Pydantic valida la forma del request y el dominio las reglas; la conversión a objetos del negocio está en un solo lugar. Los `ErrorDeDominio` se traducen a 422 en un manejador, no en cada endpoint. Una lectura simple no necesita caso de uso. Y una unidad de trabajo por request, porque los endpoints corren en threads.
