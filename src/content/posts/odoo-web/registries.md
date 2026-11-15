---
title: "Registries: cómo Odoo encuentra tu código"
description: El patrón que usa todo el frontend de Odoo para ser extensible.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Entender el mecanismo por el que todo lo propio se enchufa al cliente web.
course: odoo-web-framework
section: widgets
order: 1
---

En el backend, cuando querías agregar algo, heredabas un modelo. En el frontend el mecanismo equivalente es el **registry**.

Es un diccionario global por categorías. Odoo mira ahí para saber qué widgets de campo existen, qué servicios hay, qué tipos de vista puede renderizar. Vos agregás una entrada y Odoo lo encuentra.

Todo lo que escribas de acá en adelante termina con un `registry.category(...).add(...)`.

## La forma

```javascript
import { registry } from "@web/core/registry";

registry.category("fields").add("sla_light", slaLightField);
```

Tres partes: **el registry global**, **una categoría** y **un nombre con su valor**.

El nombre es con el que después lo vas a referenciar desde el XML o desde otro código.

## Las categorías que importan

| Categoría | Qué guarda | Dónde lo usás |
|---|---|---|
| `fields` | widgets de campo | `widget="..."` en la vista |
| `services` | servicios | `useService("...")` |
| `views` | tipos de vista | `view_mode` de la acción |
| `actions` | acciones de cliente | `ir.actions.client` |
| `formatters` | cómo se muestra cada tipo | internamente |
| `parsers` | cómo se lee lo que escribe el usuario | internamente |
| `main_components` | componentes siempre montados | diálogos, notificaciones |
| `systray` | íconos de la barra superior | el reloj de actividades |

Hay más de veinte. La forma de descubrirlas es buscar `registry.category(` en el fuente de Odoo.

## Por qué existe

El problema que resuelve: **Odoo no puede importar tu código**. El core se escribió antes que tu módulo y no sabe que existe.

Si el renderizador de formularios tuviera que importar todos los widgets posibles, cada widget nuevo exigiría tocar el core. Con el registry se invierte: **vos te anotás, y Odoo busca por nombre cuando lo necesita**.

Es la misma idea que `_inherit` en el backend, resuelta de otra forma porque en JavaScript no hay un registro de modelos.

## Leer el registry

```javascript
const fields = registry.category("fields");

fields.get("badge");              // falla si no existe
fields.get("badge", null);        // con valor por defecto
fields.contains("badge");         // true o false
fields.getEntries();              // [[nombre, valor], ...]
```

En la consola del navegador con `?debug=assets`, inspeccionar el registry es la forma más rápida de ver qué widgets hay disponibles.

## El orden y `force`

```javascript
registry.category("fields").add("badge", miBadge, { force: true });
```

Sin `force`, agregar algo con un nombre que ya existe **lanza un error**. Es a propósito: evita que dos módulos pisen el mismo nombre sin enterarse.

Con `force`, reemplazás el que estaba. Solo cuando de verdad querés sustituir el del core — y sabiendo que afecta a toda la aplicación.

```javascript
registry.category("services").add("mi_servicio", servicio, { sequence: 5 });
```

`sequence` ordena cuando el orden importa, como en los íconos de la barra superior.

## Cuándo se registra

```javascript
import { registry } from "@web/core/registry";
import { SlaLight } from "./sla_light";

export const slaLightField = { component: SlaLight, /* ... */ };

registry.category("fields").add("sla_light", slaLightField);
```

La llamada va **en el nivel superior del módulo**, no dentro de una función. Se ejecuta cuando el navegador evalúa el archivo, o sea al cargar el bundle.

De ahí sale una consecuencia práctica: **si tu archivo no está en el bundle, el registro no ocurre y Odoo no encuentra nada**. El síntoma es «widget desconocido» o un campo que se renderiza como texto plano.

Es la misma lista de sospechosos de la sección de assets.

## Extender sin reemplazar: `patch`

A veces no querés agregar ni sustituir, sino **modificar** algo que ya está:

```javascript
import { patch } from "@web/core/utils/patch";
import { ListRenderer } from "@web/views/list/list_renderer";

patch(ListRenderer.prototype, {
    setup() {
        super.setup();
        console.log("una lista más");
    },
});
```

`patch` modifica el prototipo de una clase existente, y el `super` adentro llama a la implementación original.

Es potente y conviene usarlo con cuidado: **afecta a todas las instancias de esa clase en toda la aplicación**. Si dos módulos parchan el mismo método, el orden de carga decide y la cosa se vuelve difícil de seguir.

Antes de parchar, preguntate si no alcanza con heredar la clase y registrar la tuya. Casi siempre alcanza.

## Dónde mirar

```bash Terminal · qué categorías existen
grep -rho 'registry.category("[a-z_]*")' addons/web/static/src/ | sort -u
```

```bash Terminal · qué widgets de campo trae Odoo
grep -rh 'registry.category("fields").add' addons/*/static/src/ | head -40
```

Esa segunda consulta vale oro: antes de escribir un widget, fijate si ya existe. Odoo trae decenas y el que necesitás puede estar ahí.

> **Quedate con esto**
> El registry es cómo Odoo encuentra código que no puede importar: vos te anotás en una categoría con un nombre y Odoo busca por ese nombre. El registro corre al evaluar el archivo, así que si el archivo no está en el bundle no pasa nada y el síntoma es «widget desconocido». Y antes de `patch`, probá con heredar y registrar lo tuyo.
