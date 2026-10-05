---
title: "Empaquetarla en Docker sin sorpresas"
description: "Una imagen que pesa poco, arranca rápido y no corre como root."
date: 2026-09-06
course: apis-fastapi
section: produccion
order: 1
tags: [docker, python]
topic: Backend
goal: "Sabrás construir una imagen chica, que arranca rápido y no corre como root."
---

La imagen que sale del primer `Dockerfile` de un tutorial pesa 1.2 GB y corre como root. Ninguna de las dos cosas hace falta.

## Multi-stage

Compilar dependencias en una etapa y copiar solo lo instalado a la final baja la imagen a la mitad larga.

```dockerfile
FROM python:3.12-slim AS build
COPY requirements.txt .
RUN pip install --user -r requirements.txt

FROM python:3.12-slim
COPY --from=build /root/.local /home/app/.local
USER app
```

## Lo que casi siempre falta

Un `HEALTHCHECK`. Sin eso, el orquestador cree que el contenedor está sano mientras la app devuelve 500 a todo el mundo.
