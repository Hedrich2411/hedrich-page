# Contexto del proyecto

Resumen para retomar el trabajo en otra sesión. Estado al 15/11/2026.

## Qué es

hedrich.dev: portafolio, servicios y blog con cursos. Astro 7 con el adaptador de Node, Tailwind 4 y GSAP para las animaciones. Un solo tema claro. Se gestiona con pnpm.

```text
pnpm astro check        # tipos: tiene que dar 0 errores
pnpm build              # build de producción en dist/
astro dev --background  # servidor de desarrollo; astro dev stop|status|logs
```

## Estructura

- `src/content.config.ts`: dos colecciones. `posts`, con todos los artículos y lecciones, y `courses`, que es un orden de lectura sobre los posts agrupado en secciones.
- `src/content/posts/<curso>/<slug>.md` se publica en `/blog/<curso>/<slug>`.
- `src/content/courses/<id>.md`: título, nivel, `stack`, `sections[{id, title}]`.
- `src/components/<area>/`: un `.astro` por bloque visual, con áreas `home`, `blog`, `projects`, `services`, `contact` y `shared`.
- `src/lib/`: la lógica en TypeScript, fuera de los componentes.
- `src/lib/technologies.ts`: los íconos y nombres de cada valor que aparece en `stack`. Si un curso usa una tecnología nueva, va acá.

## Cursos

| Curso | Lecciones |
|---|---|
| `odoo-backend-framework`: Odoo 19 Backend Framework | 34 |
| `odoo-web-framework`: Odoo 19 Web Framework | 28 |
| `odoo-produccion`: Odoo 19 a producción | 15 |
| `clean-architecture-python`: Clean Architecture con Python | 28 |
| `linux-administracion`: Administración de Linux | 46 |
| `patrones-python`: Patrones de diseño en Python | 24 |

Además hay un post suelto, `uv-python.md`.

## Cómo se escribe una lección

Frontmatter:

```yaml
title: "Título"
description: Una o dos oraciones.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Lo que el lector se lleva.
course: patrones-python
section: comportamiento
order: 2
```

- `order` se cuenta **dentro de cada sección** y no se repite.
- Todo valor que contenga `": "` va entre comillas, o el YAML se rompe.
- Bloques de código con etiqueta: ` ```python ruta/archivo.py ` para código y ` ```text Terminal ` para salidas. Se puede agregar una nota con `·`, por ejemplo ` ```text Terminal · 25 llamadas `.
- Enlaces internos: `/blog/<curso>/<slug>`.
- Cada lección cierra con un callout `> **Quedate con esto**`.
- Español con voseo rioplatense.
- Un escenario real por lección: facturación, pedidos, pagos, APIs externas. Nada de `Foo` ni `Bar`.
- **Las salidas se copian de ejecutar el código de verdad.** Nunca se inventan.
- Un curso basado en un libro cubre **todos** los temas del libro, en lecciones cortas, de entre 80 y 120 líneas.

Antes de terminar un curso, conviene validar el frontmatter con un parser de YAML, comprobar que cada enlace `/blog/...` apunte a un archivo existente y que no haya `order` repetidos por sección, y después correr `astro check` y `build`.

## Reglas de trabajo

- **Componibilizar**: archivos cortos, la lógica en `src/lib` y un componente por bloque visual.
- **Comentarios mínimos**: solo el porqué de algo contraintuitivo, en una línea.
- **No levantar el navegador para verificar cada cambio**; solo cuando se pida. Para medir responsive o animaciones, Edge headless con DevTools Protocol, porque las capturas simples engañan.
- **Nunca cerrar Edge por nombre de proceso**: se cierra solo el proceso headless propio, por PID.
- **No usar el servidor Odoo ni las bases locales del usuario** para pruebas o capturas. Se levanta uno propio en Docker y se borra al terminar.
- `.env` nunca se commitea; solo `.env.example`. Las variables SMTP no llevan prefijo `PUBLIC_`.
- Los commits van **sin** línea `Co-Authored-By`.

## Cambios recientes

- **Transiciones entre lecciones de un curso.** Al pasar de una lección a otra se anima solo el contenido, no toda la página.
  - `Reveal.astro` marca como ya mostrados los elementos con `data-reveal-key` que existían en la página anterior.
  - `CourseAside.astro` usa `data-reveal-key={`curso:${id}`}`.
  - `src/lib/indice-del-curso.ts` conserva el scroll del índice del curso y centra la lección actual.
  - Falta revisarlo en el navegador.
- **Clean Architecture** se amplió a 28 lecciones, con SOLID completo.
- **Linux** tiene 46 lecciones en 13 secciones, verificadas en un laboratorio con Docker.
- **Patrones de diseño** tiene 24 lecciones en 9 secciones, todas con salidas reales de Python 3.13.

El código de ejemplo con el que se verificaron los cursos de Clean Architecture, Linux y patrones quedó en una carpeta temporal fuera del repo. Si hace falta volver a verificar algo, se rearma desde el código de las lecciones.
