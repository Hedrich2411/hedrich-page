---
title: "Webhooks de Odoo que no pierden eventos"
description: "Cola, reintentos e idempotencia. Lo mínimo para que una caída del otro lado no te deje datos a medias."
date: 2026-08-20
course: odoo-integraciones
section: conectar
order: 1
tags: [odoo, python]
topic: ERP
goal: "Sabrás encolar los eventos de Odoo para que una caída del receptor no te deje datos a medias."
---

Un webhook que dispara directo desde el `write()` de un modelo es una bomba de tiempo: si el receptor está caído, el evento se perdió.

## Encolar primero, mandar después

El patrón es siempre el mismo: el evento se guarda en una tabla propia y un cron lo despacha. Odoo ya te da el cron.

## Idempotencia

Mandá un identificador único por evento y que el receptor lo descarte si ya lo procesó. Sin eso, el primer reintento te duplica un asiento contable, y eso no se arregla con un `DELETE`.
