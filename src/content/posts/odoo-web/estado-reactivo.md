---
title: "Estado reactivo con useState"
description: Cómo funciona la reactividad de OWL, qué dispara un re-render y qué no.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Un componente que cambia en pantalla cuando cambian sus datos.
course: odoo-web-framework
section: owl
order: 3
---

El semáforo de la lección anterior es estático: recibe props y las muestra. Ahora le damos estado propio — que se pueda desplegar para ver el detalle.

## `useState`

```javascript service_workshop/static/src/components/sla_light/sla_light.js
import { Component, useState } from "@odoo/owl";

export class SlaLight extends Component {
    static template = "service_workshop.SlaLight";
    static props = { /* ... */ };

    setup() {
        this.state = useState({ abierto: false });
    }

    alternar() {
        this.state.abierto = !this.state.abierto;
    }
}
```

```xml
<t t-name="service_workshop.SlaLight">
    <span class="o_sla_light" t-att-class="'o_sla_' + nivel" t-on-click="alternar">
        <i class="fa fa-circle small"/>
        <span t-esc="etiqueta"/>
    </span>
    <div t-if="state.abierto" class="small text-muted mt-1">
        Límite del SLA: <t t-esc="props.limite"/> días
    </div>
</t>
```

Asignás a una propiedad del objeto y la pantalla se actualiza. No hay nada que llamar.

## Cómo funciona

`useState` **envuelve tu objeto en un Proxy**. Ese proxy intercepta lecturas y escrituras:

- Cuando la plantilla **lee** `state.abierto` durante el render, OWL anota que este componente depende de esa propiedad.
- Cuando algo **escribe** `state.abierto`, OWL marca el componente para re-renderizar.

De ahí salen todas las reglas que siguen.

## Lo que dispara un re-render

```javascript
this.state.abierto = true;              // sí
this.state.contador++;                  // sí
this.state.lista.push("x");             // sí, los arrays también
this.state.config.modo = "corto";       // sí, los objetos anidados también
delete this.state.temporal;             // sí
```

La reactividad es **profunda**: los objetos y arrays anidados dentro del estado también están envueltos.

## Lo que NO dispara nada

Esta es la parte que hace perder tiempo.

**Guardar datos fuera de `useState`:**

```javascript Mal
setup() {
    this.contador = 0;          // una propiedad normal, sin proxy
}
sumar() {
    this.contador++;            // cambia el valor, la pantalla no se entera
}
```

```javascript Bien
setup() {
    this.state = useState({ contador: 0 });
}
sumar() {
    this.state.contador++;
}
```

**Reemplazar el objeto entero:**

```javascript Mal · pierde el proxy
this.state = { abierto: true };
```

```javascript Bien · muta las propiedades
Object.assign(this.state, { abierto: true });
```

Reasignar `this.state` lo reemplaza por un objeto plano sin proxy, y a partir de ahí **nada vuelve a actualizarse**. Es un error silencioso: no hay excepción, el componente simplemente se congela.

**Guardar una referencia a algo de adentro:**

```javascript Mal
const lista = this.state.items;
lista.push("x");     // esto sí funciona, porque lista sigue siendo el proxy

const copia = [...this.state.items];
copia.push("x");     // esto no, copia es un array nuevo sin proxy
```

## Qué poner en el estado y qué no

**En el estado:** lo que afecta lo que se ve. Si cambia y la pantalla tiene que reflejarlo, va ahí.

**Fuera del estado:** todo lo demás. Un servicio, un temporizador, una referencia al DOM, una caché interna.

```javascript
setup() {
    this.orm = useService("orm");               // no es estado
    this.rootRef = useRef("root");              // no es estado
    this.state = useState({ cargando: true, items: [] });   // esto sí
}
```

Meter cosas en el estado que no afectan la vista no rompe nada, pero genera re-renders innecesarios.

## Estado compartido entre componentes

`useState` es **por componente**: dos instancias tienen estados independientes, que es lo que querés.

Si dos componentes tienen que compartir estado, hay tres caminos, en orden de preferencia:

**Subirlo al padre común** y bajarlo por props. Es lo primero que hay que intentar.

**Un servicio con estado reactivo**, cuando el estado es global de verdad. Tiene su lección en la sección de servicios.

**`useState` sobre un objeto reactivo compartido**, que es lo que hacen los servicios por dentro:

```javascript
import { reactive } from "@odoo/owl";

export const estadoCompartido = reactive({ filtro: "todas" });

// en cualquier componente
setup() {
    this.compartido = useState(estadoCompartido);
}
```

`reactive()` crea el proxy; `useState()` en cada componente lo **suscribe** a los cambios. Sin el `useState`, el componente lee el valor pero no se entera cuando cambia.

## El render es asíncrono

Esto sorprende la primera vez:

```javascript
this.state.abierto = true;
console.log(this.el.querySelector(".detalle"));   // todavía no existe
```

OWL **agrupa los cambios** y renderiza una vez, en la siguiente microtarea. Si escribís tres propiedades seguidas, hay un solo re-render, no tres. Eso es bueno para el rendimiento y significa que el DOM no está actualizado justo después de asignar.

Si necesitás tocar el DOM después de un cambio, el gancho es `useEffect` o `onPatched`, que vemos en la próxima lección.

## Depurar la reactividad

Cuando algo «no se actualiza», la lista de sospechosos, en orden:

1. ¿El dato está dentro de `useState`?
2. ¿Reasignaste `this.state` en vez de mutarlo?
3. ¿La plantilla **lee** esa propiedad? Si no la lee durante el render, no se suscribe.
4. ¿Estás mutando una copia en vez del original?

El punto 3 es el más sutil: si la plantilla solo lee `state.a` y vos cambiás `state.b`, OWL no re-renderiza, porque este componente nunca mostró `state.b`. Es correcto y es eficiente, pero confunde cuando la lectura está detrás de un `t-if` que ahora mismo es falso.

> **Quedate con esto**
> `useState` envuelve el objeto en un proxy: mutá sus propiedades, nunca reasignes `this.state`, porque eso lo reemplaza por un objeto plano y el componente se congela sin dar ningún error. Y el render es asíncrono: justo después de cambiar el estado, el DOM todavía es el viejo.
