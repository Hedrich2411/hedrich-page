---
title: "Datos del módulo: XML, CSV, external IDs y noupdate"
description: Cargar datos desde el módulo sin que se pisen al actualizar, y entender los identificadores externos que usa todo Odoo.
date: 2026-10-10
topic: ERP
tags: [odoo, xml]
goal: Etapas y categorías que sobreviven a una actualización del módulo.
course: odoo-backend-framework
section: automatizacion
order: 1
---

Tu módulo necesita traer datos: la secuencia de numeración, las categorías de equipo, las etiquetas iniciales. Y hay una pregunta que decide cómo escribirlos: **¿qué pasa con esos datos cuando el cliente ya los modificó y vos actualizás el módulo?**

## Los identificadores externos

Veníamos usándolos sin nombrarlos del todo.

```xml
<record id="seq_service_order" model="ir.sequence">
```

Ese `id` **no es la clave primaria**. Es un nombre simbólico que vive en la tabla `ir_model_data` y apunta al id real.

Para Odoo, el registro se llama `service_workshop.seq_service_order`: **módulo punto id**. Dentro del mismo archivo podés omitir el prefijo; desde afuera, no.

Sirven para tres cosas:

**Referenciar sin saber el id.** `ref="service_workshop.group_service_manager"` funciona aunque el id numérico cambie entre bases.

**Actualizar en vez de duplicar.** Cuando corrés `-u`, Odoo busca ese identificador: si existe, **modifica** el registro; si no, lo crea. Por eso actualizar un módulo cien veces no te deja cien secuencias.

**Desinstalar limpio.** Al desinstalar, Odoo borra exactamente los registros que tienen identificador externo de ese módulo.

Para verlos: con el modo desarrollador, en cualquier formulario, el menú del bicho tiene «Ver metadatos».

```python
self.env.ref("service_workshop.group_service_manager")   # desde código
```

## Cargar datos con XML

```xml data/service_data.xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="seq_service_order" model="ir.sequence">
        <field name="name">Orden de servicio</field>
        <field name="code">service.order</field>
        <field name="prefix">TAL/</field>
        <field name="padding">4</field>
        <field name="company_id" eval="False"/>
    </record>

    <record id="tag_urgent" model="service.tag">
        <field name="name">Urgente</field>
        <field name="color">1</field>
    </record>

    <record id="category_computing" model="service.equipment.category">
        <field name="name">Cómputo</field>
    </record>

    <record id="category_laptops" model="service.equipment.category">
        <field name="name">Laptops</field>
        <field name="parent_id" ref="category_computing"/>
    </record>
</odoo>
```

### Las formas de dar un valor

```xml
<field name="name">Texto literal</field>
<field name="color">1</field>
<field name="parent_id" ref="category_computing"/>
<field name="company_id" eval="False"/>
<field name="sequence" eval="10 + 5"/>
<field name="date_in" eval="time.strftime('%Y-%m-%d')"/>
<field name="tag_ids" eval="[(4, ref('tag_urgent'))]"/>
```

- **Contenido directo** — el texto tal cual.
- **`ref=`** — otro registro, por su identificador externo.
- **`eval=`** — se evalúa como Python. Es la única forma de poner `False`, números calculados o comandos de relación.

Ojo con `eval="False"`: sin `eval`, `<field name="company_id">False</field>` guardaría **la cadena** «False», que es verdadera. Para valores booleanos y nulos, `eval` siempre.

## `noupdate`: la decisión importante

```xml
<odoo noupdate="1">
    <record id="tag_urgent" model="service.tag">
        <field name="name">Urgente</field>
    </record>
</odoo>
```

Esto es lo que abría la lección.

**Sin `noupdate`** (el default), cada `-u` vuelve a escribir el registro con los valores del XML. Si el cliente renombró «Urgente» a «Prioritario», la próxima actualización se lo pisa.

**Con `noupdate="1"`**, Odoo lo crea la primera vez y después **nunca lo vuelve a tocar**.

El criterio:

| Tipo de dato | `noupdate` |
|---|---|
| Datos que el usuario va a editar: etiquetas, categorías, etapas | **sí** |
| Secuencias | **sí** — el cliente puede querer otro prefijo |
| Vistas, acciones, menús | **no** — son código, tienen que actualizarse |
| Grupos y permisos | **no** — son definiciones del módulo |
| Reglas de registro | depende: la estructura sí, los dominios ajustables no |

La regla mental: **si es parte del código, se actualiza; si es contenido del cliente, no se toca**.

### La trampa de `noupdate`

Una vez que un registro se cargó con `noupdate="1"`, **cambiar el XML ya no sirve de nada** en las bases donde ya está. Tu cambio solo lo van a ver las instalaciones nuevas.

Si de verdad necesitás corregir algo ya cargado, hay que hacerlo con una migración o a mano. Por eso conviene pensarlo bien la primera vez.

Y `forcecreate="0"` en un registro individual significa «si no existe, no lo crees»: sirve para actualizar algo solo si ya está.

## Cargar con CSV

Para muchos registros parecidos, el CSV es más compacto. El nombre del archivo **es el modelo**:

```csv data/service.tag.csv
id,name,color
tag_urgent,Urgente,1
tag_warranty,Garantía,4
tag_budget,Esperando presupuesto,3
```

La primera columna es el identificador externo, el resto son campos. Para relaciones, `campo_id:id` con el identificador externo del otro registro.

Es lo que hicimos con `ir.model.access.csv`: ese archivo no es especial, es simplemente un CSV de datos para el modelo `ir.model.access`.

## Datos de demostración

```python __manifest__.py
"data": ["data/service_data.xml"],
"demo": ["demo/service_demo.xml"],
```

Los de `demo` **solo se cargan si la base se creó con datos de demostración**. Son para que alguien pueda probar el módulo con contenido realista.

Vale la pena hacerlos: un módulo que al instalarse se ve vacío es difícil de evaluar. Un módulo que viene con tres órdenes de ejemplo se entiende solo.

## Ejecutar código desde XML

```xml
<function model="service.order" name="_post_install_setup"/>
```

Llama a un método al cargar el archivo. Es útil para cálculos iniciales que no se pueden expresar como datos.

Usalo con moderación: un XML que ejecuta código es más difícil de seguir que un hook del manifest, y los hooks están pensados para eso.

## Borrar un registro

```xml
<delete model="service.tag" id="tag_obsoleta"/>
<delete model="service.tag" search="[('name', '=', 'Vieja')]"/>
```

Lo vas a necesitar cuando una versión nueva del módulo tenga que limpiar algo que la anterior dejó.

## Cómo queda

```python __manifest__.py
"data": [
    "security/service_security.xml",
    "security/ir.model.access.csv",
    "data/service_data.xml",
    "views/service_order_views.xml",
    "views/res_partner_views.xml",
    "views/menus.xml",
],
```

El orden que venimos arrastrando desde la primera sección, ahora con todas sus razones a la vista: seguridad primero porque todo la referencia, datos antes que vistas porque las vistas pueden apuntar a ellos, menús al final porque apuntan a acciones.

> **Quedate con esto**
> Un identificador externo es lo que hace que `-u` actualice en vez de duplicar. `noupdate="1"` para lo que el usuario va a editar, sin `noupdate` para lo que es código — y una vez cargado con `noupdate`, cambiar el XML ya no afecta a las bases existentes. Para booleanos y nulos, siempre `eval`.
