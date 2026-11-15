---
title: "Widgets de solo lectura y editables"
description: La diferencia entre mostrar un valor y dejar que el usuario lo cambie.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Saber cuál de los dos necesitás y qué cambia.
course: odoo-web-framework
section: widgets
order: 3
---

El semáforo de la lección anterior **muestra**. No deja cambiar nada, y está bien: los días en taller se calculan solos.

Pero muchos widgets tienen que escribir. Esta lección es sobre esa mitad.

## Escribir un valor

```javascript
async alCambiar(nuevoValor) {
    await this.props.record.update({ [this.props.name]: nuevoValor });
}
```

`record.update()` recibe un objeto con los campos a cambiar y devuelve una promesa.

Fijate `[this.props.name]` entre corchetes: es una clave calculada, para que el widget siga sirviendo en cualquier campo. Mismo criterio que al leer.

**`update` no guarda en la base.** Marca el registro como modificado y dispara los recálculos del lado del cliente —los campos calculados editables, los `onchange`—. El guardado lo hace el usuario con el botón, o el formulario cuando corresponda.

Si lo que querés es guardar de verdad:

```javascript
await this.props.record.save();
```

Usalo con cuidado: guardar sin que el usuario lo pida es sorprendente. Reservalo para widgets donde la acción **es** el guardado, como un botón de «marcar como hecho».

## Respetar `readonly`

```xml
<t t-name="service_workshop.SlaTargetField">
    <span t-if="props.readonly" t-esc="valorMostrado"/>
    <input t-else=""
           type="number"
           class="form-control form-control-sm"
           t-att-value="props.record.data[props.name]"
           t-on-change="(ev) => this.alCambiar(parseInt(ev.target.value))"/>
</t>
```

`props.readonly` viene de `standardFieldProps` y junta varias cosas: el modo del formulario, el atributo `readonly` del campo en la vista, y los permisos del usuario.

**Respetarlo no es opcional.** Un widget que ignora `readonly` deja editar campos que el usuario no debería tocar — incluyendo los que están restringidos por grupo. El servidor va a rechazar la escritura, pero la interfaz habrá mentido.

## Un widget editable completo

```javascript service_workshop/static/src/fields/sla_target/sla_target_field.js
import { Component } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

export class SlaTargetField extends Component {
    static template = "service_workshop.SlaTargetField";
    static props = { ...standardFieldProps };

    get valor() {
        return this.props.record.data[this.props.name] || 0;
    }

    async alCambiar(ev) {
        const n = parseInt(ev.target.value, 10);
        if (Number.isNaN(n) || n < 1) {
            ev.target.value = this.valor;
            return;
        }
        await this.props.record.update({ [this.props.name]: n });
    }
}

registry.category("fields").add("sla_target", {
    component: SlaTargetField,
    displayName: _t("Objetivo de SLA"),
    supportedTypes: ["integer"],
});
```

Fijate la validación: si el valor no sirve, **restaura lo que había** en vez de escribir basura. Es lo mínimo que debe hacer un widget editable.

## Validación del lado del cliente

Validar en el cliente es una **cortesía**, no una defensa. El usuario puede escribir por RPC sin pasar por tu widget, así que la regla de verdad va en un `@api.constrains` del modelo — como vimos en el curso de backend.

Lo que gana la validación del cliente es inmediatez: el usuario se entera al escribir, no al guardar.

```javascript
async alCambiar(ev) {
    const n = parseInt(ev.target.value, 10);
    if (n > 365) {
        this.notification.add(_t("El SLA no puede superar un año."), { type: "warning" });
        ev.target.value = this.valor;
        return;
    }
    await this.props.record.update({ [this.props.name]: n });
}
```

El servicio `notification` tiene su lección más adelante.

## El mismo widget en lista y en formulario

Un widget de campo se usa en los dos lados, y el espacio no es el mismo.

```xml
<t t-name="service_workshop.SlaLightField">
    <span class="o_sla_light d-inline-flex align-items-center gap-1"
          t-att-class="'o_sla_' + nivel">
        <i class="fa fa-circle small"/>
        <span class="d-none d-md-inline"><t t-esc="dias"/> días</span>
    </span>
</t>
```

Las clases de Bootstrap `d-none d-md-inline` esconden el texto en pantallas chicas y dejan solo el círculo. En una celda angosta, un widget que desborda rompe la tabla entera.

Si el widget no tiene sentido en una lista, el descriptor lo puede declarar:

```javascript
registry.category("fields").add("sla_light", {
    component: SlaLightField,
    supportedTypes: ["integer"],
    listViewWidth: 90,
});
```

`listViewWidth` fija el ancho de la columna. Hay otras banderas parecidas en el core; la forma de descubrirlas es leer los descriptores de `addons/web/static/src/views/fields/`.

## Cuándo escribir un widget editable

Casi nunca, y esto vale decirlo: **Odoo ya trae widgets para todo lo común**.

```bash Terminal · lo que ya existe
grep -rh 'registry.category("fields").add' addons/*/static/src/ | sed 's/.*add("//; s/".*//' | sort -u
```

Esa lista tiene decenas de entradas: `badge`, `priority`, `progressbar`, `handle`, `many2many_tags`, `image`, `percentage`, `remaining_days`…

**Antes de escribir uno, buscá ahí.** Un widget propio es código que hay que mantener en cada actualización de Odoo; uno del core lo mantiene Odoo.

Escribí el tuyo cuando la representación es **específica de tu negocio** —como el semáforo de SLA del taller— no cuando lo que querés es un porcentaje con otro color.

> **Quedate con esto**
> `record.update()` marca el registro como modificado y dispara los recálculos del cliente, pero **no guarda**: el guardado es del usuario. Respetá `props.readonly` siempre, porque ignorarlo es dejar editar lo que el servidor va a rechazar. Y antes de escribir un widget editable, revisá la lista de los que Odoo ya trae.
