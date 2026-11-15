---
title: "Escribir un servicio propio"
description: Cuándo un servicio es la respuesta correcta y cómo se escribe.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Lógica compartida entre componentes, sin pasarla por props.
course: odoo-web-framework
section: servicios
order: 4
---

Llega un punto en que tres componentes necesitan lo mismo: la configuración del taller, el límite de SLA, el conteo de órdenes atrasadas. Pasarlo por props a través de cuatro niveles es incómodo, y cada uno consultándolo por su cuenta es trabajo repetido.

Ahí entra un servicio propio.

## La forma

```javascript service_workshop/static/src/services/workshop_service.js
import { registry } from "@web/core/registry";
import { reactive } from "@odoo/owl";

export const workshopService = {
    dependencies: ["orm"],

    start(env, { orm }) {
        const estado = reactive({
            limiteSla: 7,
            atrasadas: 0,
            cargado: false,
        });

        async function recargar() {
            estado.atrasadas = await orm.searchCount("service.order", [
                ["days_in_shop", ">", estado.limiteSla],
                ["state", "not in", ["done", "cancel"]],
            ]);
            estado.cargado = true;
        }

        recargar();

        return {
            estado,
            recargar,
            esAtrasada: (dias) => dias > estado.limiteSla,
        };
    },
};

registry.category("services").add("service_workshop.taller", workshopService);
```

Tres cosas de ahí.

**`dependencies: ["orm"]`** — Odoo arranca `orm` antes y te lo pasa en el segundo argumento de `start`.

**`reactive()`** — crea el proxy reactivo de la lección de `useState`, pero **fuera de un componente**. Es lo que permite que el estado viva en el servicio.

**Lo que devuelve `start` es el servicio.** Un objeto con el estado y los métodos.

## Usarlo

```javascript
import { useService } from "@web/core/utils/hooks";
import { useState } from "@odoo/owl";

setup() {
    this.taller = useService("service_workshop.taller");
    this.estado = useState(this.taller.estado);
}
```

```xml
<span t-if="estado.atrasadas">
    Hay <t t-esc="estado.atrasadas"/> órdenes atrasadas
</span>
```

**El `useState` alrededor del estado del servicio es obligatorio.**

Sin él, el componente lee el valor correcto la primera vez pero **no se entera cuando cambia**. `reactive()` crea el proxy; `useState()` es lo que **suscribe este componente** a sus cambios. Es exactamente el mismo mecanismo de la lección de estado reactivo, con el objeto viviendo afuera.

Ese es el error número uno al escribir un servicio con estado: todo parece bien hasta que algo cambia y la pantalla se queda vieja.

## El nombre lleva prefijo

```javascript
registry.category("services").add("service_workshop.taller", workshopService);
```

Los servicios comparten un espacio de nombres global. Un servicio llamado `taller` a secas choca con cualquier otro módulo que se le ocurra lo mismo, y recordá de la lección de registries que **agregar un nombre repetido lanza un error**.

Prefijá siempre con el módulo.

## Cuándo NO hace falta

Esto importa tanto como lo anterior.

**Si solo lo usa un componente**, es estado de ese componente. No lo saques afuera por si acaso.

**Si el padre común está cerca**, subí el estado al padre y bajalo por props. Es más fácil de seguir: mirando el componente ves de dónde viene cada dato.

**Si es una función pura**, es un módulo con una función exportada. Un servicio sin estado ni dependencias es ceremonia:

```javascript
// esto no necesita ser un servicio
export function nivelSla(dias, limite) {
    if (dias >= limite) return "late";
    if (dias >= limite - 2) return "warn";
    return "ok";
}
```

La regla: **un servicio tiene estado compartido, dependencias, o ambos**. Si no tiene ninguno de los dos, es un módulo normal.

## Un servicio sin estado que sí tiene sentido

```javascript
export const tallerPdfService = {
    dependencies: ["action", "notification"],

    start(env, { action, notification }) {
        return {
            async imprimirOrden(id) {
                try {
                    await action.doAction({
                        type: "ir.actions.report",
                        report_name: "service_workshop.report_service_order",
                        report_type: "qweb-pdf",
                        context: { active_ids: [id] },
                    });
                } catch {
                    notification.add("No se pudo generar el PDF.", { type: "danger" });
                }
            },
        };
    },
};
```

No guarda estado, pero **encapsula el uso de dos servicios y el manejo del error**. Sin él, cada componente que imprima repite las diez líneas.

## Probarlo

Acá se ve la ventaja de los servicios sobre las variables globales:

```javascript
registry.category("services").add("service_workshop.taller", {
    start: () => ({
        estado: reactive({ limiteSla: 7, atrasadas: 3, cargado: true }),
        recargar: async () => {},
        esAtrasada: (d) => d > 7,
    }),
}, { force: true });
```

En un test registrás una versión falsa con `force: true` y el componente no toca el servidor. Es la lección de tests, que viene ahora.

## Con esto cierra la sección

Ya sabés usar la infraestructura del cliente web: hablar con el servidor, avisar, preguntar, navegar, y compartir estado entre componentes sin pasarlo por props.

Lo último que falta es probar que todo esto sigue funcionando mañana.

> **Quedate con esto**
> `reactive()` crea el proxy fuera de un componente, pero cada componente necesita envolverlo en `useState()` para suscribirse — sin eso lee bien la primera vez y después se queda viejo. Prefijá el nombre con tu módulo, porque el espacio es global y un nombre repetido lanza error. Y si no hay estado compartido ni dependencias, no es un servicio: es una función exportada.
