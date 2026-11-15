---
title: "Tu primer archivo JS en el backend"
description: De cero a un archivo que corre en el cliente de Odoo, con el sistema de módulos nativo de 19.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript]
goal: Un módulo JavaScript propio cargado y ejecutándose dentro del cliente web.
course: odoo-web-framework
section: assets
order: 2
---

Vamos a poner un archivo a correr. Son pocas líneas, pero hay una decisión de sintaxis que conviene entender bien porque **casi todo lo que vas a encontrar escrito está desactualizado**.

## El archivo

```javascript service_workshop/static/src/js/hola.js
import { registry } from "@web/core/registry";

console.log("service_workshop: el JS cargó");

export const miServicio = {
    start() {
        console.log("y este es un servicio");
    },
};

registry.category("services").add("service_workshop.hola", miServicio);
```

```python __manifest__.py
"assets": {
    "web.assets_backend": [
        "service_workshop/static/src/js/hola.js",
    ],
},
```

Un `-u service_workshop`, recargás con `?debug=assets`, y los dos mensajes están en la consola del navegador.

## Módulos ES nativos

Odoo 19 usa **módulos ES del navegador**. `import` y `export` normales, los que ya conocés.

```javascript
import { registry } from "@web/core/registry";
import { Component, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
```

> **Si venís de versiones anteriores**
> Durante años los archivos empezaban con el comentario mágico `/** @odoo-module **/`, que le decía a Odoo que transpilara ese archivo a su sistema de módulos propio. **En Odoo 19 ya no hace falta**: en el código fuente queda en apenas 21 archivos de todo el core, y los demás arrancan directo con `import`. Si lo ponés no rompe nada, pero es ruido.
>
> Y si encontrás algo con `odoo.define("modulo.nombre", function (require) { ... })`, eso es de dos generaciones atrás.

## Las rutas con arroba

```javascript
import { registry } from "@web/core/registry";
```

Ese `@web` no es un paquete de npm. Es **el módulo de Odoo llamado `web`**, y la ruta sigue desde su carpeta `static/src`:

```text
@web/core/registry   →   addons/web/static/src/core/registry.js
```

La regla general: `@<módulo>/<ruta dentro de static/src>`.

Para tu propio módulo es igual:

```javascript
import { SlaLight } from "@service_workshop/fields/sla_light/sla_light";
```

Dentro del mismo módulo también podés usar rutas relativas —`./sla_light`— y el core mezcla las dos. Yo prefiero la forma con arroba: no se rompe si movés el archivo de carpeta.

**Lo que importás tiene que venir de un módulo que esté en tus `depends`.** Si importás de `@web`, necesitás `web` declarado. El error que vas a ver habla de un módulo que no se encuentra y no menciona `depends`.

## El manifest, otra vez

```python __manifest__.py
{
    "depends": ["base", "mail", "web"],
    "assets": {
        "web.assets_backend": [
            "service_workshop/static/src/**/*",
        ],
    },
}
```

Agregué `web` a `depends`, y usé un glob para no volver a tocar el manifest por cada archivo nuevo.

Un detalle del glob: `**/*` toma **todo** lo que haya bajo `static/src`, incluidos los `.scss` y los `.xml` de plantillas. Eso está bien y es lo que hace el core. Lo que **no** querés que entre ahí son los tours y los tests, que van a sus propios bundles — por eso conviene dejarlos fuera de `src/`, en `static/tests/`.

## Verificar que cargó

Tres formas, de la más rápida a la más completa:

**La consola.** Si pusiste un `console.log`, está ahí. Obvio y efectivo mientras estás arrancando.

**El panel de red.** Con `?debug=assets`, buscá tu archivo por nombre. Si no aparece en la lista, no está en el bundle, y el problema es el manifest.

**Las fuentes.** En las herramientas del navegador, pestaña de fuentes, buscá `hola.js`. Si está, podés ponerle un breakpoint.

```text El error típico, y lo que significa
Failed to resolve module specifier "@web/core/registry"
```

Ese mensaje quiere decir que el módulo `web` no está en tus `depends`, o que escribiste mal la ruta.

## El patrón que vas a repetir

Casi todo lo que escribas en este curso tiene la misma forma: **importás algo de `@web`, definís algo tuyo, y lo registrás**.

```javascript
import { registry } from "@web/core/registry";

class LoMio { /* ... */ }

registry.category("alguna_categoria").add("mi_nombre", LoMio);
```

Ese `registry` es el mecanismo por el que todo el frontend de Odoo es extensible, y tiene su propia lección más adelante. Por ahora quedate con la forma.

## Limpieza antes de seguir

Borrá el `hola.js`: era para comprobar que la cadena funciona. A partir de la próxima lección empezamos con el componente de verdad.

Dejá el `web` en `depends` y el glob en el manifest: eso se queda.

> **Quedate con esto**
> Odoo 19 usa `import`/`export` nativos: el `/** @odoo-module **/` ya no hace falta y `odoo.define` es historia antigua. Las rutas `@modulo/...` apuntan a `static/src` de ese módulo, y ese módulo tiene que estar en tus `depends`. Y el patrón de todo lo que sigue es siempre el mismo: importar, definir, registrar.
