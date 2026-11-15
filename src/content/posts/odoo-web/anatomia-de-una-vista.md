---
title: "Anatomía de una vista JavaScript"
description: Controller, Renderer, Model y ArchParser - qué hace cada una y cómo se conectan.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Entender las piezas de una vista de Odoo antes de tocar ninguna.
course: odoo-web-framework
section: vistas
order: 1
---

Un widget de campo controla una celda. Una **vista** controla la pantalla entera: qué datos se traen, cómo se dibujan, qué botones hay.

Antes de escribir una conviene entender cómo está armada una de Odoo, porque la estructura es siempre la misma.

## El objeto de vista

Así se define la vista de lista en el core:

```javascript addons/web/static/src/views/list/list_view.js
export const listView = {
    type: "list",

    Controller: ListController,
    Renderer: ListRenderer,
    ArchParser: ListArchParser,
    Model: RelationalModel,

    buttonTemplate: "web.ListView.Buttons",

    props: (genericProps, view) => { /* ... */ },
};

registry.category("views").add("list", listView);
```

Un objeto con cuatro clases y un registro. Eso es todo lo que Odoo necesita para saber renderizar una lista.

## Las cuatro piezas

**`ArchParser` — lee el XML.** Toma el `arch` de la vista —ese `<list>` con sus `<field>` que escribiste en el curso de backend— y lo convierte en una estructura que el JavaScript puede usar: qué columnas hay, qué widget lleva cada una, qué decoraciones.

Corre **una vez**, al abrir la vista.

**`Model` — habla con el servidor.** Trae los registros, los mantiene en memoria, sabe cuáles están modificados, los guarda. Es quien llama al ORM.

La mayoría de las vistas usan `RelationalModel`, que es el modelo genérico de Odoo. Solo escribís uno propio si tus datos no son registros de un modelo.

**`Renderer` — dibuja.** Un componente OWL que recibe los datos del Model y la estructura del ArchParser, y produce el DOM. Es la pieza más grande y la que más se hereda.

**`Controller` — coordina.** Es el componente raíz: arma el Model, le pasa los datos al Renderer, maneja los botones del panel de control, responde a lo que hace el usuario.

## Cómo fluyen los datos

```text
arch XML
   ↓  ArchParser
estructura de columnas/campos
   ↓
Controller ──→ Model ──→ ORM ──→ servidor
   │              ↓
   └──────────→ Renderer ──→ DOM
```

El usuario hace clic → el Renderer avisa al Controller → el Controller le pide algo al Model → el Model llama al servidor → vuelven datos → el Renderer se re-renderiza.

Es el mismo flujo unidireccional de la lección de eventos, a escala de pantalla.

## Dónde entra el dominio y el contexto

Esto conecta con el curso de backend: el `domain` y el `context` de la acción llegan al Controller como props, y el Controller se los pasa al Model, que los usa al llamar al ORM.

Por eso un `search_default_` del contexto funciona: la barra de búsqueda lo lee, arma el dominio y el Model lo incluye en la consulta.

## Leer una vista del core

La mejor forma de entender esto es abrir una. Empezá por la más chica:

```text
addons/web/static/src/views/
├── list/           la más usada, y la más grande
├── kanban/
├── form/
├── calendar/
└── view_components/   piezas compartidas
```

Un consejo de lectura: **empezá por el archivo `*_view.js`**, que es el objeto de doce líneas como el de arriba. Te dice qué clases componen la vista. Después abrís la que te interese.

El `ListRenderer` tiene miles de líneas y no hace falta entenderlo entero; lo que sirve es saber **qué pieza hace qué**, para saber cuál heredar.

## Qué vas a heredar en la práctica

Esta es la parte útil:

| Querés | Heredás |
|---|---|
| Un botón en el panel de control | el `Controller` |
| Cambiar cómo se dibuja una fila | el `Renderer` |
| Interceptar el guardado | el `Model` o el `Controller` |
| Leer un atributo nuevo del XML | el `ArchParser` |
| Una pantalla con datos que no son registros | todo, y escribís un `Model` propio |

En la enorme mayoría de los casos es **el Controller o el Renderer**, y eso es la próxima lección.

## Una vista no es una acción

Vale aclararlo porque se mezcla: la **acción** (`ir.actions.act_window`) dice qué modelo abrir y con qué `view_mode`. La **vista** es cómo se dibuja cada uno de esos modos.

Cuando registrás un tipo de vista nuevo en la categoría `views`, su nombre es lo que podés poner en `view_mode`:

```javascript
registry.category("views").add("workshop_board", workshopBoardView);
```

```xml
<field name="view_mode">workshop_board,list,form</field>
```

Esa es la conexión entre lo que escribís en JavaScript y lo que declarás en el XML del backend.

> **Quedate con esto**
> Una vista son cuatro piezas con roles claros: el ArchParser lee el XML una vez, el Model habla con el servidor, el Renderer dibuja y el Controller coordina. Para leer el código del core, empezá siempre por el archivo `*_view.js`, que en doce líneas te dice qué clases la componen. Y lo que vas a heredar casi siempre es el Controller o el Renderer.
