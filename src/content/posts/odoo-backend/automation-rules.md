---
title: "Server actions y automation rules"
description: Automatizar sin escribir un módulo nuevo - acciones de servidor, reglas por evento y reglas por tiempo.
date: 2026-10-10
topic: ERP
tags: [odoo, python]
goal: Una alerta automática cuando una orden lleva tres días sin moverse.
course: odoo-backend-framework
section: automatizacion
order: 5
---

Hasta acá, todo lo que el módulo hace lo dispara alguien: un botón, un guardado, un asistente.

Esta lección es sobre lo que pasa solo.

## Acciones de servidor

Una **acción de servidor** (`ir.actions.server`) es una acción guardada en la base que ejecuta algo. Lo interesante es que **se puede crear desde la interfaz**, sin tocar código.

```xml data/service_automation.xml
<record id="action_assign_to_me" model="ir.actions.server">
    <field name="name">Asignarme esta orden</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="binding_model_id" ref="model_service_order"/>
    <field name="state">code</field>
    <field name="code">records.write({'user_id': env.user.id})</field>
</record>
```

Con `binding_model_id`, aparece en el menú de acciones de la lista: el técnico selecciona varias órdenes y se las asigna de una.

### Los tipos

El campo `state` define qué hace:

| `state` | Qué hace |
|---|---|
| `code` | ejecuta Python |
| `object_create` | crea un registro |
| `object_write` | actualiza campos del registro |
| `multi` | encadena varias acciones |
| `mail_post` | manda un correo o una nota |
| `next_activity` | programa una actividad |
| `followers` | agrega seguidores |

Los que no son `code` se configuran con formularios, sin escribir nada. Para un consultor funcional, eso es lo que hace a Odoo tan flexible.

### El Python disponible

```python
env            # el environment, como siempre
model          # el modelo sobre el que corre
record         # el registro actual (singular)
records        # los registros seleccionados
datetime, dateutil, time, timezone
UserError      # para abortar con un mensaje
log(mensaje)   # escribir en el log
action = {...} # devolver una acción
```

Es un **entorno restringido**: no podés importar módulos arbitrarios ni abrir archivos. Es a propósito, porque este código lo puede escribir cualquiera con permisos de administrador desde la interfaz.

## Reglas de automatización

Una acción de servidor hay que dispararla. Una **regla de automatización** (`base.automation`) la dispara sola.

> **Nota**
> Las reglas de automatización vienen en el módulo `base_automation`. Si tu módulo las define, tiene que declararlo en `depends`.

### Por evento

```xml data/service_automation.xml
<record id="automation_notify_ready" model="base.automation">
    <field name="name">Avisar al cliente cuando el equipo está listo</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="trigger">on_write</field>
    <field name="trigger_field_ids" eval="[(4, ref('field_service_order__state'))]"/>
    <field name="filter_domain">[('state', '=', 'ready')]</field>
    <field name="state">code</field>
    <field name="code">
for order in records:
    if order.partner_id.email:
        env.ref('service_workshop.mail_template_order_ready').send_mail(order.id)
    </field>
</record>
```

Los disparadores principales:

- **`on_create`** — al crear.
- **`on_write`** — al modificar.
- **`on_create_or_write`** — los dos.
- **`on_unlink`** — al borrar.
- **`on_change`** — al cambiar un campo en el formulario, antes de guardar.

**`trigger_field_ids`** limita a qué campos. Sin eso, la regla corre en cada escritura del modelo.

**`filter_domain`** es la condición que el registro tiene que cumplir **después** del cambio. Hay también `filter_pre_domain`, que se evalúa **antes**: la combinación de los dos es como se detecta una transición concreta, por ejemplo «pasó de reparación a listo» y no simplemente «está listo».

### Por tiempo

```xml data/service_automation.xml
<record id="automation_stalled_orders" model="base.automation">
    <field name="name">Alertar órdenes sin movimiento</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="trigger">on_time</field>
    <field name="trg_date_id" ref="field_service_order__write_date"/>
    <field name="trg_date_range">3</field>
    <field name="trg_date_range_type">day</field>
    <field name="filter_domain">[('state', 'not in', ['done', 'cancel'])]</field>
    <field name="state">next_activity</field>
    <field name="activity_type_id" ref="mail.mail_activity_data_todo"/>
    <field name="activity_summary">Esta orden lleva 3 días sin movimiento</field>
    <field name="activity_user_type">specific</field>
</record>
```

- **`trg_date_id`** — el campo de fecha de referencia. Acá usamos `write_date`, que Odoo mantiene solo — acordate de la lección del modelo.
- **`trg_date_range`** y **`trg_date_range_type`** — cuánto después. Un número negativo es *antes*, útil para recordatorios previos a un vencimiento.

Lo ejecuta un trabajo programado, así que **no es inmediato**: corre cuando le toca al cron, normalmente cada pocas horas. Para algo que tiene que pasar al instante, usá un disparador por evento.

### El identificador externo de un campo

```xml
ref('field_service_order__state')
```

Odoo genera un identificador externo para cada campo, con el patrón `field_<modelo_con_guiones>__<campo>`, con **doble guión bajo** antes del nombre del campo.

Es fácil de escribir mal. Para confirmarlo: Ajustes → Técnico → Campos, buscás el campo y mirás sus metadatos.

## Cuándo esto alcanza y cuándo no

Las reglas de automatización son buenísimas para lo que **el cliente va a querer cambiar**: a quién se avisa, cada cuántos días, qué condición dispara qué. Eso vive mejor como configuración que como código.

Pero tienen límites:

**Se vuelven invisibles.** Un comportamiento definido en una regla no está en el repositorio. El que lea tu código no se va a enterar, y debugear «por qué se mandó este correo» es más difícil.

**No se versionan.** No hay revisión de código ni historial de cambios sobre la lógica.

**El Python es restringido.** Para algo complejo te vas a quedar corto.

El criterio que uso: **si es lógica central del módulo, va en código**; si es una política que cada cliente ajusta, va como regla.

Y si la ponés en código como dato del módulo, acordate del `noupdate="1"` de la lección de datos: si el cliente la ajusta, no querés pisársela.

## Trabajos programados

Para una tarea periódica que no depende de registros:

```xml data/service_cron.xml
<record id="cron_service_reminder" model="ir.cron">
    <field name="name">Taller: resumen diario</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="state">code</field>
    <field name="code">model._cron_daily_summary()</field>
    <field name="interval_number">1</field>
    <field name="interval_type">days</field>
    <field name="active" eval="True"/>
</record>
```

Y el método en el modelo:

```python models/service_order.py
@api.model
def _cron_daily_summary(self):
    pendientes = self.search([("state", "not in", ["done", "cancel"])])
    _logger.info("Órdenes pendientes: %s", len(pendientes))
```

Tres cosas que conviene saber:

**Necesita `max_cron_threads` mayor que cero** en el `odoo.conf`, o no corre ninguno. En desarrollo con `workers = 0` los crons sí funcionan, pero conviene verificarlo si algo no se dispara.

**Si falla, la transacción revierte** y Odoo lo reintenta en la siguiente pasada. Un cron que falla siempre lo va a seguir intentando para siempre.

**No asumas que corre a una hora exacta.** Se ejecuta cuando le toca al planificador; si otro cron está ocupando el hilo, espera.

## Con esto cierra la sección

El módulo ya tiene datos que sobreviven actualizaciones, un asistente para operar en lote, PDFs imprimibles, chatter con historial y correo, y reglas que actúan solas.

Lo último que falta es hablar con el mundo exterior.

> **Quedate con esto**
> `trigger_field_ids` limita a qué campos dispara una regla por evento — sin eso corre en cada escritura. `filter_pre_domain` más `filter_domain` es cómo se detecta una transición y no solo un estado. Las reglas por tiempo las ejecuta un cron, así que no son inmediatas. Y lo que es lógica central va en código; lo que el cliente ajusta, como regla con `noupdate`.
