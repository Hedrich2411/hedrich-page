---
title: "Lecturas sin pasar por el dominio"
description: Los listados no necesitan entidades. Consultas directas para leer y el dominio solo para escribir.
date: 2026-10-19
topic: Backend
tags: [python, sqlalchemy, arquitectura]
goal: Separar lecturas de escrituras sin duplicar reglas ni inventar capas.
course: clean-architecture-python
section: produccion
order: 1
---

El contador quiere el listado de comprobantes del mes: número, fecha, cliente, total y estado. Con lo que tenemos, la forma «correcta» sería agregar `Comprobantes.listar(desde, hasta)` al repositorio y devolver entidades.

Para 500 comprobantes eso es traer 500 filas y sus 2.000 ítems, construir 500 `Comprobante` con sus `Item` y `Documento` validados, y calcular 500 totales sumando ítems. Todo para mostrar cinco columnas.

Las reglas del dominio existen para proteger los cambios de estado. Un listado no cambia nada.

## Una consulta, sin entidades

```python adaptadores/consultas.py
@dataclass(frozen=True)
class FilaListado:
    numero: str
    fecha: date
    cliente: str
    total: Decimal
    estado: str


class ConsultasSql:
    def __init__(self, fabrica: sessionmaker[Session]):
        self._fabrica = fabrica

    def listar(self, desde: date, hasta: date, estado: str | None = None, limite: int = 100) -> list[FilaListado]:
        c = ComprobanteFila
        consulta = (
            select(c.serie, c.correlativo, c.fecha, c.cliente_nombre, c.total, c.estado)
            .where(c.fecha.between(desde, hasta))
            .order_by(c.fecha.desc(), c.id.desc())
            .limit(limite)
        )
        if estado:
            consulta = consulta.where(c.estado == estado)
        with self._fabrica() as sesion:
            return [
                FilaListado(f"{f.serie}-{f.correlativo}", f.fecha, f.cliente_nombre, f.total, f.estado)
                for f in sesion.execute(consulta)
            ]
```

Una sola consulta, seis columnas, sin ítems. `FilaListado` es un registro plano para mostrar, no una entidad: no tiene reglas ni métodos.

Para esto existe la columna `total` de `ComprobanteFila`, la del comentario «copia para las consultas». Es una copia del total calculado, escrita al emitir. No se puede desincronizar porque un comprobante emitido no cambia sus ítems: si hay un error, se emite una nota de crédito.

## El endpoint

```python adaptadores/api.py · Listado, dentro de crear_app
    @app.get("/comprobantes")
    def listar(desde: date, hasta: date, estado: Estado | None = None) -> list[FilaListado]:
        return consultas.listar(desde, hasta, estado)
```

FastAPI serializa el dataclass directo. La misma consulta alimenta la exportación a CSV y TXT de [abierto/cerrado](/blog/clean-architecture/abierto-cerrado). `desde` y `hasta` son obligatorios a propósito: un listado sin rango sobre una tabla que crece todos los días es una consulta que hoy tarda 50 ms y en dos años tarda 30 segundos.

Para que siga rápido cuando la tabla crezca, `ComprobanteFila` tiene un índice sobre lo que filtra y ordena:

```python adaptadores/tablas.py · En ComprobanteFila
    __table_args__ = (
        UniqueConstraint("serie", "correlativo"),
        Index("ix_comprobantes_fecha", "fecha", "id"),
    )
```

## Por qué no hay puerto ni caso de uso

La API usa `ConsultasSql` directo, sin un `Protocol` en `aplicacion/` ni un `ListarComprobantes` en el medio.

Un caso de uso que solo reenvía la llamada no coordina nada. Un puerto con una sola implementación, porque los tests usan la misma con SQLite, no invierte ninguna dependencia útil. La regla de dependencias se sigue cumpliendo: la API depende de otro adaptador de su misma capa, y nada de adentro conoce a ninguno de los dos.

El día que un segundo consumidor, como un reporte en PDF o un export a Excel, necesite el mismo listado, pasa a ser un puerto. Antes no.

## La regla que sí importa

Esto es lo que se suele llamar CQRS, en su versión mínima: **escribir pasa siempre por el dominio; leer, no necesariamente**. Sin bases separadas, sin eventos, sin colas. La misma base y dos caminos.

Lo que no se negocia es la dirección: una consulta **nunca** modifica nada. Si un día alguien agrega un `UPDATE` en `ConsultasSql` «porque ya tenía la sesión abierta», se saltó todas las reglas del comprobante. Eso se ataja en el code review, y para eso el archivo se llama `consultas.py`.

## El test

```python tests/test_api.py · Listado
def test_listado(api: TestClient) -> None:
    api.post("/comprobantes", json=FACTURA)
    api.post("/comprobantes", json=FACTURA)

    filas = api.get("/comprobantes", params={"desde": "2026-01-01", "hasta": "2030-12-31"}).json()

    assert [f["numero"] for f in filas] == ["F001-2", "F001-1"]
    assert filas[0]["cliente"] == "Distribuidora Andina SAC"
```

> **Quedate con esto**
> Las reglas del dominio protegen escrituras, y un listado no las necesita. Las lecturas van con consultas directas que devuelven registros planos, y una columna copiada al emitir es aceptable si el dato no puede cambiar. Sin puerto ni caso de uso mientras haya un solo consumidor. Y una consulta nunca escribe.
