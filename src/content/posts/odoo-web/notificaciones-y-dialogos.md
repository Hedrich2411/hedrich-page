---
title: "Notificaciones, diálogos y acciones"
description: Los tres servicios que resuelven el 90% de la interacción con el usuario.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Avisar, preguntar y navegar desde el cliente.
course: odoo-web-framework
section: servicios
order: 3
---

Avisar algo, preguntar antes de algo irreversible, llevar al usuario a otra pantalla. Odoo tiene un servicio para cada una y no hay motivo para inventar ninguna.

## `notification`: avisar sin interrumpir

```javascript
setup() {
    this.notification = useService("notification");
}

avisar() {
    this.notification.add(_t("Orden entregada."), {
        title: _t("Listo"),
        type: "success",
        sticky: false,
    });
}
```

Los `type` son `success`, `warning`, `danger` e `info`. Con `sticky: true` no se cierra sola.

Es el equivalente del cliente a devolver una acción `display_notification` desde Python, que vimos en el curso de backend. La diferencia: **esta no necesita ida y vuelta al servidor**.

### Con botones

```javascript
this.notification.add(_t("Se cerraron 3 órdenes."), {
    type: "success",
    buttons: [{
        name: _t("Ver"),
        onClick: () => this.action.doAction(/* ... */),
    }],
});
```

Útil para «hecho, ¿querés verlo?» sin obligar a nadie a nada.

### Cuándo no usarla

Una notificación es **efímera**: si el usuario no está mirando, se la pierde. No la uses para algo que no se puede perder. Para eso está el chatter, o un diálogo.

Y no notifiques cada acción exitosa. Si el usuario ve el resultado en pantalla, el aviso es ruido.

## `dialog`: preguntar

```javascript
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

setup() {
    this.dialog = useService("dialog");
}

borrar() {
    this.dialog.add(ConfirmationDialog, {
        title: _t("Cancelar la orden"),
        body: _t("Esta acción no se puede deshacer. ¿Seguir?"),
        confirmLabel: _t("Cancelar la orden"),
        confirm: () => this.cancelarDeVerdad(),
        cancel: () => {},
    });
}
```

`ConfirmationDialog` es el diálogo estándar de Odoo. Usalo en vez del `confirm()` del navegador: este respeta el estilo, se traduce y se puede probar.

**Pasá siempre `cancel`**, aunque esté vacío: sin eso, el diálogo no muestra el botón de cancelar en algunas variantes.

### Un diálogo propio

```javascript
import { Dialog } from "@web/core/dialog/dialog";

export class DiagnosticoDialog extends Component {
    static template = "service_workshop.DiagnosticoDialog";
    static components = { Dialog };
    static props = { orderId: Number, close: Function };

    setup() {
        this.orm = useService("orm");
        this.state = useState({ texto: "" });
    }

    async guardar() {
        await this.orm.write("service.order", [this.props.orderId], {
            diagnosis: this.state.texto,
        });
        this.props.close();
    }
}
```

```xml
<t t-name="service_workshop.DiagnosticoDialog">
    <Dialog title="'Registrar diagnóstico'">
        <textarea class="form-control" t-model="state.texto" rows="5"/>
        <t t-set-slot="footer">
            <button class="btn btn-primary" t-on-click="guardar">Guardar</button>
            <button class="btn btn-secondary" t-on-click="props.close">Cancelar</button>
        </t>
    </Dialog>
</t>
```

```javascript
this.dialog.add(DiagnosticoDialog, { orderId: 4 });
```

**`close` llega como prop automáticamente**: el servicio se la inyecta. No la declares vos ni intentes cerrarlo de otra forma.

Fijate que esto es, en esencia, **un wizard del curso de backend escrito del lado del cliente**. ¿Cuál conviene? Si necesita validación del servidor, permisos o dejar rastro, el wizard de Python. Si es puramente de interfaz y querés evitar el viaje, el diálogo de OWL.

## `action`: navegar

```javascript
setup() {
    this.action = useService("action");
}

abrirOrden(id) {
    this.action.doAction({
        type: "ir.actions.act_window",
        res_model: "service.order",
        res_id: id,
        views: [[false, "form"]],
    });
}
```

`doAction` acepta **el mismo diccionario que devolvías desde Python**, o el identificador externo de una acción guardada:

```javascript
this.action.doAction("service_workshop.action_service_order");
```

La segunda forma es mejor cuando la acción existe: respeta su dominio, su contexto y sus vistas sin repetirlos.

### Otras cosas útiles

```javascript
this.action.doActionButton({ ... });      // como apretar un botón de vista
this.action.restore();                     // volver a la acción anterior
this.action.switchView("list");            // cambiar de vista en la actual
await this.action.loadState({ ... });      // restaurar desde la URL
```

`restore()` es lo que hace el botón «atrás» de las migas de pan.

### Abrir un registro en un diálogo

```javascript
this.action.doAction({
    type: "ir.actions.act_window",
    res_model: "service.order",
    res_id: id,
    views: [[false, "form"]],
    target: "new",
});
```

El `target: "new"` del curso de backend funciona igual acá.

## `ui`: bloquear mientras algo tarda

```javascript
setup() {
    this.ui = useService("ui");
}

async procesarTodo() {
    this.ui.block();
    try {
        await this.orm.call("service.order", "procesar_lote", [[...ids]]);
    } finally {
        this.ui.unblock();
    }
}
```

Pone el velo de carga sobre la pantalla. **El `finally` no es opcional**: si la operación falla y no desbloqueás, la interfaz queda muerta y el usuario tiene que recargar.

Para operaciones cortas no lo uses: el parpadeo molesta más de lo que informa.

## Cuál usar

| Querés | Servicio |
|---|---|
| Avisar algo que puede perderse | `notification` |
| Confirmar antes de algo irreversible | `dialog` + `ConfirmationDialog` |
| Pedir datos | `dialog` con uno propio, o un wizard |
| Llevar a otra pantalla | `action.doAction` |
| Volver atrás | `action.restore` |
| Tapar mientras algo tarda | `ui.block` / `unblock` |

> **Quedate con esto**
> `ConfirmationDialog` en vez del `confirm()` del navegador, y pasá siempre `cancel`. La prop `close` de un diálogo propio la inyecta el servicio, no la declares. `doAction` acepta el mismo diccionario que devolvías desde Python, pero si la acción ya existe, pasá su identificador externo. Y todo `ui.block()` necesita su `unblock()` en un `finally`.
