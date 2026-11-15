---
title: "Casos de uso y unidad de trabajo"
description: Emitir un comprobante de punta a punta sin saber qué base de datos hay detrás, y sin dejar un correlativo a medias.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Escribir un caso de uso que coordine dominio y persistencia de forma atómica.
course: clean-architecture-python
section: aplicacion
order: 1
---

El dominio sabe qué es un comprobante válido. No sabe de dónde sale el correlativo, dónde se guarda ni qué día es. Coordinar eso es trabajo del caso de uso.

Un caso de uso es **algo que el usuario quiere hacer**: emitir un comprobante, enviar los pendientes. No «el servicio de comprobantes» con veinte métodos, sino uno por intención, con un método `ejecutar`.

## Los puertos de persistencia

```python aplicacion/puertos.py · Persistencia
class Comprobantes(Protocol):
    def agregar(self, comprobante: Comprobante) -> None: ...
    def obtener(self, numero: NumeroComprobante, bloquear: bool = False) -> Comprobante | None: ...
    def notas_de(self, numero: NumeroComprobante) -> list[Comprobante]: ...
    def pendientes(self, limite: int) -> list[Comprobante]: ...
    def actualizar_estado(self, comprobante: Comprobante) -> None: ...


class Series(Protocol):
    def siguiente(self, serie: str) -> int: ...


class UnidadDeTrabajo(Protocol):
    @property
    def comprobantes(self) -> Comprobantes: ...
    @property
    def series(self) -> Series: ...

    def __enter__(self) -> Self: ...
    def __exit__(self, *exc: object) -> None: ...
    def confirmar(self) -> None: ...
```

`Comprobantes` es un repositorio: se comporta como una colección. Tiene los métodos que los casos de uso usan, ni uno más; no hay `listar_todos` ni `buscar_por_cliente` por si acaso. Los listados van [por otro camino](/blog/clean-architecture/lecturas). `notas_de` y `bloquear` los pide la nota de crédito, que ya viste en [servicios de dominio](/blog/clean-architecture/servicios-de-dominio).

`Series.siguiente` existe porque **el correlativo no se calcula, se reserva**. Calcularlo con `max() + 1` da duplicados con dos cajas emitiendo a la vez. Cómo se reserva de forma segura es problema del adaptador, y está en [el repositorio](/blog/clean-architecture/repositorio-sqlalchemy); el caso de uso solo pide el siguiente.

Los atributos de `UnidadDeTrabajo` son `@property` porque un atributo común en un `Protocol` obliga a la implementación a declarar exactamente ese tipo. Una propiedad de solo lectura acepta `ComprobantesSql` o `ComprobantesEnMemoria`. Es un detalle de mypy, pero sin él no tipa nada.

## La unidad de trabajo

Emitir hace dos escrituras: avanzar la serie y guardar el comprobante. Si la segunda falla, la primera no puede quedar, o `F001-43` queda usado sin existir: un salto en la numeración que vas a tener que explicar.

La unidad de trabajo es la transacción vista desde la aplicación:

- `with uow:` abre una transacción.
- `uow.confirmar()` la confirma.
- Salir del `with` sin confirmar, por una excepción o porque sí, la deshace.

Confirmar es explícito a propósito. Si el `with` confirmara solo al salir sin error, un `return` temprano olvidado guardaría algo a medias.

## Emitir

```python aplicacion/emitir.py
_LIMA = ZoneInfo("America/Lima")


def hoy_en_lima() -> date:
    return datetime.now(_LIMA).date()


@dataclass(frozen=True)
class SolicitudEmision:
    tipo: TipoComprobante
    serie: str
    cliente: Cliente
    items: tuple[Item, ...]


@dataclass
class EmitirComprobante:
    uow: UnidadDeTrabajo
    hoy: Callable[[], date] = hoy_en_lima

    def ejecutar(self, solicitud: SolicitudEmision) -> Comprobante:
        with self.uow:
            correlativo = self.uow.series.siguiente(solicitud.serie)
            comprobante = Comprobante.emitir(
                tipo=solicitud.tipo,
                numero=NumeroComprobante(solicitud.serie, correlativo),
                cliente=solicitud.cliente,
                items=solicitud.items,
                fecha=self.hoy(),
            )
            self.uow.comprobantes.agregar(comprobante)
            self.uow.confirmar()
        log.info(
            "%s emitido por S/ %s",
            comprobante.numero,
            comprobante.total,
            extra={"comprobante": str(comprobante.numero), "total": comprobante.total},
        )
        return comprobante
```

El `log.info` registra un hecho del negocio después de confirmar; qué hace ese `extra` lo vemos en [observabilidad](/blog/clean-architecture/observabilidad).

Lo que **no** hace importa igual: no valida el RUC, no calcula el IGV, no decide si una boleta necesita documento. Todo eso pasa dentro de `Comprobante.emitir()`. Si la emisión falla, la excepción sale del `with`, la transacción se deshace y el correlativo queda libre.

### La entrada

`SolicitudEmision` usa tipos del dominio: `Cliente` e `Item`, no diccionarios ni modelos de Pydantic. Quien llama, sea la API o un import de Excel, traduce lo suyo a esto. Cuando la solicitud llega al caso de uso, el RUC ya es un `Documento` válido.

### La fecha

Un servidor en la nube corre en UTC. A las 8 de la noche en Lima ya es la 1 de la mañana del día siguiente en UTC: con `date.today()` emitirías comprobantes con fecha de mañana durante cinco horas cada día.

`ZoneInfo("America/Lima")` lo resuelve. Necesita la base de zonas horarias, que Linux trae y que Windows o una imagen `python:slim` no; por eso `tzdata` está en las dependencias.

`hoy` es un parámetro con valor por defecto, no un puerto `Reloj`. El test pasa `hoy=lambda: date(2026, 10, 19)` y listo. Alcanza con una función; una interfaz con su clase sería ceremonia.

## Por qué una clase

`EmitirComprobante` podría ser una función `emitir(uow, solicitud, hoy=...)`. La clase conviene cuando el caso de uso se arma una vez con sus dependencias y se ejecuta muchas, como en un worker, o cuando las dependencias son varias. Si tus casos de uso tienen una dependencia y tres líneas, usá funciones.

> **Quedate con esto**
> Un caso de uso por intención, que coordina y no decide: las reglas están en el dominio. La unidad de trabajo hace atómicas las escrituras y solo confirma de forma explícita. El correlativo se reserva, no se calcula. Y la fecha de hoy es la de Lima, no la del servidor.
