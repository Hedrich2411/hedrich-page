---
title: "Herencia de plantillas con t-inherit"
description: El equivalente del lado del cliente a la herencia de vistas XML.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, qweb]
goal: Modificar una plantilla de Odoo sin copiarla entera.
course: odoo-web-framework
section: qweb
order: 3
---

Esta es **la razón por la que Odoo usa plantillas XML en vez de JSX**.

Podés modificar una plantilla del cliente web de Odoo desde tu módulo, sin tocar su código, sin copiarla y sin romperte en la próxima actualización. Con JSX eso no se puede: habría que copiar el componente entero.

En el core hay 111 plantillas que heredan de otra. Es un mecanismo central, no una curiosidad.

## La forma

```xml service_workshop/static/src/views/order_list.xml
<?xml version="1.0" encoding="UTF-8" ?>
<templates xml:space="preserve">

    <t t-name="service_workshop.ListRenderer"
       t-inherit="web.ListRenderer"
       t-inherit-mode="primary">

        <xpath expr="//table" position="before">
            <div class="alert alert-info small">
                Arrastrá una orden a otra etapa desde el tablero.
            </div>
        </xpath>

    </t>

</templates>
```

Tres atributos:

- **`t-name`** — el nombre de **tu** plantilla.
- **`t-inherit`** — de cuál heredás, con el prefijo de su módulo.
- **`t-inherit-mode`** — `primary` o `extension`.

Adentro van los `xpath` con su `position`, exactamente igual que en las vistas del servidor.

## `primary` vs `extension`

Esta es la decisión que hay que entender, y es la que más confunde.

**`extension`** modifica la plantilla original **en su lugar**. No creás una plantilla nueva: cambiás la que ya existe, para todo el mundo.

```xml
<t t-name="service_workshop.NotebookExt"
   t-inherit="web.Notebook"
   t-inherit-mode="extension">
    <xpath expr="//ul" position="attributes">
        <attribute name="class" add="o_mi_estilo" separator=" "/>
    </xpath>
</t>
```

A partir de ahí, **todos** los notebooks del cliente web tienen tu clase.

**`primary`** crea **una plantilla nueva** basada en la otra. La original queda intacta, y tu versión solo se usa donde vos la pidas.

```xml
<t t-name="service_workshop.ListRenderer"
   t-inherit="web.ListRenderer"
   t-inherit-mode="primary">
```

```javascript
export class OrderListRenderer extends ListRenderer {
    static template = "service_workshop.ListRenderer";
}
```

La regla: **`primary` casi siempre**. Es lo que hace el core — `account.AccountMoveFormNotebook` hereda de `web.Notebook` en modo primary y la usa solo en sus propias vistas.

`extension` solo cuando de verdad querés cambiar el comportamiento global, y sabiendo que estás tocando algo que usan todos los demás módulos.

## Los `xpath`

Son los mismos de las vistas del backend:

```xml
<xpath expr="//table" position="before">…</xpath>
<xpath expr="//div[hasclass('o_list_footer')]" position="inside">…</xpath>
<xpath expr="//t[@t-slot='toggler']" position="replace">…</xpath>
<xpath expr="//a[@class='nav-link']" position="attributes">
    <attribute name="class" add="mi-clase" separator=" "/>
</xpath>
```

`position` acepta `before`, `after`, `inside`, `replace` y `attributes`.

Dos cosas propias del cliente:

**`hasclass()`** es una función que Odoo agrega al xpath, y es más robusta que comparar el atributo `class` entero — que en el cliente suele ser largo y cambiante.

**`<attribute name="class" add="..." separator=" "/>`** suma una clase sin pisar las existentes. Es lo correcto casi siempre; reemplazar el `class` entero de un nodo del core rompe su estilo.

## Anclar en algo estable

El consejo de la lección de herencia de vistas aplica igual, y acá más todavía porque las plantillas del cliente web cambian entre versiones:

```xml Frágil
<xpath expr="//div[3]/span[2]" position="after">
```

```xml Robusto
<xpath expr="//t[@t-slot='toggler']" position="after">
<xpath expr="//div[hasclass('o_list_footer')]" position="inside">
```

Anclá en un `t-slot`, un `t-name`, un `t-ref` o una clase semántica. Nunca en la posición.

## Cuando la herencia no se aplica

El error típico:

```text
Element '<xpath expr="//table">' cannot be located in parent view
```

Significa que el xpath no encontró nada. Las causas, en orden:

**La plantilla original cambió.** Abrí el archivo real en `addons/web/static/src/...` y mirá cómo está hoy. Es la causa más frecuente al migrar de versión.

**Otro módulo la modificó antes.** Si un módulo con `extension` movió o reemplazó ese nodo y carga antes que el tuyo, cuando te toca ya no está.

**El orden de carga.** Tu módulo tiene que depender del que define la plantilla. Si heredás de `web.ListRenderer`, `web` va en `depends`.

### Cómo depurarlo

A diferencia de las vistas del servidor, **no hay un «Ver vista» para las plantillas del cliente**. Lo que sí tenés:

**El archivo original.** Buscalo por su `t-name` en el fuente de Odoo:

```bash Terminal
grep -rn 't-name="web.ListRenderer"' addons/web/static/src/
```

Es la forma más rápida y la que más uso.

**La consola.** Si la herencia falla, el error aparece al cargar con el nombre de tu plantilla y el xpath que no resolvió.

## Un caso real: agregar al pie de la lista

```xml service_workshop/static/src/views/order_list.xml
<t t-name="service_workshop.OrderListRenderer"
   t-inherit="web.ListRenderer"
   t-inherit-mode="primary">

    <xpath expr="//table" position="after">
        <div class="o_workshop_hint text-muted small p-2">
            Las órdenes en rojo llevan más de 7 días en el taller.
        </div>
    </xpath>

</t>
```

Para que se use hay que decirle a la vista que use tu renderizador, y eso es la sección de vistas.

## Con esto cierra la sección

Ya sabés escribir plantillas del cliente: mostrar datos, reaccionar al usuario y modificar las de Odoo sin tocarlas.

Lo que sigue es enchufar todo esto al cliente web: los registries, y después el semáforo de SLA como campo del formulario — que es donde por fin se va a ver en pantalla.

> **Quedate con esto**
> `primary` crea una plantilla nueva basada en otra y es lo que querés casi siempre; `extension` modifica la original para toda la aplicación. Anclá los xpath en `t-slot`, `t-name` o `hasclass()`, nunca en posiciones. Y cuando un xpath «no encuentra» algo que ves en pantalla, abrí el archivo original en el fuente de Odoo: casi siempre cambió o alguien lo movió antes que vos.
