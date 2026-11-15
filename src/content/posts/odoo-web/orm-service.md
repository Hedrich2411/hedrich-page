---
title: "El ORM service: llamar al modelo desde el cliente"
description: search_read, call y los métodos del modelo desde el navegador.
date: 2026-10-11
topic: ERP
tags: [odoo, owl, javascript]
goal: Leer y escribir registros desde JavaScript, con los permisos del usuario.
course: odoo-web-framework
section: servicios
order: 2
---

El servicio `orm` es el más usado del cliente web, y es la contraparte exacta del ORM de Python que aprendiste en el curso de backend.

Todo lo que escribas acá **pasa por los mismos permisos, reglas de registro y validaciones** del servidor. No hay puerta trasera.

## Los métodos

```javascript
const orm = useService("orm");

await orm.searchRead("service.order", [["state", "=", "ready"]], ["code", "partner_id"]);
await orm.search("service.order", [["state", "=", "ready"]]);
await orm.searchCount("service.order", [["state", "=", "ready"]]);
await orm.read("service.order", [4, 5], ["code", "amount_total"]);
await orm.create("service.order", [{ partner_id: 10, equipment_id: 3 }]);
await orm.write("service.order", [4], { state: "ready" });
await orm.unlink("service.order", [4]);
await orm.call("service.order", "action_deliver", [[4]]);
```

Son los mismos nombres del backend, en camelCase.

**`searchRead` es el que más vas a usar**: busca y lee en una sola llamada, igual que por RPC.

**`call` llama cualquier método del modelo**, incluidos los tuyos. El primer argumento de `args` es la lista de ids, igual que en XML-RPC.

### Argumentos opcionales

```javascript
await orm.searchRead("service.order", dominio, ["code"], {
    limit: 20,
    offset: 0,
    order: "date_in desc",
    context: { lang: "es_PE" },
});
```

El cuarto parámetro son los `kwargs`. Ahí van `limit`, `offset`, `order` y el `context`.

## Agrupar

```javascript
const filas = await orm.formattedReadGroup(
    "service.order",
    [["state", "not in", ["done", "cancel"]]],
    ["user_id"],
    ["__count", "amount_total:sum"],
);
```

Devuelve una fila por grupo, con el valor agrupado y los agregados.

> **Si venís de versiones anteriores**
> El método se llamaba `readGroup` y recibía `(model, domain, fields, groupby)`. **En Odoo 19 es `formattedReadGroup` y los `groupby` van antes que los agregados.** El conteo se pide con `"__count"` y vuelve en `f.__count`, no en `f.campo_count`.
>
> Lo descubrí construyendo el tablero de la sección anterior: llamar al nombre viejo produce un `TypeError` dentro del ciclo de vida de OWL que no menciona el ORM por ningún lado.

## La misma regla de siempre

Todo lo que aprendiste sobre rendimiento en el backend vale igual acá:

**Pedí solo los campos que necesitás.** Cada campo de más viaja por la red.

**Filtrá en el dominio, no en JavaScript.** Traer mil registros para quedarte con diez es el mismo error, agravado porque ahora además viajan.

**Para totales, agrupá.** `formattedReadGroup` en vez de traer todo y sumar con `reduce`.

```javascript Mal
const todas = await orm.searchRead("service.order", [], ["amount_total"]);
const total = todas.reduce((a, o) => a + o.amount_total, 0);
```

```javascript Bien
const [{ "amount_total:sum": total }] = await orm.formattedReadGroup(
    "service.order", [], [], ["amount_total:sum"],
);
```

## Los errores llegan solos

```javascript
async entregar() {
    await this.orm.call("service.order", "action_deliver", [[this.props.id]]);
}
```

Si el método de Python lanza un `UserError`, **el cliente web muestra el diálogo automáticamente**. No tenés que capturar nada.

Esa es la razón por la que las validaciones del curso de backend siguen funcionando sin escribir una línea de JavaScript: el `@api.constrains` salta, el error viaja, el diálogo aparece.

Si querés manejarlo vos:

```javascript
try {
    await this.orm.call("service.order", "action_deliver", [[id]]);
} catch (error) {
    this.notification.add(_t("No se pudo entregar."), { type: "danger" });
    // sin re-lanzar, el diálogo rojo no aparece
}
```

Capturar y no re-lanzar **se come el error**. Hacelo solo si de verdad vas a dar una respuesta mejor.

## `rpc`, el nivel de abajo

```javascript
import { rpc } from "@web/core/network/rpc";

const datos = await rpc("/api/taller/ordenes", { documento: "20100030838" });
```

`rpc` llama **cualquier ruta**, no solo el ORM. Es lo que usás para hablar con los controladores propios que escribiste en el curso de backend.

Para registros, usá `orm`: valida los argumentos y es más claro de leer.

## Cancelación automática

```javascript
setup() {
    this.orm = useService("orm");
    onWillStart(async () => {
        this.state.datos = await this.orm.searchRead(/* ... */);
    });
}
```

Si el usuario cierra la pantalla mientras la llamada está en vuelo, el `useService` **cancela la promesa** y tu código nunca intenta escribir en un componente desmontado.

Eso lo da el hook. Si usás `env.services.orm` directo, esa protección no está.

## Qué no podés hacer

**No podés leer campos restringidos por grupo.** El `groups=` de la lección de seguridad del curso de backend se aplica igual: el campo ni viaja.

**No podés saltearte una regla de registro.** Un `searchRead` sin dominio devuelve lo que el usuario puede ver, no todo.

**No hay `sudo()`.** Y es correcto: el cliente corre en la máquina del usuario, cualquier escalada de privilegios ahí sería un agujero. Si una operación necesita más permisos, va en un método de Python que los valide.

> **Quedate con esto**
> Los métodos son los del backend en camelCase, y los permisos y validaciones del servidor se aplican igual — incluidos tus `@api.constrains`, cuyos errores aparecen solos en pantalla. `formattedReadGroup` reemplazó a `readGroup` y cambió el orden de los argumentos. Y no existe `sudo()` del lado del cliente, a propósito.
