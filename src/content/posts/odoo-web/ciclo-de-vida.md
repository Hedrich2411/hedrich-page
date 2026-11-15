---
title: "El ciclo de vida de un componente"
description: onWillStart, onMounted, onWillUpdateProps y onWillUnmount - cuándo corre cada uno.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Cargar datos antes de pintar y limpiar lo que dejaste al desmontar.
course: odoo-web-framework
section: owl
order: 4
---

Un componente nace, se pinta, se actualiza varias veces y muere. OWL te deja engancharte en cada uno de esos momentos, y elegir el correcto es la diferencia entre un componente que funciona y uno que parpadea o pierde memoria.

## Los ganchos, en orden

```javascript
import {
    Component, onWillStart, onMounted, onWillUpdateProps,
    onWillPatch, onPatched, onWillUnmount, onError,
} from "@odoo/owl";

export class Ejemplo extends Component {
    setup() {
        onWillStart(async () => { /* antes del primer render */ });
        onMounted(() => { /* ya está en el DOM */ });
        onWillUpdateProps(async (nuevasProps) => { /* llegan props nuevas */ });
        onWillPatch(() => { /* antes de aplicar cambios al DOM */ });
        onPatched(() => { /* después de aplicarlos */ });
        onWillUnmount(() => { /* antes de sacarlo del DOM */ });
        onError((error) => { /* algo falló abajo */ });
    }
}
```

**Todos se registran en `setup()`**, igual que los demás hooks, y nunca dentro de un `if`.

El orden real de una vida completa:

```text
setup → onWillStart → [render] → onMounted
                                      ↓
        onWillUpdateProps → [render] → onWillPatch → onPatched
                                      ↓
                                 onWillUnmount
```

## `onWillStart`: cargar datos antes de pintar

```javascript
setup() {
    this.orm = useService("orm");
    this.state = useState({ ordenes: [] });

    onWillStart(async () => {
        this.state.ordenes = await this.orm.searchRead(
            "service.order",
            [["state", "not in", ["done", "cancel"]]],
            ["code", "partner_id", "days_in_shop"],
        );
    });
}
```

Es el único gancho que corre **antes del primer render**, y OWL **espera a que termine** si devuelve una promesa.

Eso es lo que lo hace valioso: el componente no se pinta vacío y después con datos. **Se pinta una sola vez, ya con los datos.** Sin parpadeo y sin un estado «cargando» que haya que manejar.

La contracara: mientras dure, el componente no aparece. Para algo lento conviene mostrar algo — y ahí sí, un `state.cargando` y un `onMounted` que dispare la carga.

## `onMounted`: ya hay DOM

```javascript
setup() {
    this.rootRef = useRef("root");

    onMounted(() => {
        this.observer = new ResizeObserver(() => this.recalcular());
        this.observer.observe(this.rootRef.el);
    });
}
```

Corre **después** de que el componente está en el DOM. Es el primer momento en que `useRef` tiene un elemento real.

Lo que va acá: medir el DOM, instalar observadores, inicializar una librería de terceros que necesita un nodo, poner el foco en un input.

**No cargues datos acá** si podés hacerlo en `onWillStart`: el componente ya se pintó vacío.

## `onWillUnmount`: limpiar

```javascript
onWillUnmount(() => {
    this.observer?.disconnect();
    clearInterval(this.intervalo);
});
```

**Todo lo que instalaste en `onMounted` se desinstala acá.** Observadores, temporizadores, listeners en `window` o `document`, suscripciones.

Si no lo hacés, cada vez que el usuario abre y cierra la pantalla queda un temporizador corriendo. Después de un rato de uso, la aplicación se arrastra y nadie entiende por qué.

Los listeners que ponés en la plantilla con `t-on` **no hay que limpiarlos**: OWL los saca solo. Los que pusiste a mano sobre `window` o `document`, sí.

### `useEffect`, que hace las dos cosas

```javascript
import { useEffect } from "@odoo/owl";

setup() {
    useEffect(
        (el) => {
            const onScroll = () => this.actualizar();
            el.addEventListener("scroll", onScroll);
            return () => el.removeEventListener("scroll", onScroll);
        },
        () => [this.rootRef.el],
    );
}
```

Si venís de React te va a resultar conocido: el primer argumento hace el trabajo y **devuelve la función de limpieza**; el segundo dice de qué depende.

Para instalar-y-limpiar es más seguro que el par `onMounted`/`onWillUnmount`, porque las dos mitades están juntas y cuesta más olvidarse de una.

## `onWillUpdateProps`: cuando el padre manda otras props

```javascript
onWillUpdateProps(async (nuevasProps) => {
    if (nuevasProps.ordenId !== this.props.ordenId) {
        this.state.detalle = await this.orm.read("service.order", [nuevasProps.ordenId], ["diagnosis"]);
    }
});
```

Dos cosas importantes:

**El argumento son las props NUEVAS.** `this.props` todavía tiene las viejas, y esa es justamente la gracia: podés comparar.

**Corre antes del re-render** y OWL espera si devuelve una promesa. Es el `onWillStart` de las actualizaciones.

El error clásico acá es no comparar y recargar datos en cada actualización, aunque la prop relevante no haya cambiado. El padre re-renderiza por cualquier motivo y vos hacés una consulta al servidor de más.

## `onPatched`: después de tocar el DOM

```javascript
onPatched(() => {
    this.listaRef.el.scrollTop = this.listaRef.el.scrollHeight;
});
```

Corre después de cada actualización del DOM. Para mantener un scroll abajo, reposicionar algo, medir de nuevo.

Usalo poco: **si leés y escribís el DOM acá, podés provocar un bucle de renders**. Si notás que la aplicación se traba, mirá los `onPatched`.

## `onError`: contener un fallo

```javascript
onError((error) => {
    console.error("Falló el semáforo de SLA", error);
    this.state.roto = true;
});
```

Captura errores de **este componente y de sus hijos**. Sin él, un error en un componente hondo puede llevarse puesta la pantalla entera.

En Odoo, el cliente web ya tiene su propia red de contención que muestra el diálogo rojo. `onError` sirve para que **tu pedazo** falle solo, sin arrastrar el resto: un widget roto en un formulario no debería impedir ver el formulario.

## Qué gancho para qué

| Necesito | Gancho |
|---|---|
| Datos antes del primer render | `onWillStart` |
| Tocar el DOM o una librería externa | `onMounted` |
| Limpiar lo que instalé | `onWillUnmount`, o `useEffect` |
| Reaccionar a props nuevas | `onWillUpdateProps` |
| Reposicionar tras un cambio | `onPatched` |
| Que un fallo no se lleve la pantalla | `onError` |

> **Quedate con esto**
> `onWillStart` espera la promesa y por eso el componente se pinta una sola vez, ya con los datos: usalo para cargar, no `onMounted`. Todo lo que instales en `onMounted` tiene que desinstalarse en `onWillUnmount`, o mejor usá `useEffect`, que mantiene las dos mitades juntas. Y en `onWillUpdateProps`, compará antes de recargar: el argumento son las props nuevas y `this.props` todavía las viejas.
