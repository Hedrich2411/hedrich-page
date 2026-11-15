---
title: "El registry de servicios y useService"
description: Qué servicios trae Odoo, cómo se piden y cómo se escribe uno propio.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Usar la infraestructura del cliente web en vez de reinventarla.
course: odoo-web-framework
section: servicios
order: 1
---

Ya los venimos usando sin explicarlos. El controlador de la lista pide `action` y `orm`; el tablero, lo mismo.

Un **servicio** es una pieza de infraestructura compartida: existe una sola vez por aplicación y cualquier componente puede pedirla.

## `useService`

```javascript
import { useService } from "@web/core/utils/hooks";

setup() {
    this.orm = useService("orm");
    this.action = useService("action");
    this.notification = useService("notification");
}
```

Es un hook, así que va en `setup()` y nunca dentro de un `if`.

Fijate la ruta: **`@web/core/utils/hooks`**, no `@web/core/hooks`. Es un error de import fácil de cometer y el mensaje no ayuda.

## Los que vas a usar

Esta es la frecuencia real en el cliente web de Odoo:

| Servicio | Usos en el core | Para qué |
|---|---|---|
| `orm` | 61 | leer y escribir registros |
| `ui` | 55 | bloquear la pantalla, el indicador de carga |
| `action` | 45 | abrir pantallas y ejecutar acciones |
| `dialog` | 39 | diálogos modales |
| `notification` | 36 | avisos efímeros |
| `user` | — | el usuario, sus grupos, su contexto |
| `company` | — | la compañía activa |
| `rpc` | — | llamadas crudas al servidor |
| `hotkey` | — | atajos de teclado |

Los cinco primeros cubren casi todo. Los tres del medio tienen su lección.

## Por qué un servicio y no una variable global

Podrías exportar un objeto desde un módulo y usarlo en todos lados. La diferencia:

**Tienen ciclo de vida.** Odoo los arranca en orden, resolviendo dependencias, cuando el cliente web se inicializa.

**Se pueden reemplazar.** En un test, montás el componente con un `orm` falso y no toca el servidor. Con una variable global eso no se puede.

**Declaran de qué dependen.** Un servicio que necesita `orm` lo dice, y Odoo garantiza el orden de arranque.

## Un servicio es un objeto con `start`

```javascript
export const miServicio = {
    dependencies: ["orm", "notification"],
    start(env, { orm, notification }) {
        return {
            async hacerAlgo() { /* ... */ },
        };
    },
};

registry.category("services").add("service_workshop.taller", miServicio);
```

- **`dependencies`** — qué otros servicios necesita.
- **`start`** — recibe el entorno y las dependencias ya arrancadas, y **devuelve lo que `useService` va a entregar**.

Lo que devuelve `start` es exactamente lo que recibe quien lo pide. Si devolvés un objeto con tres métodos, eso es el servicio.

Puede ser `async`: Odoo espera a que resuelva antes de arrancar los que dependen de él.

## Acceder sin un componente

```javascript
env.services.orm
```

Desde código que no es un componente —otro servicio, un modelo de vista—, los servicios están en `env.services`.

De hecho `useService("orm")` es básicamente `this.env.services.orm` con una envoltura que **cancela las llamadas pendientes si el componente se desmonta**. Esa envoltura es la razón de usar el hook en un componente: evita el clásico «actualizar el estado de un componente que ya no existe».

## El entorno

```javascript
this.env.services     // todos los servicios
this.env.bus          // el bus de eventos global
this.env.isSmall      // si la pantalla es chica
this.env.debug        // el modo desarrollador
```

`env` se hereda de padre a hijo en todo el árbol de componentes. Es el mecanismo por el que los servicios llegan a todos lados sin pasarlos por props.

### El bus

```javascript
this.env.bus.addEventListener("ACTION_MANAGER:UI-UPDATED", () => { /* ... */ });
this.env.bus.trigger("MI_MODULO:ALGO_PASO", { id: 42 });
```

Un emisor de eventos global. Es la salida para comunicar partes de la aplicación que no tienen relación de parentesco.

Usalo poco: **los eventos globales son difíciles de rastrear**, que es justo lo que OWL evita al no tener eventos que burbujeen. Si dos componentes necesitan hablarse seguido, un servicio con estado es más claro.

Y si lo usás, acordate de quitar el listener en `onWillUnmount`.

## Qué servicios existen

```bash Terminal
grep -rh 'registry.category("services").add' addons/*/static/src/ | sed 's/.*add("//; s/".*//' | sort -u
```

Vale la pena correrlo una vez: hay más de los que uno imagina, y el que necesitás puede estar.

## Lo que puede salir mal

| Error | Causa |
|---|---|
| `Service orm is not available` | lo pediste fuera de `setup()`, o el servicio no está registrado |
| `useService is not a function` | importaste de `@web/core/hooks` en vez de `@web/core/utils/hooks` |
| El servicio nunca arranca | una dependencia no existe: Odoo lo deja esperando en silencio |
| Funciona suelto, falla en un test | el test no registró ese servicio |

El tercero es el más molesto porque no da error: el servicio simplemente no está. Si uno propio «no hace nada», revisá que todas sus `dependencies` existan.

> **Quedate con esto**
> `useService` va en `setup()` y se importa de `@web/core/utils/hooks`. Un servicio es un objeto con `dependencies` y `start`, y lo que `start` devuelve es lo que recibe quien lo pide. Usá el hook dentro de componentes y no `env.services` directo: la envoltura cancela las llamadas pendientes cuando el componente se desmonta.
