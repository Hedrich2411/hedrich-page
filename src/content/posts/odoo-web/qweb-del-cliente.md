---
title: "QWeb del cliente: las directivas que cambian"
description: Las mismas directivas que en los reportes, con diferencias que importan.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, qweb]
goal: Escribir plantillas del lado del cliente sabiendo en qué se diferencian de las del servidor.
course: odoo-web-framework
section: qweb
order: 1
---

Si hiciste el curso de backend, ya escribiste QWeb: los reportes PDF y el portal del cliente. Las directivas son las mismas.

Lo que cambia es **dónde se evalúan las expresiones** y qué contexto tenés disponible. En el servidor eran expresiones de Python contra un recordset; acá son **JavaScript contra la instancia del componente**.

## El contexto es el componente

```xml
<t t-name="service_workshop.SlaLight">
    <span t-esc="etiqueta"/>              <!-- un getter -->
    <span t-esc="props.dias"/>            <!-- una prop -->
    <span t-esc="state.abierto"/>         <!-- el estado -->
    <span t-esc="this.calcular()"/>       <!-- un método -->
</t>
```

Todo lo que es accesible desde `this` en la clase, es accesible por su nombre en la plantilla. El `this` es opcional salvo para llamar métodos.

Y las expresiones son **JavaScript de verdad**:

```xml
<span t-esc="props.dias > 5 ? 'Atrasada' : 'A tiempo'"/>
<span t-esc="props.ordenes.filter(o => o.urgente).length"/>
<span t-esc="`${props.dias} de ${props.limite}`"/>
```

Nada de la sintaxis restringida del QWeb del servidor.

## `t-esc` y `t-out`

```xml
<span t-esc="props.texto"/>    <!-- escapa el HTML -->
<span t-out="props.html"/>     <!-- lo inserta tal cual -->
```

`t-esc` escapa; `t-out` no. En el core de Odoo `t-esc` se usa unas tres veces más que `t-out`, y esa proporción es la correcta: **`t-out` solo para HTML que vos generaste**, nunca para algo que vino del usuario o de la base.

Un `t-out` con contenido de un campo que el usuario puede editar es una inyección de HTML.

## Condicionales

```xml
<div t-if="state.abierto">Detalle</div>
<div t-elif="state.cargando">Cargando…</div>
<div t-else="">Nada que mostrar</div>
```

El `t-else=""` lleva el valor vacío obligatoriamente. Es un detalle de sintaxis que se olvida.

**`t-if` saca el nodo del DOM**, no lo esconde. Eso importa por dos motivos: un `useRef` dentro de un `t-if` falso vale `null`, y el componente hijo dentro de un `t-if` se **destruye** cuando pasa a falso — con su ciclo de vida completo, `onWillUnmount` incluido.

Si querés esconder sin destruir, una clase:

```xml
<div t-att-class="{ 'd-none': !state.abierto }">...</div>
```

## Bucles y el `t-key` obligatorio

```xml
<div t-foreach="props.ordenes" t-as="orden" t-key="orden.id">
    <span t-esc="orden.code"/>
</div>
```

Acá está la diferencia más importante con el QWeb del servidor: **`t-key` es obligatorio**.

En el core hay 187 `t-key` para 181 `t-foreach`: literalmente uno por bucle.

La razón es el DOM virtual. Cuando la lista cambia, OWL compara la nueva con la vieja y aplica solo las diferencias. Sin una clave estable no puede saber si un elemento se movió o si es nuevo, y los síntomas son desconcertantes: estado que salta de una fila a otra, inputs que conservan el valor equivocado, animaciones que se disparan donde no corresponde.

**La clave tiene que ser estable y única.** El `id` del registro. **Nunca el índice**: si la lista se reordena o se filtra, el índice de cada elemento cambia y la clave deja de identificar nada.

Las variables que el bucle te da:

```xml
<div t-foreach="lista" t-as="item" t-key="item.id">
    <span t-esc="item_index"/>      <!-- 0, 1, 2… -->
    <span t-if="item_first">primero</span>
    <span t-if="item_last">último</span>
</div>
```

Son el nombre de la variable más el sufijo.

## Variables locales

```xml
<t t-set="total" t-value="props.ordenes.length"/>
<span t-esc="total"/>

<t t-set="titulo">Órdenes del taller</t>
```

Con `t-value` guardás el resultado de una expresión; sin él, el contenido del nodo.

Sirve para no repetir un cálculo en varios lugares de la plantilla. Pero si la expresión es compleja, **mejor un getter en la clase**: se lee mejor y se puede probar.

## Incluir otra plantilla

```xml
<t t-call="service_workshop.FilaOrden">
    <t t-set="orden" t-value="orden"/>
</t>
```

Inserta otra plantilla pasándole variables. Es para marcado repetido **sin lógica propia**; si necesita estado o ciclo de vida, es un componente.

## Lo que no existe acá

Si venís del QWeb del servidor, estas te van a faltar:

| Del servidor | Acá |
|---|---|
| `t-field` | no existe: no hay recordsets en el cliente |
| `t-esc` con formato de campo | formateá vos, o usá los helpers de `@web/core/utils` |
| `t-call` a una vista | solo a otras plantillas del cliente |

El `t-field` del servidor sabía formatear un `Monetary` o una fecha porque tenía el campo delante. En el cliente eso lo resuelven los formateadores, que vemos en la sección de widgets.

## Un error que cuesta encontrar

```text
Error: Invalid XML in template
```

Las plantillas son **XML estricto**. Una etiqueta sin cerrar, un `&` suelto o un atributo sin comillas rompe **el archivo entero**, y con él todas las plantillas que contenga.

Los dos que más pasan:

```xml Mal
<br>
<input class="form-control">
Ventas & Compras
```

```xml Bien
<br/>
<input class="form-control"/>
Ventas &amp; Compras
```

Si de golpe fallan varias plantillas de tu módulo a la vez, es casi seguro un XML mal formado en alguna de ellas.

> **Quedate con esto**
> Las expresiones son JavaScript contra la instancia del componente, así que `props`, `state`, getters y métodos están disponibles por su nombre. El `t-key` en cada `t-foreach` no es opcional: sin él el DOM virtual no puede reconciliar y el estado salta de fila en fila. Y las plantillas son XML estricto — un `<br>` sin cerrar se lleva puesto el archivo completo.
