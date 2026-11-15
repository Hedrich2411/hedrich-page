---
title: "Eventos y comunicación entre componentes"
description: El flujo de datos en OWL - props hacia abajo, callbacks hacia arriba.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Un hijo que avisa al padre y un padre que manda datos al hijo.
course: odoo-web-framework
section: owl
order: 5
---

El flujo de datos en OWL es de una sola dirección, igual que en React:

**Los datos bajan por props. Los avisos suben por funciones que vinieron en las props.**

Entender eso evita la mayoría de los enredos.

## Eventos del DOM: `t-on`

```xml
<button t-on-click="alternar">Ver detalle</button>
<button t-on-click="() => this.marcar(orden.id)">Marcar</button>
<input t-on-input="(ev) => this.buscar(ev.target.value)"/>
<form t-on-submit.prevent="guardar">...</form>
```

`t-on-` más el nombre del evento. El valor es **un método del componente o una expresión**.

Fijate la diferencia: `t-on-click="alternar"` pasa el método; `t-on-click="() => this.alternar(id)"` crea una función para poder pasarle argumentos. Dentro de la plantilla, `this` es el componente.

Los modificadores que vas a usar:

```xml
<a t-on-click.prevent="abrir">          <!-- preventDefault -->
<div t-on-click.stop="algo">            <!-- stopPropagation -->
<div t-on-click.self="algo">            <!-- solo si el clic fue en este nodo -->
```

`.prevent` en un `<a>` y `.stop` dentro de una fila clickeable son los dos que vas a escribir todo el tiempo.

## Avisar al padre: props que son funciones

En OWL **no hay eventos personalizados que burbujeen**. Si un hijo tiene que avisarle algo al padre, el padre le pasa una función.

```javascript service_workshop/static/src/components/sla_light/sla_light.js
export class SlaLight extends Component {
    static template = "service_workshop.SlaLight";
    static props = {
        dias: Number,
        limite: { type: Number, optional: true },
        onAlerta: { type: Function, optional: true },
    };

    alternar() {
        this.state.abierto = !this.state.abierto;
        if (this.nivel === "late") {
            this.props.onAlerta?.(this.props.dias);
        }
    }
}
```

```xml En el padre
<SlaLight dias="orden.dias" onAlerta.bind="avisarRetraso"/>
```

```javascript En el padre
avisarRetraso(dias) {
    this.notification.add(`Esta orden lleva ${dias} días`, { type: "warning" });
}
```

### `.bind`, que es lo que casi nadie explica

```xml
<SlaLight onAlerta.bind="avisarRetraso"/>
```

Ese sufijo **ata el método al componente padre**, para que `this` adentro sea el padre y no otra cosa.

Sin `.bind`, pasás la función suelta y `this` llega indefinido. El error es `Cannot read properties of undefined` dentro de tu propio método, que despista bastante.

La convención de nombres es **`on` más lo que pasó**: `onAlerta`, `onSeleccionar`, `onCerrar`. Como son props normales, van declaradas en `static props` con `type: Function`.

## Por qué no hay eventos que burbujeen

Es una decisión deliberada y conviene entenderla: con props explícitas, **mirando la plantilla del padre sabés exactamente qué puede pasar**. Con eventos que burbujean, cualquier ancestro podría estar escuchando y no hay forma de saberlo sin buscar por todo el código.

Si necesitás comunicar componentes que están lejos en el árbol, la respuesta no es un evento global: es un **servicio**, que tiene su sección más adelante.

## Pasar props

```xml
<SlaLight
    dias="orden.days_in_shop"
    limite="7"
    texto="'Atrasada'"
    onAlerta.bind="avisarRetraso"/>
```

Un detalle que confunde: **el valor de un atributo es una expresión JavaScript, no texto**.

- `limite="7"` pasa el **número** 7.
- `texto="'Atrasada'"` pasa el **string** `Atrasada` — fijate las comillas simples adentro.
- `texto="Atrasada"` intentaría leer una variable llamada `Atrasada` y fallaría.

Es al revés de lo que uno espera viniendo de HTML, y es la causa de la mitad de los errores de props al empezar.

## `useRef`: tocar el DOM

Cuando de verdad necesitás un nodo —poner el foco, medir, integrar una librería:

```javascript
import { useRef, onMounted } from "@odoo/owl";

setup() {
    this.inputRef = useRef("entrada");
    onMounted(() => this.inputRef.el?.focus());
}
```

```xml
<input t-ref="entrada" class="form-control"/>
```

`useRef("nombre")` devuelve un objeto con `.el`, que es `null` hasta que el componente está montado — y vuelve a `null` si el nodo desaparece por un `t-if`. **Usá siempre `?.`**.

La regla: `useRef` es para lo que el estado no puede hacer. Si querés mostrar u ocultar algo, eso es estado; no busques el nodo para cambiarle el `display`.

## El error de modificar las props

```javascript Mal
this.props.dias = 10;
```

**Las props son de solo lectura.** Pertenecen al padre, y OWL te lo va a decir con un error en desarrollo.

Si el hijo necesita un valor propio derivado de una prop, lo copia a su estado:

```javascript
setup() {
    this.state = useState({ dias: this.props.dias });

    onWillUpdateProps((nuevas) => {
        this.state.dias = nuevas.dias;
    });
}
```

Y si el valor tiene que cambiar **de verdad**, el que lo cambia es el padre: el hijo le avisa con un callback.

## Cómo queda

```javascript service_workshop/static/src/components/sla_light/sla_light.js
import { Component, useState } from "@odoo/owl";

export class SlaLight extends Component {
    static template = "service_workshop.SlaLight";

    static props = {
        dias: { type: Number },
        limite: { type: Number, optional: true },
        texto: { type: String, optional: true },
        onAlerta: { type: Function, optional: true },
    };

    static defaultProps = { limite: 5 };

    setup() {
        this.state = useState({ abierto: false });
    }

    get nivel() {
        const { dias, limite } = this.props;
        if (dias >= limite) return "late";
        if (dias >= limite - 2) return "warn";
        return "ok";
    }

    get etiqueta() {
        return this.props.texto || `${this.props.dias} días`;
    }

    alternar() {
        this.state.abierto = !this.state.abierto;
        if (this.state.abierto && this.nivel === "late") {
            this.props.onAlerta?.(this.props.dias);
        }
    }
}
```

> **Quedate con esto**
> Los datos bajan por props y los avisos suben por funciones pasadas como props — no hay eventos que burbujeen, y eso es a propósito. El sufijo `.bind` es obligatorio al pasar un método, o `this` llega indefinido. Y en una plantilla, el valor de un atributo es una expresión: `texto="'Atrasada'"` con comillas adentro, no `texto="Atrasada"`.
