---
title: "Cuándo Astro y cuándo Next"
description: "Dos años usando los dos en producción. La decisión es más simple de lo que parece."
date: 2026-07-14
tags: [astro, nextdotjs]
topic: Frontend
---

La respuesta corta: si la página se puede generar antes de que alguien la pida, Astro. Si depende de quién la pide, Next.

## Lo que decide de verdad

No es el framework, es cuántas de tus páginas cambian por usuario. Un portfolio, una documentación o un blog cambian para todos a la vez: eso es HTML estático y no necesita hidratación.

Un panel con sesión, permisos y datos en vivo es lo contrario.

## El error caro

Elegir Next por si acaso y terminar sirviendo un bundle de React para mostrar texto que no cambia nunca.
