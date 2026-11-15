---
title: "Cómo carga Odoo el JavaScript: los bundles"
description: Assets bundles, el manifest y el orden de carga. La pieza que explica por qué tu JS no aparece.
date: 2026-10-11
topic: ERP
tags: [odoo, javascript, assets]
goal: Entender qué es un bundle, cuáles existen y por qué tu archivo no se carga.
course: odoo-web-framework
section: assets
order: 1
---

El cliente web de Odoo es una aplicación de JavaScript enorme. Si cada módulo instalado sirviera sus archivos sueltos, una instancia con cuarenta módulos pediría cientos de archivos en cada carga.

Por eso Odoo los agrupa en **bundles**: paquetes que se concatenan, se minifican y se sirven como un solo archivo con caché agresiva.

Entender eso es lo que explica el 90% de los «no me carga el JavaScript».

## Qué es un bundle

Un bundle es **una lista ordenada de archivos** que Odoo junta en uno solo. Hay bundles distintos porque no todas las páginas necesitan lo mismo: el cliente web interno carga uno, el sitio público otro, los tests otro.

Los que te importan:

| Bundle | Dónde se usa |
|---|---|
| `web.assets_backend` | el cliente web interno, el que usan tus usuarios |
| `web.assets_frontend` | el sitio web y el portal, sin login |
| `web.assets_web_dark` | las variantes de estilo para el modo oscuro |
| `web.assets_tests` | los tours |
| `web.assets_unit_tests` | los tests HOOT |

Para este curso, casi todo va en **`web.assets_backend`**. El portal del curso anterior usaba `web.assets_frontend`, aunque lo hicimos sin JavaScript.

## Declararlo en el manifest

```python __manifest__.py
{
    "name": "Taller de servicio técnico",
    ...
    "assets": {
        "web.assets_backend": [
            "service_workshop/static/src/scss/workshop.scss",
            "service_workshop/static/src/fields/sla_light/*",
        ],
    },
}
```

Tres cosas de esa declaración.

**La ruta empieza con el nombre del módulo**, no con `static/`. Es `service_workshop/static/src/...`, aunque estés escribiendo el manifest de ese mismo módulo. Es el error de tipeo más común de la sección.

**Acepta globs.** `*` toma los archivos de una carpeta, `**/*` baja por todo el árbol. Los módulos del core los usan en todos lados:

```python
"account/static/src/components/**/*",
"account/static/src/services/*.js",
```

Conviene usarlos: así agregar un archivo nuevo a una carpeta ya declarada no exige tocar el manifest ni actualizar el módulo.

**El orden importa.** Los archivos se concatenan en el orden de la lista, y las listas de los módulos se concatenan en el orden de instalación, que respeta las dependencias. Si tu archivo necesita algo de otro módulo, ese módulo va en `depends`.

### Operaciones sobre el bundle

A veces no alcanza con agregar al final:

```python
"assets": {
    "web.assets_backend": [
        ("prepend", "service_workshop/static/src/scss/variables.scss"),
        ("after", "web/static/src/views/list/list_renderer.js",
                  "service_workshop/static/src/views/my_list.js"),
        ("remove", "web/static/src/some_file.js"),
        ("replace", "web/static/src/otro.js", "service_workshop/static/src/mio.js"),
    ],
}
```

- **`prepend`** — al principio del bundle. Para variables de SCSS, que tienen que estar antes de quien las usa.
- **`after`** / **`before`** — relativo a otro archivo.
- **`remove`** — saca un archivo del bundle. Es la más usada del core, con diferencia.
- **`replace`** — lo reemplaza por el tuyo.

`remove` y `replace` son armas cargadas: estás modificando lo que ven **todos los módulos**, no solo el tuyo. Usalas cuando no haya otra.

## El ciclo de vida de un bundle

Esto es lo que hay que tener claro para no perder tiempo:

1. Odoo arma el bundle la primera vez que alguien lo pide.
2. Lo guarda como un adjunto en la base de datos.
3. Le pone una URL con un hash.
4. A partir de ahí, lo sirve desde ahí sin volver a armarlo.

**Por eso tu cambio no aparece.** El bundle guardado sigue teniendo tu versión vieja.

En desarrollo se resuelve de dos formas, y conviene conocer las dos:

**Con `?debug=assets`** en la URL, Odoo arma el bundle **sin minificar y con source maps**, y lo sirve con una URL marcada como `debug` en vez de la versionada. Sigue siendo un solo archivo —eso no cambia—, pero tu código se lee tal como lo escribiste y el navegador puede ubicarte en tu archivo original. Es lo que vas a usar mientras escribís, y lo vemos en detalle en la lección 4.

**Regenerando los assets**: con el modo desarrollador, en el menú del bicho, **«Regenerar assets»**. Borra los adjuntos guardados y obliga a Odoo a armarlos de nuevo.

## Por qué tu archivo no se carga

La lista de sospechosos, en el orden en que conviene revisarla:

| Síntoma | Causa probable |
|---|---|
| No pasa absolutamente nada | el archivo no está en el manifest, o la ruta no empieza con el nombre del módulo |
| Lo agregué al manifest y nada | falta `-u` del módulo |
| Corrí `-u` y nada | el bundle está cacheado: probá con `?debug=assets` |
| Da error de import | el módulo que exporta eso no está en `depends` |
| Anda en backend pero no en el portal | lo pusiste en el bundle equivocado |
| Anda para vos, no para otros | lo pusiste en `web.assets_tests` |

Las dos primeras cubren la mayoría.

## Dónde van los archivos

La convención del core, que conviene seguir:

```text service_workshop/static/
static/
├── description/
│   └── icon.png
└── src/
    ├── scss/            estilos
    ├── fields/          widgets de campo
    │   └── sla_light/
    │       ├── sla_light.js
    │       ├── sla_light.xml
    │       └── sla_light.scss
    ├── views/           vistas propias
    ├── components/      componentes sueltos
    ├── services/        servicios
    └── js/tours/        tours
```

Fijate el patrón de `fields/sla_light/`: **una carpeta por componente, con su JS, su plantilla y su SCSS juntos**. Es lo que hace Odoo y hace que un `**/*` en el manifest cubra todo sin pensar.

Todo lo que esté bajo `static/` **se sirve públicamente**, con o sin bundle. No pongas ahí nada que no quieras que cualquiera descargue.

> **Quedate con esto**
> La ruta en el manifest empieza con el nombre de tu módulo, no con `static/`. Los bundles se guardan cacheados en la base, así que un cambio que «no aparece» casi siempre es eso: probá con `?debug=assets` antes de buscar el error en tu código. Y usá globs con una carpeta por componente, para no volver a tocar el manifest.
