---
title: "Opciones y parámetros desde la vista"
description: Pasar opciones desde el XML para que el mismo widget sirva en varios lugares.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, xml]
goal: Un widget configurable sin tocar JavaScript.
course: odoo-web-framework
section: widgets
order: 4
---

El semáforo tiene el límite en 7 días porque así lo pusimos en la vista:

```xml
<field name="days_in_shop" widget="sla_light" options="{'limite': 7}"/>
```

Esta lección es sobre esa línea: cómo el XML le habla a tu componente.

## `extractProps`

```javascript
export const slaLightField = {
    component: SlaLightField,
    supportedTypes: ["integer"],
    extractProps: ({ options }) => ({
        limite: options.limite,
    }),
};
```

`extractProps` es **el traductor entre el XML y tus props**. Odoo le pasa lo que leyó del nodo `<field>` y vos devolvés el objeto de props.

Lo que recibe:

```javascript
extractProps: ({ attrs, options, string, decorations }, dynamicInfo) => ({ ... })
```

| Argumento | Qué trae |
|---|---|
| `options` | el diccionario del atributo `options` |
| `attrs` | los demás atributos del `<field>` |
| `string` | la etiqueta |
| `decorations` | los `decoration-*` |
| `dynamicInfo` | el contexto y el dominio ya evaluados |

El `options` del XML es **un diccionario de Python** que Odoo parsea. Acepta números, strings, booleanos y listas.

## Valores por defecto

```javascript
static defaultProps = { limite: 5 };
```

Si el XML no trae `limite`, `extractProps` devuelve `undefined` y `defaultProps` lo completa. Es el lugar correcto para el default, no un `||` dentro del getter.

Con eso, las dos formas funcionan:

```xml
<field name="days_in_shop" widget="sla_light"/>                        <!-- límite 5 -->
<field name="days_in_shop" widget="sla_light" options="{'limite': 7}"/> <!-- límite 7 -->
```

## Declarar las opciones

```javascript
supportedOptions: [
    {
        label: _t("Límite en días"),
        name: "limite",
        type: "number",
        default: 5,
        help: _t("A partir de cuántos días la orden se considera atrasada."),
    },
],
```

Esto no cambia el comportamiento: **documenta**. Cuando alguien edita la vista desde la interfaz con el editor de Odoo, ve las opciones disponibles con su ayuda en vez de adivinar.

Los `type` que acepta: `number`, `string`, `boolean`, `selection`, `field`.

El último es interesante: `type: "field"` le dice a Odoo que esa opción **es el nombre de otro campo**, y la interfaz ofrece un selector de campos. Es lo que hace el `BadgeField` del core con su `color_field`.

## Apuntar a otro campo

Ese patrón vale la pena por sí mismo. Supongamos que cada tipo de equipo tiene su propio SLA, guardado en un campo del registro:

```javascript
export const slaLightField = {
    component: SlaLightField,
    supportedTypes: ["integer"],
    supportedOptions: [
        { label: _t("Límite en días"), name: "limite", type: "number" },
        { label: _t("Campo con el límite"), name: "limite_field", type: "field",
          availableTypes: ["integer"] },
    ],
    extractProps: ({ options }) => ({
        limite: options.limite,
        limiteField: options.limite_field,
    }),
};
```

```javascript En el componente
get limiteEfectivo() {
    if (this.props.limiteField) {
        return this.props.record.data[this.props.limiteField] || this.props.limite;
    }
    return this.props.limite;
}
```

```xml
<field name="sla_dias" invisible="1"/>
<field name="days_in_shop" widget="sla_light" options="{'limite_field': 'sla_dias'}"/>
```

El mismo widget ahora sirve con un límite fijo **o** con uno por registro, sin tocar JavaScript. Acordate del `invisible="1"`: el campo tiene que estar en la vista para que el cliente lo haya cargado.

## Que sirva en otro modelo

Un widget bien escrito no sabe en qué modelo está. Los dos puntos donde se puede atar sin querer:

**El nombre del campo.** Siempre `this.props.name`, nunca `"days_in_shop"`.

**Otros campos del registro.** Si tu widget lee `record.data.state`, acabás de exigir que el modelo tenga un campo `state`. Si lo necesitás, que venga por una opción como el `limite_field` de arriba.

Con esas dos reglas, el semáforo funciona igual en una orden de taller, en una tarea de proyecto o en un ticket.

## `supportedTypes`, que sí hace algo

```javascript
supportedTypes: ["integer"],
```

A diferencia de `supportedOptions`, esto **sí** tiene efecto: si alguien pone el widget en un campo de otro tipo, Odoo avisa.

Vale la pena declararlo con honestidad. Un widget que dice soportar `["integer", "float"]` y solo probaste con enteros va a fallar de forma rara el día que alguien lo use con decimales.

## Cómo queda el descriptor

```javascript service_workshop/static/src/fields/sla_light/sla_light_field.js
export const slaLightField = {
    component: SlaLightField,
    displayName: _t("Semáforo de SLA"),
    supportedTypes: ["integer"],
    supportedOptions: [
        {
            label: _t("Límite en días"),
            name: "limite",
            type: "number",
            default: 5,
            help: _t("A partir de cuántos días se considera atrasada."),
        },
    ],
    extractProps: ({ options }) => ({ limite: options.limite }),
};

registry.category("fields").add("sla_light", slaLightField);
```

## Con esto cierra la sección

El semáforo es un widget completo: lee el registro, se configura desde el XML, se traduce, documenta sus opciones y no está atado a ningún modelo.

Lo que sigue es más grande: vistas propias, donde en vez de un campo controlás la pantalla entera.

> **Quedate con esto**
> `extractProps` traduce el `options` del XML a props de tu componente, y los defaults van en `defaultProps`, no en un `||` del getter. `supportedOptions` solo documenta, pero `supportedTypes` sí valida. Y para que el widget sirva en cualquier modelo: siempre `this.props.name`, y cualquier otro campo que necesites, por opción.
