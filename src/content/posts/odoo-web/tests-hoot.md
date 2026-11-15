---
title: "Tests HOOT del lado del cliente"
description: El framework de tests de JavaScript de Odoo 19 y cómo se escribe uno.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript, testing]
goal: Probar un componente aislado, sin levantar el navegador a mano.
course: odoo-web-framework
section: tests
order: 2
---

Un tour prueba el flujo completo. **HOOT** prueba una pieza sola: este componente, con estos datos, ¿muestra lo que tiene que mostrar?

Es el framework de tests de JavaScript que Odoo escribió para sí mismo. En el cliente web hay más de trescientos archivos que lo usan.

## Un test

```javascript service_workshop/static/tests/sla_light.test.js
import { beforeEach, describe, expect, test } from "@odoo/hoot";
import { makeMockEnv } from "@web/../tests/web_test_helpers";
import { nivelSla } from "@service_workshop/utils/sla";

describe.current.tags("headless");

test("por debajo del límite es verde", () => {
    expect(nivelSla(2, 7)).toBe("ok");
});

test("cerca del límite avisa", () => {
    expect(nivelSla(6, 7)).toBe("warn");
});

test("en el límite ya está atrasada", () => {
    expect(nivelSla(7, 7)).toBe("late");
});
```

```python __manifest__.py
"assets": {
    "web.assets_backend": ["service_workshop/static/src/**/*"],
    "web.assets_unit_tests": ["service_workshop/static/tests/**/*"],
},
```

Los tests van en **`web.assets_unit_tests`**, un bundle propio. Y los archivos, en `static/tests/`, fuera de `src/` — así el glob del backend no los arrastra.

## La forma

```javascript
import { describe, test, expect, beforeEach } from "@odoo/hoot";
```

Si usaste Jest o Vitest, esto te suena: `describe`, `test`, `expect`, `beforeEach`. HOOT copia esa API a propósito.

```javascript
describe.current.tags("headless");
```

Las etiquetas definen cómo corre el test. **`headless`** es para los que no necesitan DOM —funciones puras, servicios— y son los más rápidos. Sin esa etiqueta, el test monta el entorno gráfico.

## Probar un componente

```javascript service_workshop/static/tests/sla_light_field.test.js
import { describe, expect, test } from "@odoo/hoot";
import { queryFirst, queryAllTexts } from "@odoo/hoot-dom";
import { mountView, onRpc } from "@web/../tests/web_test_helpers";
import { defineModels, models, fields } from "@web/../tests/web_test_helpers";

class ServiceOrder extends models.Model {
    _name = "service.order";
    code = fields.Char();
    days_in_shop = fields.Integer();
    _records = [
        { id: 1, code: "TAL/0001", days_in_shop: 2 },
        { id: 2, code: "TAL/0002", days_in_shop: 9 },
    ];
}

defineModels([ServiceOrder]);

test("el semáforo pinta de rojo lo atrasado", async () => {
    await mountView({
        type: "form",
        resModel: "service.order",
        resId: 2,
        arch: `
            <form>
                <field name="days_in_shop" widget="sla_light" options="{'limite': 7}"/>
            </form>`,
    });

    expect(queryFirst(".o_sla_light")).toHaveClass("o_sla_late");
    expect(queryAllTexts(".o_sla_light")).toEqual(["9 días"]);
});
```

Acá está lo que hace a HOOT útil: **define un modelo falso con registros falsos y monta una vista de verdad**. No hay servidor, no hay base de datos, y el widget corre exactamente como corre en producción.

Fijate que el `arch` se escribe inline en el test. Eso te deja probar el widget con distintas opciones sin tocar las vistas del módulo.

## Los tres paquetes

```javascript
import { test, expect } from "@odoo/hoot";          // el framework
import { click, queryFirst } from "@odoo/hoot-dom";  // interactuar con el DOM
import { mockDate, advanceTime } from "@odoo/hoot-mock";  // falsear tiempo y red
```

- **`@odoo/hoot`** — `describe`, `test`, `expect`, los ganchos.
- **`@odoo/hoot-dom`** — consultar y manipular el DOM: `click`, `edit`, `queryFirst`, `queryAll`.
- **`@odoo/hoot-mock`** — controlar el tiempo, los temporizadores y la aleatoriedad.

El tercero es el que vuelve posibles los tests de cosas que esperan:

```javascript
import { advanceTime } from "@odoo/hoot-mock";

test("el aviso se cierra solo", async () => {
    // ...
    await advanceTime(5000);
    expect(".o_notification").toHaveCount(0);
});
```

**`advanceTime` adelanta el reloj sin esperar de verdad.** Un test de un temporizador de cinco segundos corre en milisegundos.

## Simular el servidor

```javascript
import { onRpc } from "@web/../tests/web_test_helpers";

test("recarga el conteo", async () => {
    onRpc("service.order", "search_count", () => 3);
    // ...
    expect(".o_atrasadas").toHaveText("3 órdenes atrasadas");
});
```

`onRpc` intercepta las llamadas y devuelve lo que vos digas. Así probás los casos difíciles de producir con datos reales: el servidor lento, el que devuelve vacío, el que falla.

## Correrlos

**Desde el navegador**, que es lo cómodo mientras escribís: andá a `/web/tests`. Ahí tenés la lista, podés filtrar, correr uno solo y ver el DOM al momento del fallo.

**Desde la línea de comandos**, para integración continua:

```bash Terminal
odoo-bin -d taller --test-enable --test-tags /service_workshop --stop-after-init
```

Esto necesita **Chrome o Chromium instalado**: Odoo levanta un navegador sin interfaz para correrlos. Sin eso, los tests de cliente se saltean en silencio — y «se saltean en silencio» es la peor forma de que una prueba no te proteja. Verificá que de verdad corrieron mirando el log.

## Qué probar con cada cosa

| | Tour | HOOT |
|---|---|---|
| Qué cubre | el flujo completo | una pieza |
| Velocidad | lento | rápido |
| Dónde falla | difícil de ubicar | exacto |
| Necesita servidor | sí | no |
| Bueno para | el camino principal | los casos borde |

La combinación que funciona: **un tour del flujo principal** y **tests HOOT de las piezas con lógica**. El semáforo con cero días, con el límite justo, con el valor vacío — eso en HOOT, que son tres líneas cada uno.

> **Quedate con esto**
> Los tests van en `static/tests/` y en el bundle `web.assets_unit_tests`, separados del código. `defineModels` más `mountView` te dejan montar una vista real con datos falsos, sin servidor. `advanceTime` de `@odoo/hoot-mock` hace instantáneo cualquier test con temporizadores. Y si no hay Chrome instalado, los tests de cliente **se saltean sin avisar**: mirá el log para confirmar que corrieron.
