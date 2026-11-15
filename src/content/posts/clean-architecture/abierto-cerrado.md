---
title: "Abierto/cerrado: agregar sin modificar"
description: El contador quiere el listado en CSV, después en TXT para su sistema, después en el formato que pida el próximo. Cómo sumar formatos sin tocar lo que ya funciona.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, solid]
goal: Diseñar un punto de extensión cuando el cambio es predecible, y no antes.
course: clean-architecture-python
section: solid
order: 2
---

El enunciado clásico: **un módulo debería estar abierto a la extensión y cerrado a la modificación**. Dicho en concreto: agregar un caso nuevo no debería obligarte a editar, y volver a probar, los casos que ya andan.

## El pedido que se repite

Primero el contador pide el listado del mes en CSV para abrirlo en Excel. Un mes después, un TXT separado por `|` para importarlo en su sistema contable. La versión directa:

```python adaptadores/api.py · Mal · cada formato modifica el endpoint
@app.get("/exportar/{formato}")
def exportar(formato: str, desde: date, hasta: date) -> Response:
    filas = consultas.listar(desde, hasta)
    if formato == "csv":
        ...
    elif formato == "txt":
        ...
    else:
        raise HTTPException(404)
```

Cada formato nuevo es otro `elif` en la misma función. El que agrega Excel puede romper el TXT, y el PR de un formato obliga a revisar todos.

## Un punto de extensión

```python adaptadores/exportar.py
class Exportador(Protocol):
    extension: str
    tipo_mime: str

    def exportar(self, filas: Sequence[FilaListado]) -> bytes: ...


class CsvParaExcel:
    extension = "csv"
    tipo_mime = "text/csv; charset=utf-8"

    def exportar(self, filas: Sequence[FilaListado]) -> bytes:
        salida = io.StringIO()
        escritor = csv.writer(salida)
        escritor.writerow(["Número", "Fecha", "Cliente", "Total", "Estado"])
        escritor.writerows((f.numero, f.fecha.isoformat(), f.cliente, f.total, f.estado) for f in filas)
        return salida.getvalue().encode("utf-8-sig")


class TxtContable:
    extension = "txt"
    tipo_mime = "text/plain; charset=windows-1252"

    def exportar(self, filas: Sequence[FilaListado]) -> bytes:
        lineas = (
            "|".join((f.numero.replace("-", "|"), f.fecha.strftime("%d/%m/%Y"), f.cliente, f"{f.total:.2f}"))
            for f in filas
        )
        return "\r\n".join(lineas).encode("cp1252", errors="replace")


EXPORTADORES: dict[str, Exportador] = {e.extension: e for e in (CsvParaExcel(), TxtContable())}
```

```python adaptadores/api.py · El endpoint no vuelve a cambiar
@app.get("/exportar/{formato}")
def exportar(formato: str, desde: date, hasta: date) -> Response:
    exportador = EXPORTADORES.get(formato)
    if exportador is None:
        raise HTTPException(404, f"Formato no disponible: {formato}")
    return Response(
        exportador.exportar(consultas.listar(desde, hasta, limite=10_000)),
        media_type=exportador.tipo_mime,
        headers={"Content-Disposition": f'attachment; filename="comprobantes.{exportador.extension}"'},
    )
```

Agregar Excel es una clase nueva y una entrada en la tupla. El endpoint, el CSV y el TXT no se tocan.

Dos detalles que no tienen nada que ver con SOLID y te van a pasar igual:

- **`utf-8-sig`** agrega la marca BOM al principio. Sin ella, Excel en Windows abre el CSV como ANSI y «José Ñique» aparece como «JosÃ© Ã‘ique».
- **`cp1252`** porque muchos sistemas contables de escritorio esperan ANSI y no UTF-8. `errors="replace"` cambia por `?` lo que no entra, en vez de explotar.

## Las formas de extender en Python

| Forma | Cuándo |
|---|---|
| `Protocol` + diccionario | Cada variante tiene datos además del comportamiento, como acá |
| Diccionario de funciones | Las variantes son solo una función: `dict[str, Callable[..., bytes]]` |
| `functools.singledispatch` | La variante depende del tipo del argumento |
| Herencia | Casi nunca: ver [sustitución de Liskov](/blog/clean-architecture/sustitucion-de-liskov) |

## Cuándo no

Un punto de extensión es una indirección más, y paga solo si el cambio es **predecible y recurrente**: formatos de exportación, proveedores de pago, PSE, medios de notificación.

No lo pagues por adelantado. La tasa del IGV es una constante, `TASA_IGV`, no una «estrategia de impuestos» con su interfaz. Cambió pocas veces en décadas, y si cambia es una línea. Una regla práctica: la primera variante es código directo, la segunda un `if`, y recién con la tercera aparece el punto de extensión, cuando ya sabés qué varía de verdad.

## A escala de sistema

Toda la arquitectura del curso es abierto/cerrado aplicado en grande. Sumar una entrada nueva, como la [pantalla de caja](/blog/clean-architecture/interfaz-web) o el [CLI](/blog/clean-architecture/segunda-entrada), o cambiar de PSE, no modifica ni el dominio ni los casos de uso.

```python tests/test_exportar.py · Extracto
def test_csv_con_bom_para_que_excel_respete_los_acentos() -> None:
    contenido = CsvParaExcel().exportar(FILAS)
    assert contenido.startswith(b"\xef\xbb\xbf")
    assert "B001-7,2026-10-18,José Ñique,59.00,pendiente" in contenido.decode("utf-8-sig")
```

> **Quedate con esto**
> Abierto/cerrado significa que agregar un caso no obliga a editar los que ya funcionan. En Python, un `Protocol` con un diccionario de implementaciones resuelve la mayoría de los casos. Pero cada punto de extensión cuesta: ponelo donde el cambio es predecible y recurrente, y no antes de la tercera variante.
