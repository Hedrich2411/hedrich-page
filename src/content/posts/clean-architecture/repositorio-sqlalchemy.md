---
title: "El repositorio con SQLAlchemy"
description: Tablas separadas de las entidades, un correlativo que no se duplica con dos cajas a la vez y la unidad de trabajo sobre una sesión.
date: 2026-10-19
topic: Backend
tags: [python, sqlalchemy, postgresql]
goal: Implementar los puertos de persistencia con SQLAlchemy sin que el dominio se entere.
course: clean-architecture-python
section: adaptadores
order: 1
---

Hasta acá el sistema funciona entero en memoria. Toca la primera pieza de infraestructura real: guardar en PostgreSQL.

## Las tablas no son las entidades

```python adaptadores/tablas.py
class Base(DeclarativeBase):
    pass


class SerieFila(Base):
    __tablename__ = "series"

    serie: Mapped[str] = mapped_column(String(4), primary_key=True)
    ultimo: Mapped[int] = mapped_column(default=0)


class ComprobanteFila(Base):
    __tablename__ = "comprobantes"
    __table_args__ = (
        UniqueConstraint("serie", "correlativo"),
        Index("ix_comprobantes_fecha", "fecha", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(2))
    serie: Mapped[str] = mapped_column(String(4))
    correlativo: Mapped[int]
    fecha: Mapped[date]
    cliente_nombre: Mapped[str]
    cliente_doc_tipo: Mapped[str | None] = mapped_column(String(1))
    cliente_doc_numero: Mapped[str | None] = mapped_column(String(11))
    estado: Mapped[str] = mapped_column(String(10), index=True)
    motivo_rechazo: Mapped[str] = mapped_column(default="")
    referencia_serie: Mapped[str | None] = mapped_column(String(4))
    referencia_correlativo: Mapped[int | None]
    sustento: Mapped[str] = mapped_column(default="")
    # copia para las consultas: la fuente de verdad son los ítems
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    items: Mapped[list["ItemFila"]] = relationship(order_by="ItemFila.id", cascade="all, delete-orphan")


class ItemFila(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    comprobante_id: Mapped[int] = mapped_column(ForeignKey("comprobantes.id"))
    descripcion: Mapped[str]
    cantidad: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    precio_unitario: Mapped[Decimal] = mapped_column(Numeric(12, 4))
```

`ComprobanteFila` es la forma de los datos en la base; `Comprobante`, la forma del negocio. Se parecen y no son lo mismo:

- La fila tiene un `id` autoincremental; la entidad se identifica por serie y correlativo.
- La fila aplana el cliente en tres columnas; la entidad tiene un `Cliente` con un `Documento` validado.
- La fila guarda `total` para poder filtrar y ordenar en SQL; la entidad lo calcula.

Usar el modelo de SQLAlchemy como entidad ahorra el mapeo y mete `sqlalchemy` en el dominio, con lo que eso trae: objetos atados a una sesión abierta, atributos que se cargan solos, `Mapped[...]` en medio del negocio. SQLAlchemy puede mapear clases propias sin herencia con `registry.map_imperatively`, pero choca con `frozen=True` y con las tuplas. Dos clases y dos funciones de mapeo son más aburridas y más fáciles de seguir.

## El repositorio

```python adaptadores/sql.py · ComprobantesSql
def _con_items() -> Select[ComprobanteFila]:
    return select(ComprobanteFila).options(selectinload(ComprobanteFila.items))


class ComprobantesSql:
    def __init__(self, sesion: Session):
        self._sesion = sesion

    def agregar(self, comprobante: Comprobante) -> None:
        self._sesion.add(_a_fila(comprobante))

    def obtener(self, numero: NumeroComprobante, bloquear: bool = False) -> Comprobante | None:
        consulta = _con_items().filter_by(serie=numero.serie, correlativo=numero.correlativo)
        if bloquear:
            consulta = consulta.with_for_update()
        fila = self._sesion.scalar(consulta)
        return _a_entidad(fila) if fila else None

    def notas_de(self, numero: NumeroComprobante) -> list[Comprobante]:
        filas = self._sesion.scalars(
            _con_items().filter_by(referencia_serie=numero.serie, referencia_correlativo=numero.correlativo)
        )
        return [_a_entidad(fila) for fila in filas]

    def pendientes(self, limite: int) -> list[Comprobante]:
        filas = self._sesion.scalars(
            _con_items().filter_by(estado=Estado.PENDIENTE).order_by(ComprobanteFila.id).limit(limite)
        )
        return [_a_entidad(fila) for fila in filas]

    def actualizar_estado(self, comprobante: Comprobante) -> None:
        self._sesion.execute(
            update(ComprobanteFila)
            .filter_by(serie=comprobante.numero.serie, correlativo=comprobante.numero.correlativo)
            .values(estado=comprobante.estado, motivo_rechazo=comprobante.motivo_rechazo)
        )
```

**`_con_items()`** es la consulta base de las tres lecturas. **`selectinload`** trae los ítems de los 50 pendientes en una sola consulta extra. Sin él, el mapeo dispara una consulta por comprobante al leer `fila.items`: 51 consultas en lugar de 2.

**`actualizar_estado`** escribe solo las dos columnas que cambian. Un comprobante emitido no cambia de ítems ni de cliente, así que un `guardar()` genérico que reescriba todo sería más código y más riesgo.

**`notas_de` y `bloquear`** son para las notas de crédito. Por qué hace falta bloquear está en [agregados](/blog/clean-architecture/agregados).

## El mapeo

```python adaptadores/sql.py · De fila a entidad
def _a_entidad(fila: ComprobanteFila) -> Comprobante:
    documento = None
    if fila.cliente_doc_tipo and fila.cliente_doc_numero:
        documento = Documento(TipoDocumento(fila.cliente_doc_tipo), fila.cliente_doc_numero)
    referencia = None
    if fila.referencia_serie and fila.referencia_correlativo:
        referencia = NumeroComprobante(fila.referencia_serie, fila.referencia_correlativo)
    return Comprobante(
        tipo=TipoComprobante(fila.tipo),
        numero=NumeroComprobante(fila.serie, fila.correlativo),
        cliente=Cliente(fila.cliente_nombre, documento),
        items=tuple(Item(i.descripcion, i.cantidad, i.precio_unitario) for i in fila.items),
        fecha=fila.fecha,
        estado=Estado(fila.estado),
        motivo_rechazo=fila.motivo_rechazo,
        referencia=referencia,
        sustento=fila.sustento,
    )
```

Acá se ve por qué `emitir()` y el constructor van separados: reconstruir llama al constructor, sin reglas de emisión. `_a_fila` es el espejo y no tiene nada interesante.

## El correlativo sin duplicados

```python adaptadores/sql.py · SeriesSql
class SeriesSql:
    def __init__(self, sesion: Session):
        self._sesion = sesion

    def siguiente(self, serie: str) -> int:
        ultimo: int | None = self._sesion.scalar(
            update(SerieFila)
            .filter_by(serie=serie)
            .values(ultimo=SerieFila.ultimo + 1)
            .returning(SerieFila.ultimo)
        )
        if ultimo is None:
            raise ErrorDeDominio(f"La serie {serie} no está registrada")
        return ultimo
```

Es una sola sentencia: `UPDATE series SET ultimo = ultimo + 1 WHERE serie = 'F001' RETURNING ultimo`. El `UPDATE` bloquea la fila hasta que termina la transacción. Si dos cajas emiten a la vez, la segunda espera a que la primera confirme o deshaga, y recién ahí obtiene su número:

| | Caja 1 | Caja 2 |
|---|---|---|
| 1 | `UPDATE` → 43, bloquea la fila | |
| 2 | | `UPDATE` → espera |
| 3 | `COMMIT` | |
| 4 | | → 44 |

Si la caja 1 hace rollback en lugar de commit, la caja 2 recibe el 43. Sin saltos ni duplicados. El `UniqueConstraint(serie, correlativo)` queda como red de seguridad.

Con `SELECT max(correlativo)` y después un `INSERT`, las dos cajas leen 42 a la vez y las dos insertan el 43.

El costo es que el bloqueo dura lo que dura la transacción. Por eso emitir no llama al PSE: si la transacción esperara a SUNAT, cada caja esperaría a la anterior.

## La unidad de trabajo

```python adaptadores/sql.py · UnidadSql
class UnidadSql:
    comprobantes: ComprobantesSql
    series: SeriesSql

    def __init__(self, fabrica: sessionmaker[Session]):
        self._fabrica = fabrica

    def __enter__(self) -> Self:
        self._sesion = self._fabrica()
        self.comprobantes = ComprobantesSql(self._sesion)
        self.series = SeriesSql(self._sesion)
        return self

    def __exit__(self, *exc: object) -> None:
        self._sesion.rollback()
        self._sesion.close()

    def confirmar(self) -> None:
        self._sesion.commit()
```

Una sesión nueva por cada `with`. `__exit__` siempre hace rollback: si ya se confirmó, no queda nada que deshacer.

## Tests contra una base de verdad

```python tests/conftest.py
@pytest.fixture
def fabrica() -> sessionmaker[Session]:
    motor = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(motor)
    fabrica = sessionmaker(motor)
    with fabrica.begin() as sesion:
        sesion.add_all([SerieFila(serie=serie) for serie in ("F001", "B001", "FC01", "BC01")])
    return fabrica
```

```python tests/test_sql.py · Lo que el fake no podía probar
def test_correlativo_avanza_y_no_se_pierde_si_falla(fabrica: sessionmaker[Session]) -> None:
    emitir(fabrica)
    with pytest.raises(ErrorDeDominio):
        emitir(fabrica, Cliente("Ana"))
    emitir(fabrica)

    with UnidadSql(fabrica) as uow:
        assert uow.comprobantes.obtener(NumeroComprobante("F001", 2)) is not None
        assert uow.comprobantes.obtener(NumeroComprobante("F001", 3)) is None
```

La segunda emisión, una factura sin RUC, falla después de reservar el 2. El rollback lo libera y la tercera lo usa.

`StaticPool` hace que todas las sesiones compartan la conexión, porque con `sqlite://` cada conexión nueva es una base vacía distinta. SQLite alcanza para probar el mapeo y las transacciones, pero no los bloqueos concurrentes ni el comportamiento exacto de `Numeric`. Si tu CI puede levantar un PostgreSQL, como un servicio de GitHub Actions o con `testcontainers`, corré estos mismos tests ahí también.

> **Quedate con esto**
> Las filas de SQLAlchemy y las entidades son clases distintas con dos funciones de mapeo, y reconstruir usa el constructor, no `emitir()`. El correlativo se reserva con `UPDATE ... RETURNING`, que bloquea la fila y no deja saltos ni duplicados. `selectinload` evita una consulta por comprobante. Y la transacción de emitir tiene que ser corta: nada de llamadas externas adentro.
