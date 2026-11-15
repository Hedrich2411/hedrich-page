---
title: "Subcomponentes y slots"
description: static components, slots por defecto y con nombre, y cuándo partir un componente.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Componer una interfaz con piezas reutilizables.
course: odoo-web-framework
section: owl
order: 6
---

Un componente que hace todo es imposible de mantener. Esta lección es sobre partirlo bien.

## Usar un componente adentro de otro

```javascript service_workshop/static/src/components/sla_panel/sla_panel.js
import { Component } from "@odoo/owl";
import { SlaLight } from "../sla_light/sla_light";

export class SlaPanel extends Component {
    static template = "service_workshop.SlaPanel";
    static components = { SlaLight };
    static props = { ordenes: { type: Array } };
}
```

```xml service_workshop/static/src/components/sla_panel/sla_panel.xml
<t t-name="service_workshop.SlaPanel">
    <div class="o_sla_panel">
        <div t-foreach="props.ordenes" t-as="orden" t-key="orden.id" class="d-flex gap-2">
            <span t-esc="orden.code"/>
            <SlaLight dias="orden.days_in_shop" limite="7"/>
        </div>
    </div>
</t>
```

**`static components` es obligatorio.** La plantilla no puede usar `<SlaLight/>` si la clase no lo declaró ahí. El error que vas a ver dice que el componente no está definido, y la solución siempre es esa línea.

Fijate también el **`t-key` en el `t-foreach`**: sin él, OWL no puede reconciliar la lista y vas a ver comportamientos raros al reordenar o filtrar. Tiene que ser un identificador estable — el `id` del registro, nunca el índice del bucle.

## Slots: el componente que envuelve

A veces querés un componente que aporte estructura pero cuyo contenido lo ponga quien lo usa. Una tarjeta, un diálogo, un panel plegable.

```xml service_workshop/static/src/components/caja/caja.xml
<t t-name="service_workshop.Caja">
    <div class="card">
        <div class="card-header d-flex justify-content-between">
            <span t-esc="props.titulo"/>
            <t t-slot="acciones"/>
        </div>
        <div class="card-body">
            <t t-slot="default"/>
        </div>
    </div>
</t>
```

```xml Usándolo
<Caja titulo="'Órdenes atrasadas'">
    <t t-set-slot="acciones">
        <button class="btn btn-sm btn-link" t-on-click="recargar">Recargar</button>
    </t>

    <SlaPanel ordenes="state.ordenes"/>
</Caja>
```

- **`t-slot="default"`** es el contenido sin nombre.
- **`t-slot="acciones"`** es un hueco con nombre, que se llena con `t-set-slot`.

El contenido del slot **se renderiza en el contexto de quien lo escribe**, no del componente que lo recibe. Por eso `state.ordenes` y `recargar` del ejemplo se resuelven contra el padre, que es lo que uno espera.

### Slot por defecto si no le pasan nada

```xml
<t t-slot="acciones">
    <span class="text-muted small">Sin acciones</span>
</t>
```

Lo que pongas **adentro** del `t-slot` es el contenido de respaldo.

### Pasarle datos al slot

```xml En el componente
<t t-slot="fila" orden="orden" indice="orden_index"/>
```

```xml Al usarlo
<t t-set-slot="fila" t-slot-scope="s">
    <span t-esc="s.orden.code"/> — <span t-esc="s.indice"/>
</t>
```

Es el patrón de «render prop»: el componente controla **cuándo y cuántas veces** se renderiza el slot, y quien lo usa decide **qué** se ve. Es como está hecho el renderizador de listas de Odoo.

## Cuándo partir un componente

Las señales de que conviene:

**Se usa en más de un lugar.** Es la razón obvia.

**Tiene estado propio que al padre no le importa.** Un panel que se despliega: que el padre no se entere.

**El `setup()` del padre ya mezcla dos temas.** Si la mitad de los hooks son para una cosa y la otra mitad para otra, ahí hay dos componentes.

**La plantilla pasó las 80 líneas.** No es una regla, es un síntoma.

### Cuándo no

**Porque sí.** Un componente son dos archivos, una entrada en `static components`, props que declarar y validar. Si solo se usa en un lugar y no tiene estado, partirlo agrega ceremonia sin ganar nada.

**Para reusar tres líneas de marcado.** Para eso alcanza con una sub-plantilla:

```xml
<t t-call="service_workshop.FilaOrden">
    <t t-set="orden" t-value="orden"/>
</t>
```

`t-call` incluye otra plantilla **sin crear un componente**. Sin clase, sin props, sin ciclo de vida. Para marcado repetido sin lógica, es la herramienta correcta.

## El coste de anidar

Cada componente tiene su propio ciclo de render. Un árbol muy profundo con muchas instancias chicas rinde peor que uno plano.

En la práctica no te vas a topar con eso salvo que estés renderizando cientos de filas. Si llega el caso, la salida es aplanar: menos componentes, plantillas más grandes.

Primero hacelo legible; optimizá cuando midas que hace falta.

## Con esto cierra la sección

Ya sabés escribir componentes: clase, plantilla externa, props validadas, estado reactivo, ciclo de vida, comunicación con el padre y composición.

Lo que sigue es QWeb del lado del cliente en detalle, y después enchufar esto al cliente web de Odoo: registries, campos y vistas.

> **Quedate con esto**
> `static components` es obligatorio para usar un hijo en la plantilla, y el `t-key` de un `t-foreach` tiene que ser un id estable, nunca el índice. Los slots renderizan en el contexto de quien los escribe, no del componente que los recibe. Y para marcado repetido sin lógica, `t-call` en vez de un componente nuevo.
