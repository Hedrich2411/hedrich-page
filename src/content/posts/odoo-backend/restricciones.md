---
title: "Restricciones: models.Constraint y @api.constrains"
description: Validar en la base de datos o en Python. Son dos herramientas distintas y elegir mal se nota cuando llegan los datos de verdad.
date: 2026-10-10
topic: ERP
tags: [odoo, orm, postgresql]
goal: Código único y «no se cierra sin diagnóstico», cada regla en la capa que le corresponde.
course: odoo-backend-framework
section: orm
order: 5
---

Hay dos lugares donde validar datos en Odoo, y no son intercambiables.

**En PostgreSQL**, con restricciones de tabla. Rápidas, infalibles, limitadas a lo que SQL sabe expresar.

**En Python**, con métodos de validación. Pueden expresar cualquier regla de negocio, a costa de ejecutarse en el servidor y solo cuando el ORM pasa por ahí.

La regla para elegir: **si SQL puede expresarla, va en SQL**. Una restricción de base no se puede saltear ni con `sudo()`, ni con una importación masiva, ni con un script que escriba directo. Una validación de Python sí.

## En la base: `models.Constraint`

```python models/service_order.py
_code_uniq = models.Constraint(
    "UNIQUE(code)",
    "Ya existe una orden con ese código.",
)
_dates_check = models.Constraint(
    "CHECK(date_done IS NULL OR date_done >= date_in)",
    "La fecha de entrega no puede ser anterior a la de ingreso.",
)
```

Es un atributo de clase: un nombre que empieza con guión bajo, el SQL de la restricción y el mensaje que ve el usuario cuando la viola.

El nombre del atributo **es el nombre de la restricción en PostgreSQL**, así que ponele algo descriptivo: cuando aparezca en un log de errores, vas a querer reconocerlo.

Los dos tipos que vas a usar son estos:

- **`UNIQUE(campo)`** — impide duplicados. Acepta varias columnas: `UNIQUE(code, company_id)`.
- **`CHECK(condición)`** — cualquier condición que PostgreSQL pueda evaluar sobre **una fila**. No puede consultar otras tablas ni otras filas.

> **Si venís de versiones anteriores**
> Esto antes era una lista llamada `_sql_constraints`, con tuplas de tres elementos. **En Odoo 19 está deprecado** y se reemplazó por `models.Constraint`. No es un detalle cosmético: en el código fuente de Odoo 19 ya no queda ningún addon estándar usando la forma vieja. Si encontrás un tutorial con `_sql_constraints`, es de otra versión.

### Índices, con la misma sintaxis

De la misma familia salen los índices declarados a nivel de modelo, que es lo que querés cuando siempre filtrás por dos campos juntos:

```python
_order_date_idx = models.Index("(partner_id, date_in DESC)")
_serial_uniq = models.UniqueIndex("(serial) WHERE serial IS NOT NULL")
```

`UniqueIndex` con un `WHERE` resuelve un caso que `UNIQUE` no puede: **único solo cuando el campo tiene valor**. Un `UNIQUE(serial)` común consideraría duplicados a dos equipos sin número de serie.

### Lo que no pueden hacer

Una restricción de base solo ve **la fila que se está escribiendo**. No puede validar nada que dependa de otra tabla ni del resto de los registros.

«El total de la orden tiene que coincidir con la suma de sus líneas» no se puede expresar con un `CHECK`: las líneas están en otra tabla. Eso va en Python.

### La trampa al agregarlas a un modelo con datos

Si agregás una restricción a un modelo que **ya tiene registros que la violan**, PostgreSQL rechaza crearla. Odoo no revierte la actualización del módulo: sigue, y deja un error en el log.

El resultado es traicionero: el módulo se actualiza, parece que todo salió bien, **y la restricción no existe**. Cuando agregues una restricción a algo que ya está en producción, mirá el log y confirmá que entró.

## En Python: `@api.constrains`

```python models/service_order.py
from odoo import api, models
from odoo.exceptions import ValidationError


class ServiceOrder(models.Model):
    _inherit = "service.order"

    @api.constrains("state", "diagnosis")
    def _check_diagnosis_before_approval(self):
        for order in self:
            if order.state in ("approved", "repair") and not order.diagnosis:
                raise ValidationError(
                    "No se puede aprobar la orden %s sin un diagnóstico cargado."
                    % order.code
                )
```

El decorador cumple dos funciones: marca el método como validación y **declara cuándo tiene que ejecutarse**. Odoo solo lo llama si alguno de esos campos cambió.

Eso importa para el rendimiento. Un `@api.constrains` sobre un campo que se toca en cada escritura corre en cada escritura.

Las mismas dos reglas de los campos calculados aplican acá:

**Iterá sobre `self`.** El método recibe un recordset, no un registro.

**Lanzá `ValidationError`**, no cualquier excepción. Es la que Odoo convierte en un mensaje legible en pantalla; cualquier otra le llega al usuario como un error del sistema.

### Cuándo corre y cuándo no

Acá está el límite que conviene tener claro: `@api.constrains` **corre cuando el ORM escribe**. Si alguien escribe directo en PostgreSQL con SQL crudo, no corre. Si un método hace un `UPDATE` con `self.env.cr.execute(...)`, tampoco.

Por eso la regla del principio: lo que se pueda expresar en SQL, en SQL.

Y una trampa concreta: **un `@api.constrains` sobre un campo relacional One2many no se dispara al modificar las líneas**. Cambiar `line_ids` desde el formulario sí lo dispara, porque el ORM escribe en la orden; pero modificar una línea directamente, no. Si la regla es sobre las líneas, la validación va en el modelo de la línea.

## Las dos del taller

Volviendo al módulo, las reglas que queremos son estas:

```python models/service_order.py · Las restricciones de la orden
_code_uniq = models.Constraint(
    "UNIQUE(code)",
    "Ya existe una orden con ese código.",
)
_dates_check = models.Constraint(
    "CHECK(date_done IS NULL OR date_done >= date_in)",
    "La fecha de entrega no puede ser anterior a la de ingreso.",
)

@api.constrains("state", "diagnosis")
def _check_diagnosis_before_approval(self):
    for order in self:
        if order.state in ("approved", "repair") and not order.diagnosis:
            raise ValidationError(
                "No se puede aprobar la orden %s sin un diagnóstico cargado." % order.code
            )
```

Las dos primeras van en SQL porque SQL puede expresarlas: un valor único y una comparación entre dos columnas de la misma fila. La tercera va en Python porque es una regla de negocio —«aprobado exige diagnóstico»— que depende de estados y no de una condición aritmética.

## Mensajes de error que sirvan

Un mensaje de error es parte de la interfaz, y se nota enseguida cuando no se lo pensó.

**Malo:** «Restricción violada.»
**Mejor:** «Ya existe una orden con ese código.»
**Mejor todavía:** «No se puede aprobar la orden TAL/0007 sin un diagnóstico cargado.»

El tercero dice **qué registro** y **qué hacer**. En Python tenés el registro a mano, así que no hay excusa para no nombrarlo. En las restricciones de SQL no podés incluir el valor, pero al menos podés decir qué pasó en lugar de qué regla se rompió.

> **Quedate con esto**
> `models.Constraint` para lo que SQL pueda expresar sobre una fila, `@api.constrains` para las reglas de negocio. La de base no se puede saltear; la de Python solo corre cuando el ORM escribe. Y si agregás una restricción a datos que ya existen, revisá el log: si algún registro la viola, la restricción no se crea y nadie te avisa.
