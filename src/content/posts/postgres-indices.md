---
title: "El índice que te falta casi siempre"
description: "Por qué tu consulta filtra rápido y ordena lento, y cómo verlo en el plan de ejecución."
date: 2026-06-02
tags: [python]
topic: Bases de datos
---

`EXPLAIN ANALYZE` es la herramienta más subestimada del stack. La mayoría de las consultas lentas que arreglé tenían un índice que servía para el `WHERE` pero no para el `ORDER BY`.

## El síntoma

El plan muestra un `Sort` costoso después de un `Index Scan` barato. La base encontró las filas rápido y después las ordenó en memoria.

## El arreglo

Un índice compuesto que incluya la columna de orden, en el mismo sentido en que ordenás. La base lee las filas ya ordenadas y el `Sort` desaparece del plan.
