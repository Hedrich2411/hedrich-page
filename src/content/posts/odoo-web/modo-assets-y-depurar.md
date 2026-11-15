---
title: "El modo assets y depurar sin minificar"
description: debug=assets, los source maps y el ciclo de trabajo que no te hace reiniciar a cada rato.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript, debug]
goal: Ver tu código tal como lo escribiste en las herramientas del navegador.
course: odoo-web-framework
section: assets
order: 4
---

Escribir JavaScript para Odoo sin esto es sufrir. Con esto es como trabajar en cualquier otra aplicación web.

## Los tres modos

```text
?debug=0        normal, bundle minificado
?debug=1        modo desarrollador, bundle minificado
?debug=assets   modo desarrollador + bundle sin minificar y con source maps
```

El primero es lo que ve un usuario. El segundo es el que usaste en el curso de backend: te da el menú del bicho, los nombres técnicos y Ajustes técnicos, pero el JavaScript sigue siendo una línea ilegible.

**Para escribir JavaScript querés el tercero.**

## Qué hace exactamente

Conviene saberlo porque hay una creencia muy extendida que es falsa:

**No sirve los archivos por separado.** Odoo sigue armando **un solo bundle**. Lo que cambia es que lo genera **sin minificar** y **con source maps**, y lo sirve con una URL marcada como `debug` en vez de la versionada por hash.

Esa distinción importa: si buscás tu `sla_light.js` en la lista de peticiones de red, **no lo vas a encontrar**, y eso no significa que no esté cargando. Está adentro del bundle.

Lo que sí podés hacer es abrir el bundle y leerlo, porque ya no está comprimido en una línea.

## Los source maps

Esta es la parte que cambia la experiencia. Con los source maps, el navegador reconstruye el mapeo entre el bundle y tus archivos originales.

En la pestaña de **Fuentes** de las herramientas del navegador, vas a ver tu módulo con su estructura de carpetas, tal como está en disco. Podés:

- abrir `sla_light.js` como lo escribiste,
- poner un breakpoint en una línea tuya,
- ver nombres de variables reales en vez de `a`, `b`, `c`,
- y leer tracebacks que apuntan a tu archivo y tu línea.

Sin esto, un error te dice «línea 1, columna 48213».

## El ciclo de trabajo

Este es el que te va a ahorrar horas:

1. Entrás con `?debug=assets` **una vez**. El modo queda en la sesión.
2. Editás tu archivo.
3. **Recargás el navegador.** No reinicies el servidor.
4. Repetís.

Mientras solo toques archivos de `static/`, **no hace falta reiniciar Odoo ni correr `-u`**. Odoo lee el archivo del disco cuando arma el bundle de debug.

Eso es lo contrario del Python, donde cada cambio exige reiniciar. Es la ventaja del frontend y conviene aprovecharla.

### Cuándo sí hace falta `-u`

- Agregaste un archivo **nuevo** y no estaba cubierto por un glob.
- Tocaste el **manifest**.
- Cambiaste una plantilla **QWeb del servidor** (las de los reportes y el portal, que viven en la base).

Las plantillas QWeb **del cliente** —las que vamos a escribir desde la próxima sección— van en el bundle y se recargan con el navegador. Es una de esas diferencias que confunden al principio.

## Cuando el bundle se queda pegado

Pasa. Cambiaste algo, recargaste, y sigue el código viejo.

En orden, de lo más barato a lo más bruto:

**Recarga forzada**: `Ctrl+Shift+R`. Salta el caché del navegador.

**Desactivar el caché**: en las herramientas del navegador, pestaña de Red, tildá «Deshabilitar caché». Mientras estén abiertas, no cachea nada. Si vas a trabajar un rato largo, dejalo así.

**Regenerar los assets**: menú del bicho → **Regenerar assets**. Borra los bundles guardados en la base y los arma de nuevo. Es lo que resuelve el 95% de los casos raros.

**Lo bruto**, cuando nada funciona:

```python odoo shell
env["ir.attachment"].search([("name", "like", "assets_")]).unlink()
env.cr.commit()
```

Borra todos los bundles cacheados. Odoo los rearma solo en la próxima petición.

## Leer un error del cliente

Un error de JavaScript en Odoo aparece en dos lugares, y conviene mirar los dos:

**El diálogo rojo** que ve el usuario. Dice poco, pero tiene un botón de detalles técnicos con el traceback.

**La consola del navegador.** Ahí está el error completo con el stack.

Con `?debug=assets`, ese stack apunta a tu archivo y tu línea. Sin él, al bundle minificado.

### Los errores más comunes al empezar

| Mensaje | Qué significa |
|---|---|
| `Failed to resolve module specifier "@web/..."` | falta el módulo en `depends`, o la ruta está mal |
| `X is not a function` | importaste algo que no existe o cambió de nombre |
| `Cannot read properties of undefined` | un servicio o props que esperabas no llegó |
| `Missing dependencies` | tu componente usa algo que no declaró |
| Nada, ni error ni efecto | el archivo no está en el bundle |

El último es el peor porque no deja rastro. La forma de descartarlo es un `console.log` al principio del archivo: si no aparece, el archivo no se está cargando y el problema es el manifest.

## Un atajo que conviene saberse

Las herramientas del navegador tienen **`Ctrl+P`** (o `Cmd+P`) para abrir un archivo por nombre, igual que en el editor. Escribís `sla_light` y te lo abre.

Con un proyecto de Odoo, donde hay miles de archivos cargados, es la diferencia entre encontrar el tuyo en dos segundos o en dos minutos.

> **Quedate con esto**
> `?debug=assets` no desconcatena nada: arma el mismo bundle sin minificar y con source maps, así que tu archivo no va a aparecer en la lista de peticiones de red y eso es normal. Mientras toques solo `static/`, recargar el navegador alcanza — nada de reiniciar el servidor. Y cuando el bundle se quede pegado, «Regenerar assets» del menú del bicho.
