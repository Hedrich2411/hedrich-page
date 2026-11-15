---
title: "Tours: probar flujos como un usuario"
description: El tipo de prueba que más valor da en Odoo, y que además sirve de onboarding.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript, testing]
goal: Una prueba que recorre la interfaz y falla si algo se rompe.
course: odoo-web-framework
section: tests
order: 1
---

Un tour es una secuencia de pasos que recorre la interfaz: clickear acá, escribir allá, verificar que apareció esto.

Y tiene una doble vida que lo hace especial: **el mismo tour sirve como prueba automatizada y como guía interactiva para el usuario**. Odoo los usa para las dos cosas.

## Un tour

```javascript service_workshop/static/src/js/tours/order_tour.js
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { stepUtils } from "@web_tour/tour_utils";

registry.category("web_tour.tours").add("service_workshop_tour", {
    url: "/odoo",
    steps: () => [
        ...stepUtils.goToAppSteps("service_workshop.menu_service_root", _t("Abrí el Taller.")),
        {
            trigger: "button.o_list_button_add",
            content: _t("Creá una orden nueva."),
            run: "click",
        },
        {
            trigger: "div[name='partner_id'] input",
            content: _t("Elegí el cliente."),
            run: "edit Textiles",
        },
        {
            trigger: ".o-autocomplete--dropdown-item:contains('Textiles')",
            run: "click",
        },
        {
            trigger: "button[name='action_diagnose']",
            content: _t("Pasala a diagnóstico."),
            run: "click",
        },
        {
            trigger: ".o_form_statusbar .o_arrow_button_current:contains('En diagnóstico')",
            content: _t("Listo: la orden quedó en diagnóstico."),
        },
    ],
});
```

```python __manifest__.py
"assets": {
    "web.assets_backend": ["service_workshop/static/src/**/*"],
    "web.assets_tests": ["service_workshop/static/src/js/tours/**/*"],
},
```

Ojo con ese segundo bundle: **los tours van en `web.assets_tests`**, no en el de backend.

## Los pasos

Cada paso es un objeto:

```javascript
{
    trigger: ".o_form_view button[name='action_deliver']",
    content: _t("Entregá el equipo."),
    tooltipPosition: "bottom",
    run: "click",
}
```

- **`trigger`** — un selector CSS. El tour **espera** a que exista antes de seguir.
- **`content`** — el texto del globo. Si lo omitís, el paso corre sin mostrar nada.
- **`run`** — qué hacer. Sin `run`, el paso solo **verifica** que el elemento apareció.

Esa última propiedad es la clave: **un paso sin `run` es una aserción**. El último paso del ejemplo no hace nada, solo comprueba que el estado llegó a «En diagnóstico». Si no llega, el tour falla.

### Las acciones de `run`

```javascript
run: "click"
run: "dblclick"
run: "edit Textiles"              // escribir en un input
run: "fill 42"                    // completar sin borrar
run: "clear"
run: "hover"
run: "press Enter"
run: async (helpers) => { ... }   // código propio
```

## Los selectores son lo difícil

Un tour se rompe cuando el selector deja de encontrar su elemento. La forma de que eso pase poco:

**Anclá en nombres de campo y de botón**, que son estables porque vienen de tu XML:

```javascript
trigger: "div[name='partner_id'] input"
trigger: "button[name='action_deliver']"
```

**Evitá clases de Bootstrap y estructura**:

```javascript Frágil
trigger: ".o_form_sheet > div:nth-child(2) .btn-primary"
```

**Usá `:contains()`** para desambiguar por texto visible. Odoo lo soporta aunque no sea CSS estándar.

Y si un elemento no tiene con qué identificarlo, **agregale un `name` en la vista**. Es la razón por la que la lección del formulario insistía con ponerle `name` a las pestañas.

## Correrlo

**Desde la interfaz**, con el modo desarrollador: en el menú del bicho, **«Iniciar tour»**, y elegís el tuyo. Lo ves correr paso a paso, lo cual es la mejor forma de depurarlo.

**Desde la línea de comandos**, que es como corre en integración continua:

```bash Terminal
odoo-bin -d taller -u service_workshop --test-tags /service_workshop:TestTaller --stop-after-init
```

Y la prueba de Python que lo dispara:

```python service_workshop/tests/test_tour.py
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestTaller(HttpCase):
    def test_tour_orden(self):
        self.start_tour("/odoo", "service_workshop_tour", login="admin")
```

`HttpCase` levanta un navegador sin interfaz y corre el tour de verdad. Si falla, el error te dice **en qué paso** y deja una captura.

El `@tagged("post_install", "-at_install")` es importante: el tour necesita que el módulo esté instalado del todo.

## Tours como onboarding

```javascript
registry.category("web_tour.tours").add("service_workshop_onboarding", {
    url: "/odoo",
    rainbowMan: true,
    rainbowManMessage: _t("¡Listo! Ya sabés registrar una orden."),
    steps: () => [ /* ... */ ],
});
```

Ese mismo mecanismo es el que te guía la primera vez que entrás a una aplicación de Odoo.

Es un argumento fuerte para escribirlos: **un tour de onboarding es, además, una prueba de regresión del flujo principal**. Dos cosas por el precio de una, y la que menos cuesta justificar ante quien paga.

## Por qué valen la pena

De todas las pruebas que podés escribir para un módulo de Odoo, los tours son las que más atrapan por línea escrita, porque **recorren todo**: el XML de las vistas, los permisos, los métodos de Python, el JavaScript, las plantillas.

Una prueba unitaria de un método verifica ese método. Un tour verifica que **el usuario puede hacer su trabajo**.

La contracara: son más lentos y, cuando fallan, cuesta más saber dónde. Por eso conviene tener **pocos tours del flujo principal** y pruebas más finas para los detalles.

> **Quedate con esto**
> Los tours van en `web.assets_tests`, no en el bundle de backend. Un paso **sin `run` es una aserción**: espera el selector y falla si no aparece. Anclá los selectores en `name` de campos y botones, nunca en estructura ni en clases de Bootstrap. Y el mismo tour sirve de prueba y de onboarding, que es el mejor argumento para escribirlo.
