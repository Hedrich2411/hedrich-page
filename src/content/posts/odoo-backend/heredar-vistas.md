---
title: "Heredar vistas con xpath sin romper las del vecino"
description: Cómo meter tus campos en una vista que no escribiste vos, y por qué a veces tu herencia desaparece.
date: 2026-10-10
topic: ERP
tags: [odoo, xml]
goal: Modificar una vista estándar entendiendo el orden de evaluación.
course: odoo-backend-framework
section: vistas
order: 6
---

En la sección de ORM agregamos campos a `res.partner`. Existen en la base y no se ven en ningún lado, porque el formulario de contacto lo escribió Odoo y no los conoce.

Esta lección los pone en pantalla sin tocar una línea del código de Odoo.

## Una herencia de vista es una vista más

```xml views/res_partner_views.xml
<record id="view_partner_form_service" model="ir.ui.view">
    <field name="name">res.partner.form.service</field>
    <field name="model">res.partner</field>
    <field name="inherit_id" ref="base.view_partner_form"/>
    <field name="arch" type="xml">
        <xpath expr="//field[@name='category_id']" position="after">
            <field name="service_order_count" readonly="1"/>
        </xpath>
    </field>
</record>
```

La diferencia con una vista normal es **`inherit_id`**: en vez de definir una vista entera, describe **modificaciones** sobre otra.

El `ref="base.view_partner_form"` es el identificador externo de la vista original: módulo más id. Para encontrarlo, el modo desarrollador te deja ver qué vista estás mirando.

## Posicionar: por `xpath` o por nombre de campo

La forma larga:

```xml
<xpath expr="//field[@name='category_id']" position="after">
```

Y la corta, que funciona para campos y para cualquier elemento con `name`:

```xml
<field name="category_id" position="after">
    <field name="service_order_count"/>
</field>
```

Las dos hacen lo mismo. **Usá la corta siempre que puedas**: es más legible y sobrevive mejor a los cambios de Odoo, porque no depende de la estructura del XML sino del nombre del campo.

### Los valores de `position`

| `position` | Dónde pone tu contenido |
|---|---|
| `after` | justo después del elemento |
| `before` | justo antes |
| `inside` | adentro, al final de los hijos |
| `replace` | reemplaza el elemento entero |
| `attributes` | solo cambia atributos del elemento |

### `attributes`: cambiar sin reemplazar

```xml
<field name="vat" position="attributes">
    <attribute name="required">1</attribute>
    <attribute name="string">RUC</attribute>
</field>
```

Es la forma correcta de ajustar un campo existente. **Mucho mejor que `replace`**, porque no tocás nada más del campo y no te peleás con quien también quiera modificarlo.

### `replace`, con cuidado

```xml
<field name="phone" position="replace"/>
```

Un `replace` vacío **elimina** el elemento.

Y acá va una advertencia que vale una tarde: si borrás un campo con `replace` y otro módulo —o una vista de Odoo— lo referencia en una condición, esa vista revienta. El campo tiene que existir para que las expresiones puedan leerlo.

Si lo que querés es ocultarlo, lo seguro es esto:

```xml
<field name="phone" position="attributes">
    <attribute name="invisible">1</attribute>
</field>
```

El campo sigue ahí, disponible para las condiciones, pero no se ve.

## Escribir xpath que no se rompan

Cuando el nombre de campo no alcanza, el xpath es la salida. La regla es **anclar en lo más estable**:

```xml Frágil · depende de la estructura exacta
<xpath expr="//form/sheet/notebook/page[1]/group/field[3]" position="after">
```

```xml Robusto · depende de un nombre
<xpath expr="//page[@name='sales_purchases']" position="inside">
```

Por eso insistí en la lección del formulario con ponerle `name` a cada `<page>`: es lo que le permite a otro módulo —o a vos dentro de seis meses— engancharse sin adivinar posiciones.

Algunas expresiones útiles:

```xml
//field[@name='x']                    el campo x, esté donde esté
//page[@name='x']                     la pestaña x
//group[@name='x']                    el grupo x
//div[@name='button_box']             la caja de botones de estadística
//field[@name='x'][2]                 la segunda aparición
//notebook/page[last()]               la última pestaña
```

## Orden de evaluación, o por qué tu herencia desaparece

Varias herencias sobre la misma vista se aplican **en orden de `priority`**, y con la misma prioridad, en el orden en que se cargaron los módulos.

```xml
<field name="priority">20</field>
```

El valor por defecto es 16. Más bajo, antes.

Esto importa cuando dos herencias se pisan: si otro módulo mueve o reemplaza el elemento que vos buscás, y corre antes que el tuyo, **tu xpath no encuentra nada**.

El error te dice que el elemento no existe, y vos lo estás viendo en pantalla. La explicación es que para cuando le toca a tu herencia, ya no estaba.

### Cómo depurarlo

Con el modo desarrollador activo, el menú del bicho tiene **«Ver vista»**: te muestra el XML **final**, con todas las herencias ya aplicadas. Es lo que Odoo realmente usó.

Compará eso con lo que esperabas y vas a ver enseguida quién movió qué.

El otro lugar es **Ajustes → Técnico → Vistas**: filtrás por modelo y ves todas las herencias de esa vista, con su prioridad y su módulo.

## Heredar tus propias vistas

No es solo para las de Odoo. Dentro de tu módulo también conviene, cuando una funcionalidad es opcional:

```xml views/service_order_views_warranty.xml
<record id="view_service_order_form_warranty" model="ir.ui.view">
    <field name="name">service.order.form.warranty</field>
    <field name="model">service.order</field>
    <field name="inherit_id" ref="service_workshop.view_service_order_form"/>
    <field name="arch" type="xml">
        <field name="is_warranty" position="after">
            <field name="warranty_until" invisible="not is_warranty"/>
        </field>
    </field>
</record>
```

Así el módulo base queda limpio y la extensión vive aparte. Es lo que te va a permitir después partir el taller en varios módulos sin reescribir las vistas.

## La caja de botones del contacto

Volviendo a lo que abrió la lección, así queda el botón de estadística de la lección anterior:

```xml views/res_partner_views.xml
<record id="view_partner_form_service" model="ir.ui.view">
    <field name="name">res.partner.form.service</field>
    <field name="model">res.partner</field>
    <field name="inherit_id" ref="base.view_partner_form"/>
    <field name="arch" type="xml">
        <div name="button_box" position="inside">
            <button name="action_view_service_orders" type="object"
                    class="oe_stat_button" icon="fa-wrench">
                <field name="service_order_count" widget="statinfo" string="Órdenes"/>
            </button>
        </div>
    </field>
</record>
```

`button_box` es el contenedor donde Odoo pone los botones de estadística de cualquier formulario documental. Como tiene `name`, no hace falta xpath.

## Con esto cierra la sección

El módulo ya tiene menús, lista, formulario documental, búsqueda con filtros, kanban por etapas y se integró con el formulario de contacto de Odoo.

Lo que todavía no tiene es **control de quién puede hacer qué**: hasta ahora cualquier usuario interno puede ver y modificar todo. Eso es la próxima sección.

> **Quedate con esto**
> Posicioná por nombre de campo antes que por xpath, y si necesitás xpath, anclá en un `name` y no en la estructura. Para ajustar un campo existente, `position="attributes"`, nunca `replace` — borrar un campo que otra vista referencia en una condición la rompe. Y cuando una herencia «no aparece», mirá el XML final con «Ver vista»: casi siempre otro módulo movió el elemento antes.
