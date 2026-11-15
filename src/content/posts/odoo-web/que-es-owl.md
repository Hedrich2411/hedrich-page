---
title: "Qué es OWL y en qué se parece a React"
description: El framework de componentes de Odoo, comparado con lo que ya sabés de React o Vue.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Ubicar OWL respecto de lo que ya conocés, y saber qué NO trae.
course: odoo-web-framework
section: owl
order: 1
---

OWL —**O**doo **W**eb **L**ibrary— es el framework de componentes que Odoo escribió para sí mismo. Todo el cliente web está hecho con él: los formularios, las listas, el chatter, el selector de aplicaciones.

Si venís de React o de Vue, la mayor parte te va a resultar familiar. Esta lección es para ubicarlo rápido y, sobre todo, para que sepas **qué no esperar**.

## La forma de un componente

```javascript
import { Component, useState } from "@odoo/owl";

export class Contador extends Component {
    static template = "service_workshop.Contador";
    static props = {
        inicial: { type: Number, optional: true },
    };

    setup() {
        this.state = useState({ valor: this.props.inicial || 0 });
    }

    sumar() {
        this.state.valor++;
    }
}
```

```xml
<t t-name="service_workshop.Contador">
    <button class="btn btn-primary" t-on-click="sumar">
        Clicks: <t t-esc="state.valor"/>
    </button>
</t>
```

Una clase, una plantilla, estado reactivo, un manejador de evento. Nada sorprendente.

## Lo que toma de React

**Componentes con estado y props.** Los datos bajan por props, los eventos suben por callbacks.

**DOM virtual.** OWL renderiza a una representación en memoria y aplica solo las diferencias reales al DOM.

**Hooks.** `useState`, `useRef`, `useEffect` existen y se llaman igual. Y tienen la misma regla: **se llaman en `setup()`, nunca dentro de un `if` ni de un bucle.**

**Reconciliación por clave.** En los bucles necesitás una clave estable, igual que en React.

## En qué se diferencia

**Las plantillas son XML, no JSX.** Un archivo `.xml` aparte con directivas `t-`. Es el mismo QWeb del curso de backend, con algunas directivas más.

Eso tiene una consecuencia práctica fuerte: **las plantillas se pueden heredar desde otro módulo**, igual que las vistas. Es lo que permite que un módulo de terceros modifique una parte del cliente web sin tocar el código de Odoo. Con JSX eso no se puede.

**La reactividad es por proxy, no por reasignación.** `this.state.valor++` dispara un re-render. No hay `setState` ni nada que llamar.

**`setup()` en vez del constructor.** Por convención y porque ahí es donde corren los hooks.

**Los hooks del ciclo de vida son funciones, no efectos.** `onWillStart`, `onMounted`, `onWillUnmount` son explícitos, en vez de un `useEffect` con array de dependencias.

## La forma del componente en Odoo 19

Estas tres declaraciones estáticas son las que vas a escribir siempre:

```javascript
static template = "service_workshop.Contador";   // el nombre de la plantilla
static props = { ... };                          // la validación de props
static components = { OtroComponente };          // los hijos que usa la plantilla
```

**`static template` es un nombre, no el contenido.** Apunta a un `<t t-name="...">` de un archivo XML del bundle. El nombre lleva el prefijo del módulo, igual que los identificadores externos del backend.

> **Si venís de tutoriales viejos**
> Vas a encontrar mucho código con plantillas inline: `static template = xml\`<div>...</div>\``. Funciona, pero **las plantillas inline no se pueden traducir ni heredar**, que son justamente las dos cosas por las que Odoo usa XML. Para algo descartable sirve; para un módulo de verdad, archivo aparte.
>
> También vas a ver `const { Component } = owl;` con la variable global. En Odoo 19 eso aparece en 3 archivos de todo el core, contra 219 que importan de `@odoo/owl`. Usá el import.

## Lo que OWL no trae

Acá está el punto de la lección, porque es donde la comparación con React engaña.

OWL es **solo la capa de componentes**. No trae:

- **Enrutador.** De eso se encarga el cliente web de Odoo con sus acciones.
- **Gestor de estado global.** Para eso están los servicios, que tienen su propia sección.
- **Cliente HTTP.** Para hablar con el servidor está el servicio `orm`.
- **Ecosistema de librerías.** No hay un npm de componentes de OWL.

Eso no es una carencia: es que **Odoo ya resuelve esas cosas con sus propios mecanismos**, y son los que vas a aprender en este curso. El error de quien viene de React es buscar el equivalente de React Router o de Redux en vez de usar lo que el cliente web ya ofrece.

## Dónde mirar cuando no sepas algo

Esto vale para todo el curso: **el mejor manual de OWL es el código del cliente web de Odoo**.

```text
addons/web/static/src/core/         componentes genéricos reutilizables
addons/web/static/src/views/        las vistas: lista, formulario, kanban
addons/web/static/src/search/       la barra de búsqueda y los filtros
```

Cuando quieras hacer algo, lo más probable es que Odoo ya lo haga en alguna parte. Abrir ese archivo y leer cómo lo resolvió es más rápido que buscar en internet, y además te da la forma idiomática.

Si seguiste el curso de backend con la instalación nativa, ya tenés ese código clonado. Si usaste Docker, es un buen momento para clonarlo aunque sea solo para leerlo.

> **Quedate con esto**
> OWL es React con plantillas XML: componentes, props, hooks y DOM virtual, pero con plantillas heredables desde otro módulo, que es el motivo de la elección. Y es **solo** la capa de componentes — enrutado, estado global y HTTP los resuelve el cliente web de Odoo con sus propios mecanismos, no busques el equivalente de React Router.
