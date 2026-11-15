---
title: "SCSS y estilos propios"
description: Agregar SCSS al bundle, usar las variables de Odoo y no romper el tema.
date: 2026-10-11
topic: ERP
tags: [odoo, scss, css]
goal: Estilos que conviven con los de Odoo sin pelearse.
course: odoo-web-framework
section: assets
order: 3
---

El CSS entra por el mismo mecanismo que el JavaScript: lo declarás en un bundle y Odoo lo compila y concatena.

La parte interesante no es cómo agregarlo —eso es una línea— sino cómo escribirlo para que conviva con los estilos de Odoo en vez de pelearse con ellos.

## Agregarlo

```python __manifest__.py
"assets": {
    "web.assets_backend": [
        "service_workshop/static/src/**/*",
    ],
},
```

Si venís de la lección anterior ya está: el glob `**/*` toma los `.scss` igual que los `.js`. Odoo los compila y los sirve en el bundle de CSS del mismo nombre.

```scss service_workshop/static/src/scss/workshop.scss
.o_sla_light {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}
```

Y ya está. No hay que compilar nada a mano ni configurar un watcher.

## Bootstrap ya está

Antes de escribir una regla, acordate de que **el cliente web de Odoo corre sobre Bootstrap**. Todas sus utilidades están disponibles:

```xml
<div class="d-flex align-items-center gap-2 text-muted small">
    <span class="badge text-bg-success">Listo</span>
</div>
```

Eso no necesita ni una línea de SCSS. Y es lo que hace el core: si abrís las plantillas de Odoo, la enorme mayoría del estilo son clases de Bootstrap.

**Escribí SCSS solo para lo que Bootstrap no resuelve.** Cada regla propia es una regla que alguien va a tener que mantener y que puede chocar con una actualización.

## Las variables de Odoo

Cuando sí necesitás SCSS, usá las variables del tema en vez de colores fijos:

```scss service_workshop/static/src/scss/workshop.scss
.o_sla_light {
    &.o_sla_ok     { color: $success; }
    &.o_sla_warn   { color: $warning; }
    &.o_sla_late   { color: $danger; }

    border-radius: $border-radius;
    padding: $spacer * 0.25 $spacer * 0.5;
}
```

Las variables de Bootstrap —`$primary`, `$success`, `$danger`, `$spacer`, `$border-radius`— están disponibles porque Odoo carga Bootstrap antes que tus archivos.

El beneficio concreto: **si el cliente cambia el color primario de su tema, tus estilos lo siguen solos**. Con un `#714B67` escrito a mano, no.

### Declarar variables propias

Si querés definir variables para que otros módulos las puedan sobrescribir, van en un bundle especial y **con `prepend`**:

```python __manifest__.py
"assets": {
    "web._assets_primary_variables": [
        ("prepend", "service_workshop/static/src/scss/variables.scss"),
    ],
    "web.assets_backend": [
        "service_workshop/static/src/**/*",
    ],
},
```

`prepend` es obligatorio acá: una variable tiene que estar **antes** de quien la usa. Es el mismo bundle y la misma técnica que usa el módulo de contabilidad del core.

## Prefijar, siempre

Esta es la regla que más disgustos evita.

```scss Mal · toca todas las tarjetas de Odoo
.card {
    border-color: red;
}
```

```scss Bien · solo lo tuyo
.o_service_order .card {
    border-color: $danger;
}
```

Tu SCSS se concatena en **el mismo archivo** que el de Odoo y el de todos los demás módulos instalados. Un selector genérico no afecta a tu módulo: afecta a toda la aplicación.

La convención del core es prefijar con `o_` y después el nombre de la cosa: `o_service_order`, `o_sla_light`. Seguila. Además te hace obvio, al leer el DOM, qué viene de dónde.

## Anidar con moderación

SCSS permite anidar, y es tentador pasarse:

```scss Difícil de mantener
.o_service_order {
    .o_content {
        .row {
            .col {
                span { color: red; }
            }
        }
    }
}
```

Eso genera un selector de cinco niveles con una especificidad altísima, que después hay que pelear con `!important`.

Dos niveles de anidado son suficientes casi siempre. Para las variantes, `&`:

```scss
.o_sla_light {
    color: $gray-600;

    &.o_sla_late { color: $danger; }
    &:hover { text-decoration: none; }
}
```

## Modo oscuro

Odoo tiene bundles aparte para la variante oscura:

```python
"assets": {
    "web.assets_backend": ["service_workshop/static/src/**/*"],
    "web.assets_web_dark": ["service_workshop/static/src/scss/workshop.dark.scss"],
},
```

De los bundles que usan los addons del core, `web.assets_web_dark` es **el más declarado de todos**, lo que dice bastante sobre cuánto importa.

Si usaste variables en vez de colores fijos, **la mayoría de tus estilos ya funcionan en oscuro sin hacer nada**. El bundle oscuro es para los pocos casos que necesitan un ajuste.

## Cuando un estilo no se aplica

| Síntoma | Causa |
|---|---|
| No cambia nada | el bundle de CSS está cacheado: `?debug=assets` |
| Cambia y se revierte | otra regla con más especificidad gana |
| Anda en claro, raro en oscuro | color fijo en vez de variable |
| Rompió algo de Odoo | selector sin prefijar |
| Error al compilar SCSS | lo vas a ver en el log del servidor, no en el navegador |

Ese último merece énfasis: **un error de SCSS aparece en el log de Odoo**, no en la consola del navegador. Si el CSS entero dejó de funcionar y no entendés por qué, mirá el log.

## Una herramienta que ayuda

En las herramientas del navegador, el inspector te muestra **qué regla está ganando y de qué archivo viene**. Con el bundle minificado eso es ilegible; con `?debug=assets` te dice el archivo y la línea reales.

Es la forma rápida de responder «¿por qué este color no es el mío?».

> **Quedate con esto**
> Bootstrap ya está cargado: usá sus clases antes de escribir SCSS. Cuando escribas, usá las variables del tema en vez de colores fijos —así el modo oscuro y los temas del cliente funcionan solos— y prefijá todos los selectores, porque tu CSS vive en el mismo archivo que el de toda la aplicación.
