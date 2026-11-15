---
title: "Event Sourcing"
description: La cuenta corriente de un cliente guardada como facturas, pagos y notas de crédito en lugar de un saldo. El saldo de cualquier fecha se reconstruye, y nada se pisa.
date: 2026-10-19
topic: Backend
tags: [python, patrones, arquitectura]
goal: Guardar los hechos que cambiaron el estado en lugar del estado, para reconstruirlo en cualquier momento.
course: patrones-python
section: arquitectura
order: 2
---

La tabla `clientes` tiene una columna `saldo`. Un día el saldo de Bodega Lucha dice S/ 2 422 y el cliente jura que debe menos. ¿De dónde salió ese número? La columna no lo sabe: cada `UPDATE` pisó el valor anterior.

**Event Sourcing** guarda los **hechos**, no el resultado: se emitió una factura, llegó un pago, se emitió una nota de crédito. El saldo se calcula recorriéndolos.

## Los hechos

Cada hecho es inmutable y está en pasado:

```python cuenta.py
@dataclass(frozen=True)
class FacturaEmitida:
    fecha: date
    numero: str
    monto: Decimal


@dataclass(frozen=True)
class PagoRecibido:
    fecha: date
    operacion: str
    monto: Decimal


@dataclass(frozen=True)
class NotaDeCredito:
    fecha: date
    numero: str
    monto: Decimal


type Evento = FacturaEmitida | PagoRecibido | NotaDeCredito
```

## El estado se reconstruye

El estado de cuenta empieza en cero y aplica cada hecho:

```python cuenta.py
@dataclass
class EstadoDeCuenta:
    saldo: Decimal = Decimal(0)
    facturado: Decimal = Decimal(0)
    pagado: Decimal = Decimal(0)

    def aplicar(self, evento: Evento) -> "EstadoDeCuenta":
        match evento:
            case FacturaEmitida(monto=m):
                self.saldo += m
                self.facturado += m
            case PagoRecibido(monto=m):
                self.saldo -= m
                self.pagado += m
            case NotaDeCredito(monto=m):
                self.saldo -= m
        return self


@dataclass
class CuentaCorriente:
    cliente: str
    eventos: list[Evento] = field(default_factory=list)

    def registrar(self, evento: Evento) -> None:
        if isinstance(evento, PagoRecibido) and evento.monto > self.estado().saldo:
            raise ValueError(f"el pago de S/ {evento.monto} supera el saldo")
        self.eventos.append(evento)

    def estado(self, al: date | None = None) -> EstadoDeCuenta:
        estado = EstadoDeCuenta()
        for evento in self.eventos:
            if al is None or evento.fecha <= al:
                estado.aplicar(evento)
        return estado
```

Dos facturas, un pago y una nota de crédito:

```text Terminal
hoy:           EstadoDeCuenta(saldo=Decimal('2422.00'), facturado=Decimal('3540.00'), pagado=Decimal('1000.00'))
al 30/09:      EstadoDeCuenta(saldo=Decimal('180.00'), facturado=Decimal('1180.00'), pagado=Decimal('1000.00'))
el pago de S/ 5000 supera el saldo
historia completa:
  2026-09-05 FacturaEmitida    1180.00
  2026-09-20 PagoRecibido      1000.00
  2026-10-05 FacturaEmitida    2360.00
  2026-10-08 NotaDeCredito      118.00
```

Ahora el reclamo de Bodega Lucha tiene respuesta: la historia completa explica cada sol del saldo. Y `estado(al=...)` responde «¿cuánto debía al cierre de septiembre?» sin una tabla de cierres aparte.

Las reglas de negocio se validan **antes** de registrar el hecho, como el pago que supera el saldo. Un evento registrado ya pasó: no se valida ni se rechaza después.

## Corregir sin borrar

Si una factura estuvo mal, no se borra ni se edita: se emite una nota de crédito. Es exactamente cómo funciona la contabilidad, y cómo SUNAT exige corregir comprobantes. Por eso Event Sourcing encaja tan bien en dominios con dinero: el libro contable siempre fue un registro de eventos.

## Lo que cuesta

- **Reconstruir recorre todo.** Con miles de eventos por cuenta, se guardan **snapshots**: el estado cada cierto tiempo, y desde ahí se aplican los eventos posteriores.
- **Las consultas no son directas.** «Clientes con saldo mayor a S/ 1 000» no sale de recorrer eventos de cada cuenta. Se mantienen **proyecciones**: tablas que se actualizan con cada evento y existen solo para leer. Es CQRS.
- **Los eventos viejos no se cambian.** Si `FacturaEmitida` gana un campo, los eventos guardados no lo tienen, y el código tiene que leer las dos versiones.

Para la mayoría de las tablas de una aplicación, guardar el estado más una tabla de auditoría alcanza. Event Sourcing paga su costo donde la historia **es** el dato: cuentas corrientes, inventario, pagos, cualquier cosa que alguien va a auditar.

> **Quedate con esto**
> Event Sourcing guarda hechos inmutables en pasado y reconstruye el estado aplicándolos en orden, a la fecha que quieras. Las reglas se validan antes de registrar, y los errores se corrigen con un hecho nuevo, nunca borrando. Snapshots y proyecciones resuelven el rendimiento y las consultas. Usalo donde la historia es el dato.
