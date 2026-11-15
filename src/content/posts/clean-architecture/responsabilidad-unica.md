---
title: "Responsabilidad única: una razón para cambiar"
description: El principio de SOLID que más se cita y peor se entiende. No es «una clase, un método»; es un responsable por cada razón de cambio.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, solid]
goal: Detectar cuántas razones de cambio tiene un módulo y separarlas sin fragmentar el código.
course: clean-architecture-python
section: solid
order: 1
---

SOLID son cinco principios de diseño que juntó Robert C. Martin: responsabilidad única, abierto/cerrado, sustitución de Liskov, segregación de interfaces e inversión de dependencias. Están pensados para clases, pero en Python valen igual para módulos y funciones. Clean Architecture es lo que pasa cuando los aplicás a todo un sistema.

El primero es el más malinterpretado.

## El gestor que hace todo

```python facturas.py · Mal · cinco trabajos en una clase
class GestorDeFacturas:
    def __init__(self, db: Session, smtp: smtplib.SMTP):
        self.db = db
        self.smtp = smtp

    def emitir(self, ruc: str, items: list[dict], correo: str) -> int:
        if len(ruc) != 11 or not ruc.isdigit():
            raise ValueError("RUC inválido")
        subtotal = sum(Decimal(i["cantidad"]) * Decimal(i["precio"]) for i in items)
        igv = (subtotal * Decimal("0.18")).quantize(Decimal("0.01"), ROUND_HALF_UP)
        ultimo = self.db.scalar(select(func.max(FacturaFila.correlativo))) or 0
        fila = FacturaFila(correlativo=ultimo + 1, ruc=ruc, subtotal=subtotal, igv=igv)
        self.db.add(fila)
        self.db.commit()
        html = f"<h1>FACTURA F001-{fila.correlativo:08d}</h1><p>Total: S/ {subtotal + igv:,.2f}</p>"
        self.smtp.sendmail("ventas@empresa.pe", correo, html)
        return fila.correlativo
```

Treinta líneas razonables. La pregunta de SRP no es cuántas cosas hace, sino **quién va a pedir que cambie**:

| Si cambia… | Lo pide | Toca |
|---|---|---|
| Una regla de SUNAT | Contabilidad o legal | La validación y el cálculo |
| El formato del impreso | El área comercial | El HTML |
| La base de datos | El equipo de infraestructura | La consulta y el `commit` |
| El proveedor de correo | Operaciones | `smtplib` |

Cuatro actores, una clase. Esa es la definición útil: **un módulo debería tener un solo actor que le pida cambios**.

## Lo que cuesta no separarlo

**Un cambio arrastra a los otros.** Comercial quiere el logo en el impreso: el PR toca el archivo que calcula impuestos, y alguien tiene que revisar que el IGV siga bien.

**Los tests necesitan todo.** Para probar que el IGV de S/ 10.25 es 1.85 hace falta una sesión de base de datos y un SMTP falso.

**Dos personas, un archivo.** El que arregla el correlativo y el que cambia el HTML chocan en el mismo merge.

## Separado

Cada razón de cambio tiene su lugar en el proyecto:

| Responsabilidad | Dónde vive |
|---|---|
| Reglas de emisión e IGV | `dominio/comprobante.py` |
| Coordinar numeración, emisión y guardado | `aplicacion/emitir.py` |
| Persistencia | `adaptadores/sql.py` |
| Formato del impreso | `adaptadores/impresion.py` |
| Envío de correo | `adaptadores/correo.py` |

Cada pieza se prueba sola: el IGV con un `assert` y cero dependencias, el impreso pasándole un comprobante armado a mano, el caso de uso con fakes.

## No partir de más

El error contrario es tan común como el primero:

```python Mal · tres clases que cambian siempre juntas
class CalculadoraDeSubtotal: ...
class CalculadoraDeIgv: ...
class CalculadoraDeTotal: ...
```

Las tres cambian por la misma razón y las pide el mismo actor: si SUNAT cambia cómo se calcula el IGV, cambian las tres juntas. Separarlas no reduce el acoplamiento; lo esconde en tres archivos. Por eso `subtotal`, `igv` y `total` son tres propiedades del mismo `Comprobante`.

La otra cara de SRP es la cohesión: **lo que cambia junto, va junto**.

## Señales

- El nombre lleva «Gestor», «Manager», «Utils» o una «y».
- El archivo importa de capas que no tienen nada que ver entre sí: `sqlalchemy`, `smtplib` y `jinja2` en el mismo módulo.
- El test necesita cinco mocks para probar una cuenta.
- En el historial de git, el archivo aparece en PRs de temas que no se parecen.

> **Quedate con esto**
> Responsabilidad única es un actor por módulo: quien pide los cambios define la frontera. Separar lo que cambia por razones distintas evita que un cambio de formato arriesgue el cálculo de impuestos. Pero lo que cambia junto va junto: partir de más esconde el acoplamiento en vez de reducirlo.
