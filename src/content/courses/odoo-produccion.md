---
title: Odoo 19 a producción
description: Docker, Nginx, workers, backups y migraciones. Lo que hay entre un Odoo que corre en tu máquina y uno que aguanta usuarios reales.
kind: curso
level: Avanzado
topic: ERP
stack: [odoo, docker, nginx, postgresql]
sections:
  - id: despliegue
    title: Despliegue con Docker
  - id: nginx
    title: Nginx, proxy_mode y websockets
  - id: workers
    title: Workers, límites y PostgreSQL
  - id: hardening
    title: Hardening - list_db, admin_passwd y API keys
  - id: backups
    title: Backups, restore y filestore
  - id: actualizacion
    title: Actualizaciones y migración de versión
  - id: performance
    title: Profiler y optimización
updated: 2026-10-10
---

No depende de los otros dos: sirve igual escribas módulos o solo administres la instancia.
