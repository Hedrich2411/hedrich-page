---
title: "Tu primer componente: template, props y setup"
description: La estructura mínima de un componente de Odoo 19 - clase, plantilla externa, props declaradas.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Un componente propio montado en el cliente web, con plantilla externa y props validadas.
course: odoo-web-framework
section: owl
order: 2
---

Vamos a escribir el componente que nos va a acompañar el curso: **un semáforo de SLA** para la orden de taller. Muestra en verde, ámbar o rojo cuántos días lleva el equipo adentro.

En esta lección lo construimos aislado. En la sección de widgets lo enchufamos al formulario como campo.

## Los dos archivos

Un componente son siempre dos archivos, en su propia carpeta:

```text
static/src/components/sla_light/
├── sla_light.js
└── sla_light.xml
```

Esa convención —una carpeta por componente, con su JS y su XML juntos— es la del core, y hace que el glob `static/src/**/*` del manifest los tome sin pensar.

## La clase

```javascript service_workshop/static/src/components/sla_light/sla_light.js
import { Component } from "@odoo/owl";

export class SlaLight extends Component {
    static template = "service_workshop.SlaLight";

    static props = {
        dias: { type: Number },
        limite: { type: Number, optional: true },
        texto: { type: String, optional: true },
    };

    static defaultProps = {
        limite: 5,
    };

    get nivel() {
        const { dias, limite } = this.props;
        if (dias >= limite) return "late";
        if (dias >= limite - 2) return "warn";
        return "ok";
    }

    get etiqueta() {
        return this.props.texto || `${this.props.dias} días`;
    }
}
```

## La plantilla

```xml service_workshop/static/src/components/sla_light/sla_light.xml
<?xml version="1.0" encoding="UTF-8" ?>
<templates xml:space="preserve">

    <t t-name="service_workshop.SlaLight">
        <span class="o_sla_light d-inline-flex align-items-center gap-1"
              t-att-class="'o_sla_' + nivel">
            <i class="fa fa-circle small"/>
            <span t-esc="etiqueta"/>
        </span>
    </t>

</templates>
```

Tres cosas del archivo XML que no se deducen:

**La raíz es `<templates>`**, en plural, y puede contener varias plantillas. Es un archivo de plantillas, no una sola.

**`xml:space="preserve"`** evita que Odoo colapse los espacios. Va siempre.

**El `t-name` lleva el prefijo del módulo** y tiene que coincidir **exactamente** con el `static template` de la clase. Si no coinciden, el error dice que la plantilla no existe y no te dice cuál esperaba.

## `static props`: la validación que conviene no saltearse

```javascript
static props = {
    dias: { type: Number },
    limite: { type: Number, optional: true },
    texto: { type: String, optional: true },
};
```

OWL **valida las props en desarrollo**. Si le pasás una prop que no declaraste, o te falta una obligatoria, o el tipo no coincide, falla con un mensaje claro apenas se renderiza.

Esto parece ceremonia y es exactamente lo contrario: es lo que convierte «el componente se ve raro» en «te falta la prop `dias`». Declaralas siempre.

Las formas que acepta:

```javascript
static props = {
    dias: Number,                              // corto, solo el tipo
    limite: { type: Number, optional: true },  // opcional
    modo: { type: String, validate: (v) => ["corto", "largo"].includes(v) },
    onClick: Function,
    registro: Object,
    "*": true,                                 // acepta props extra sin declarar
};
```

`defaultProps` completa las que no llegaron.

## `setup()` en vez del constructor

Nuestro componente no lo necesita todavía, pero es la convención y la vas a usar en cuanto haya estado:

```javascript
setup() {
    this.state = useState({ abierto: false });
    this.orm = useService("orm");
}
```

**Todos los hooks van acá.** `setup()` corre una vez, cuando el componente se crea, antes del primer render. No sobrescribas el `constructor`: OWL hace cosas ahí y `setup()` existe precisamente para que no tengas que pensar en eso.

## Los getters en la plantilla

Fijate que la plantilla usa `nivel` y `etiqueta`, que son getters de la clase:

```xml
<span t-att-class="'o_sla_' + nivel">
<span t-esc="etiqueta"/>
```

Dentro de una plantilla, **el contexto es la instancia del componente**: podés usar `this.props`, pero también escribir directo `props`, `state` y cualquier getter o método.

Los getters son el lugar natural para la lógica de presentación. Mantienen la plantilla legible y son fáciles de probar.

## Los estilos

```scss service_workshop/static/src/components/sla_light/sla_light.scss
.o_sla_light {
    font-size: 0.85em;

    &.o_sla_ok   { color: $success; }
    &.o_sla_warn { color: $warning; }
    &.o_sla_late { color: $danger; }
}
```

Variables del tema y selectores prefijados, como vimos en la sección anterior. Y el archivo vive en la misma carpeta que el componente.

## Montarlo para verlo

Todavía no está enganchado a ningún lado. Para probarlo mientras lo desarrollás, lo más simple es montarlo en el cliente web:

```javascript service_workshop/static/src/components/sla_light/prueba.js
import { registry } from "@web/core/registry";
import { SlaLight } from "./sla_light";

/** Temporal: un servicio que monta el componente para poder verlo. */
registry.category("services").add("service_workshop.prueba_sla", {
    dependencies: ["ui"],
    start() {
        console.log("SlaLight disponible:", SlaLight.template);
    },
});
```

Para esta lección alcanza con comprobar que **carga sin errores**: recargá con `?debug=assets` y mirá la consola. Si la plantilla estuviera mal nombrada o el import roto, lo sabrías ahí.

El lugar real donde va a vivir —el formulario de la orden— llega en la sección de widgets, cuando sepamos leer el registro.

## Lo que puede salir mal

| Error | Causa |
|---|---|
| `Missing template: service_workshop.SlaLight` | el `t-name` no coincide con el `static template`, o el XML no está en el bundle |
| `Invalid props for component SlaLight` | falta una prop obligatoria o el tipo no coincide |
| `Cannot read properties of undefined (reading 'dias')` | `props` llegó vacío: te olvidaste de pasarlas |
| El componente no aparece y no hay error | nadie lo está montando todavía |

El primero es el más frecuente y casi siempre es el prefijo del módulo mal escrito en una de las dos puntas.

> **Quedate con esto**
> Dos archivos en una carpeta propia: la clase y el XML con `<templates>` y `xml:space="preserve"`. El `t-name` tiene que ser idéntico al `static template`, con el prefijo del módulo. Declará `static props` siempre: convierte un «se ve raro» en un error que te dice exactamente qué falta. Y toda la inicialización va en `setup()`, nunca en el constructor.
