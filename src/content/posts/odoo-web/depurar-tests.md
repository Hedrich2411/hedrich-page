---
title: "Depurar tests y correrlos desde la interfaz"
description: Las herramientas que Odoo trae para que los tests de cliente no sean una caja negra.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript, testing]
goal: Encontrar por qué un test falla sin volverte loco.
course: odoo-web-framework
section: tests
order: 3
---

Un test que falla y no sabés por qué es peor que no tener el test: te hace perder tiempo y empuja a desactivarlo.

Esta última lección es sobre las herramientas para que eso no pase.

## La interfaz de HOOT

```text
http://localhost:8069/web/tests
```

Esa página es el mejor lugar para trabajar con tests de cliente. Te da:

- **La lista completa**, con lo que tarda cada uno.
- **Filtro por texto**, para correr solo lo que te interesa.
- **Correr uno solo**, haciendo clic en su nombre.
- **El DOM al momento del fallo**, que es lo que de verdad resuelve el problema.

Ese último punto es la diferencia con correrlos a ciegas: cuando una aserción falla, podés **inspeccionar el DOM que había** y ver que tu selector buscaba `.o_sla_light` y lo que se renderizó era `.o_field_widget`.

### Aislar un test

```javascript
test.only("el que estoy depurando", async () => { /* ... */ });
```

`test.only` corre **solo ese**. Mientras depurás, es lo que querés: los demás ensucian la salida y tardan.

**Acordate de sacarlo.** Un `test.only` olvidado hace que integración continua corra un test y declare todo verde. Conviene que el linter lo marque.

Y el inverso:

```javascript
test.skip("este todavía no", async () => { /* ... */ });
```

Mejor que comentarlo: queda listado como salteado en vez de desaparecer.

## Breakpoints en un test

```javascript
test("el semáforo pinta de rojo", async () => {
    await mountView({ /* ... */ });
    debugger;
    expect(queryFirst(".o_sla_light")).toHaveClass("o_sla_late");
});
```

Con las herramientas del navegador abiertas en `/web/tests`, el `debugger` para la ejecución ahí. A partir de ese punto podés inspeccionar el DOM, ejecutar selectores en la consola y ver qué recibió el componente.

Es la misma técnica de la lección de depuración, aplicada a un test.

## Los fallos intermitentes

Un test que pasa a veces es la peor clase de test: nadie confía en él y termina desactivado. En Odoo casi siempre son una de estas tres causas.

**No esperaste a que algo terminara.**

```javascript Mal
click(".o_list_button_add");
expect(".o_form_view").toHaveCount(1);
```

```javascript Bien
await click(".o_list_button_add");
expect(".o_form_view").toHaveCount(1);
```

El render de OWL es asíncrono, como vimos en la lección de estado. Sin el `await`, la aserción corre antes de que el DOM se haya actualizado. En una máquina rápida pasa; en integración continua, no.

**Dependés del reloj real.**

```javascript Mal
await new Promise((r) => setTimeout(r, 1000));
```

```javascript Bien
import { advanceTime } from "@odoo/hoot-mock";
await advanceTime(1000);
```

Esperar de verdad es lento y además frágil: si la máquina está cargada, mil milisegundos no alcanzan.

**Dependés de la fecha de hoy.** Un test que calcula días en taller va a fallar el día que cambie el mes, o según la zona horaria:

```javascript
import { mockDate } from "@odoo/hoot-mock";

test("cuenta los días desde el ingreso", async () => {
    mockDate("2026-10-11 12:00:00");
    // ahora "hoy" es siempre ese día
});
```

**Fijá la fecha siempre que el test dependa de ella.** Es la causa de la mitad de los fallos que aparecen «solos» un lunes a la mañana.

## Cuando los tests no corren

El síntoma más engañoso: todo pasa, pero porque **no corrió nada**.

```bash Terminal
odoo-bin -d taller --test-enable --test-tags /service_workshop --stop-after-init
```

Mirá el log y buscá cuántos tests se ejecutaron. Si los de cliente dan cero:

**¿Está Chrome instalado?** Odoo necesita Chrome o Chromium para los tests de navegador. Sin él, los saltea y lo dice en una línea del log que es fácil pasar por alto.

**¿Está el bundle bien?** Los tests van en `web.assets_unit_tests`. Si los pusiste en el de backend, HOOT no los ve.

**¿Las etiquetas coinciden?** `--test-tags /service_workshop` corre los de ese módulo. Un error de tipeo ahí no da error: simplemente no corre nada.

## Depurar un tour que falla

Los tours fallan distinto. El mensaje te dice el paso:

```text
Tour service_workshop_tour failed at step 4: trigger not found
Trigger: button[name='action_diagnose']
```

En orden, qué mirar:

**El selector.** Abrí la pantalla a mano, inspeccioná el elemento y comprobá que el selector lo encuentra. En la consola: `document.querySelectorAll("button[name='action_diagnose']")`.

**El estado previo.** El paso 4 falla, pero puede ser que el 3 dejara la pantalla en otro lado. Corré el tour desde la interfaz —menú del bicho, «Iniciar tour»— y mirá dónde se desvía.

**Algo que tapa.** Un diálogo abierto, una notificación encima del botón. El tour no puede clickear lo que está tapado.

**Los datos.** Un tour que busca «Textiles» necesita que ese cliente exista. Si depende de datos, que los cree el propio tour o que vengan de los datos de demostración del módulo.

## Una estrategia que funciona

Para un módulo como el taller:

**Un tour** del flujo principal: crear orden → diagnosticar → reparar → entregar. Si eso se rompe, el módulo no sirve.

**Tests HOOT** de las piezas con lógica: el semáforo en sus tres niveles y con valores raros.

**Tests de Python** de las reglas de negocio, que son los del curso de backend.

No busques cobertura total. Buscá que **lo que no puede romperse, no se rompa en silencio**.

## Fin del curso

Recorriste el cliente web de Odoo completo: cómo carga el JavaScript, componentes OWL con estado y ciclo de vida, plantillas QWeb heredables, widgets de campo, vistas propias, los servicios de la infraestructura, y cómo probar todo eso.

Y el módulo del taller tiene ahora su semáforo de SLA, su botón propio en la lista y su tablero de carga — las tres cosas que en el curso de backend no se podían hacer.

Si te toca que esto corra para usuarios reales, el curso que sigue es **Odoo 19 a producción**: Docker, Nginx, workers, backups y migraciones.

> **Quedate con esto**
> `/web/tests` te deja correr un test solo y ver el DOM al momento del fallo, que es lo que de verdad resuelve el problema. Los fallos intermitentes son casi siempre un `await` que falta, una espera real en vez de `advanceTime`, o un test que depende de la fecha de hoy. Y si los tests de cliente dan cero, revisá que Chrome esté instalado: Odoo los saltea sin hacer ruido.
