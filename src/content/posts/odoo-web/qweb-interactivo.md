---
title: "t-on, t-att y t-model"
description: La parte interactiva de QWeb - eventos, atributos dinámicos y enlace de formularios.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, qweb]
goal: Plantillas que responden al usuario.
course: odoo-web-framework
section: qweb
order: 2
---

Las directivas de la lección anterior muestran datos. Estas tres hacen que la plantilla reaccione.

De las tres, **`t-att-` es la que más vas a escribir**: en el cliente web de Odoo aparece unas 730 veces, más que cualquier otra directiva.

## `t-att-`: atributos calculados

```xml
<span t-att-class="'o_sla_' + nivel"/>
<a t-att-href="props.url"/>
<button t-att-disabled="state.guardando"/>
<div t-att-title="props.ayuda"/>
```

El valor es una expresión; el resultado se pone como atributo.

Dos comportamientos que conviene conocer:

**Si la expresión da `false`, `undefined` o `null`, el atributo no se escribe.** Por eso `t-att-disabled="state.guardando"` funciona: cuando es falso, no hay atributo `disabled`.

**`t-att-class` se suma al `class` estático**, no lo reemplaza:

```xml
<span class="o_sla_light d-inline-flex" t-att-class="'o_sla_' + nivel"/>
```

Eso da `class="o_sla_light d-inline-flex o_sla_late"`. Es el patrón que usamos en el semáforo: las clases fijas en `class`, las variables en `t-att-class`.

### Clases condicionales con un objeto

```xml
<div t-att-class="{ 'd-none': !state.abierto, 'text-danger': nivel === 'late' }"/>
```

Un objeto donde **la clave es la clase y el valor decide si se aplica**. Es más legible que concatenar strings y es lo que usa el core en todos lados.

### `t-attf-`: interpolación

```xml
<div t-attf-class="o_sla o_sla_{{ nivel }} {{ props.className or '' }}"/>
<a t-attf-href="/taller/orden/{{ props.id }}"/>
```

Cuando el atributo mezcla texto fijo con valores, `t-attf-` con `{{ }}` se lee mejor que concatenar.

La regla práctica: **`t-att-` para un valor, `t-attf-` para una plantilla de texto**.

## `t-on-`: eventos

```xml
<button t-on-click="alternar">Ver</button>
<button t-on-click="() => this.borrar(orden.id)">Borrar</button>
<input t-on-input="(ev) => this.buscar(ev.target.value)"/>
<form t-on-submit.prevent="guardar">…</form>
<div t-on-click.stop="seleccionar">…</div>
```

Ya lo vimos en la lección de eventos. Lo que vale repetir:

**Un método pelado** si no necesita argumentos. **Una flecha** si sí, y ahí `this` es el componente.

Los modificadores `.prevent`, `.stop` y `.self` evitan tener que escribir `ev.preventDefault()` a mano.

### El error del paréntesis

```xml Mal · se ejecuta durante el render
<button t-on-click="borrar()">
```

```xml Bien
<button t-on-click="borrar"/>
<button t-on-click="() => this.borrar(id)"/>
```

Con paréntesis, la expresión **se evalúa al renderizar** y lo que se registra como manejador es su resultado. El síntoma es característico: la acción ocurre sola al abrir la pantalla, y el clic no hace nada.

## `t-model`: enlace de dos vías

```xml
<input type="text" t-model="state.busqueda" class="form-control"/>
<input type="checkbox" t-model="state.soloMias"/>
<select t-model="state.estado">
    <option value="draft">Recibido</option>
    <option value="ready">Listo</option>
</select>
```

Lee el valor del estado y lo escribe de vuelta cuando el usuario escribe. Ahorra el par `t-att-value` + `t-on-input`.

Los modificadores:

```xml
<input t-model.lazy="state.busqueda"/>    <!-- al perder el foco, no en cada tecla -->
<input t-model.number="state.limite"/>    <!-- convierte a número -->
<input t-model.trim="state.nombre"/>      <!-- recorta espacios -->
```

`.lazy` vale la pena en un buscador que dispara consultas: sin él, cada tecla es un render y potencialmente una petición.

**`t-model` solo funciona contra algo reactivo.** Si apuntás a una propiedad normal del componente en vez de al estado, el input escribe el valor pero la pantalla no se entera. Es el mismo error de la lección de `useState`, con otra cara.

En el core aparece apenas 14 veces: para formularios de verdad, Odoo usa sus propios componentes de campo. Para un buscador o un filtro dentro de tu componente, es perfecto.

## `t-ref`: nombrar un nodo

```xml
<input t-ref="entrada" class="form-control"/>
```

```javascript
setup() {
    this.entradaRef = useRef("entrada");
    onMounted(() => this.entradaRef.el?.focus());
}
```

Lo vimos en la lección de eventos. El recordatorio que importa: **`.el` es `null` mientras el nodo no exista**, y si está dentro de un `t-if` falso, vuelve a ser `null`. Siempre con `?.`.

## Un ejemplo que junta todo

```xml service_workshop/static/src/components/sla_panel/sla_panel.xml
<t t-name="service_workshop.SlaPanel">
    <div class="o_sla_panel">
        <input type="text"
               class="form-control form-control-sm mb-2"
               placeholder="Buscar orden…"
               t-model.lazy="state.busqueda"/>

        <div t-if="!ordenesFiltradas.length" class="text-muted small">
            Nada con ese criterio.
        </div>

        <div t-foreach="ordenesFiltradas" t-as="orden" t-key="orden.id"
             class="d-flex justify-content-between align-items-center py-1"
             t-att-class="{ 'fw-bold': orden.days_in_shop > 7 }"
             t-on-click="() => this.abrir(orden.id)">
            <span t-esc="orden.code"/>
            <SlaLight dias="orden.days_in_shop" limite="7"/>
        </div>
    </div>
</t>
```

Un buscador con `t-model.lazy`, un vacío con `t-if`, un bucle con su `t-key`, una clase condicional y un clic con argumento. Es la forma típica de un componente de lista en Odoo.

> **Quedate con esto**
> `t-att-class` **suma** a las clases estáticas en vez de reemplazarlas, y con un objeto `{ clase: condición }` se lee mejor que concatenando. En `t-on-`, los paréntesis ejecutan la función durante el render: el síntoma es que la acción pasa sola al abrir. Y `t-model` solo funciona contra estado reactivo.
