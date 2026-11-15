---
title: "Layout, control panel y la barra de búsqueda"
description: Reusar el cromo del cliente web en vez de inventarlo.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Que tu vista propia se vea y se comporte como las de Odoo.
course: odoo-web-framework
section: vistas
order: 4
---

Una vista propia que no usa el cromo de Odoo se nota enseguida: no tiene barra de búsqueda, no tiene migas, no tiene el selector de vistas, y el usuario siente que se cayó a otra aplicación.

Esta lección es sobre no inventar nada de eso.

## `Layout`

```xml
<t t-name="service_workshop.WorkshopBoard">
    <Layout className="'o_workshop_board'" display="props.display">
        <div class="p-3">
            <!-- tu contenido -->
        </div>
    </Layout>
</t>
```

```javascript
import { Layout } from "@web/search/layout";

static components = { Layout };
```

Con esas tres líneas tu vista gana el panel de control, las migas de pan, la barra de búsqueda, el selector de vistas y el paginador.

**`display`** viene de las props estándar y lleva lo que la acción pidió mostrar. Pasándolo tal cual, respetás lo que configuró quien definió la acción — por ejemplo una acción que abre sin barra de búsqueda.

## Botones propios en el panel de control

`Layout` tiene un slot para eso:

```xml
<Layout display="props.display">
    <t t-set-slot="control-panel-create-button">
        <button class="btn btn-primary" t-on-click="nuevaOrden">
            Nueva orden
        </button>
    </t>

    <t t-set-slot="layout-buttons">
        <button class="btn btn-secondary" t-on-click="exportar">
            Exportar
        </button>
    </t>

    <div class="p-3">…</div>
</Layout>
```

Los slots de `Layout` cambian entre versiones, así que la forma confiable de saber cuáles hay es mirar su plantilla:

```bash Terminal
grep -n 't-slot' addons/web/static/src/search/layout.xml
```

Es el tipo de consulta que conviene hacer en vez de confiar en un tutorial.

## La barra de búsqueda

Acá está el valor real de `Layout`: **la barra de búsqueda funciona sola**, con los filtros, las agrupaciones y el panel lateral que definiste en la vista de búsqueda del curso de backend.

Lo único que tenés que hacer es **respetar lo que te manda**:

```javascript
setup() {
    onWillStart(async () => {
        await this.model.load({ domain: this.props.domain });
    });
}
```

Y recargar cuando cambia:

```javascript
import { onWillUpdateProps } from "@odoo/owl";

setup() {
    // ...
    onWillUpdateProps(async (nuevas) => {
        if (JSON.stringify(nuevas.domain) !== JSON.stringify(this.props.domain)) {
            await this.model.load({ domain: nuevas.domain });
            this.state.grupos = this.model.grupos;
        }
    });
}
```

Esa comparación es la lección del ciclo de vida aplicada: **si no comparás, recargás en cada re-render del padre**, y una vista que consulta al servidor sin motivo se nota.

### El `searchModel`

Para casos más finos, el entorno trae el modelo de búsqueda completo:

```javascript
this.env.searchModel.domain          // el dominio actual
this.env.searchModel.groupBy         // las agrupaciones activas
this.env.searchModel.context         // el contexto

this.env.searchModel.toggleSearchItem(id);   // activar un filtro desde código
```

Sirve, por ejemplo, para que un clic en tu tablero active el filtro correspondiente en vez de abrir otra pantalla.

Usalo con moderación: es API interna y cambia entre versiones.

## Abrir otra pantalla

```javascript
import { useService } from "@web/core/utils/hooks";

setup() {
    this.action = useService("action");
}

abrirGrupo(grupo) {
    this.action.doAction({
        type: "ir.actions.act_window",
        res_model: "service.order",
        view_mode: "list,form",
        domain: [["user_id", "=", grupo.id]],
    });
}
```

`doAction` acepta **el mismo diccionario de acción que devolvías desde Python** en el curso de backend. Es literalmente la misma estructura, del otro lado.

Y también acepta el identificador externo de una acción guardada:

```javascript
this.action.doAction("service_workshop.action_service_order");
```

Esa forma es mejor cuando la acción ya existe: respeta su dominio, su contexto y sus vistas sin que tengas que repetirlos.

## El paginador

Si tu vista muestra una lista larga, conviene paginar en vez de traer todo:

```javascript
import { usePager } from "@web/search/pager_hook";

setup() {
    // ...
    usePager(() => ({
        offset: this.state.offset,
        limit: this.state.limit,
        total: this.state.total,
        onUpdate: async ({ offset, limit }) => {
            Object.assign(this.state, { offset, limit });
            await this.cargar();
        },
    }));
}
```

`usePager` dibuja el paginador en el panel de control y te avisa cuando el usuario cambia de página. Vos solo tenés que traer los datos.

## El estado vacío

```xml
<div t-if="!state.grupos.length" class="o_nocontent_help">
    <p class="o_view_nocontent_smiling_face">
        No hay órdenes abiertas
    </p>
    <p>Cuando entre un equipo al taller, aparece acá.</p>
</div>
```

Las clases `o_nocontent_help` y `o_view_nocontent_smiling_face` son las que usa Odoo para el estado vacío. Reusarlas hace que tu vista se vea igual que las demás — y son las mismas que llenabas con el campo `help` de la acción en el curso de backend.

## Con esto cierra la sección

Ya sabés heredar una vista para agregarle algo y escribir una propia que se integre con el resto del cliente web.

Lo que sigue son los servicios: la infraestructura que tus componentes y vistas usan para hablar con el servidor, avisar al usuario y navegar.

> **Quedate con esto**
> `Layout` te da panel de control, migas, barra de búsqueda y selector de vistas con tres líneas: no reinventes nada de eso. Respetá el `props.domain` que te llega y compará antes de recargar en `onWillUpdateProps`. Y `doAction` recibe el mismo diccionario de acción que devolvías desde Python — o mejor, el identificador externo de una acción que ya exista.
