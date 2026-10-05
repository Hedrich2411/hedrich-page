---
title: "Validación que explica qué está mal"
description: "Mensajes de error que le sirven a quien consume la API, no solo al que la escribió."
date: 2026-09-03
course: apis-fastapi
section: base
order: 2
tags: [python, fastapi]
topic: Backend
goal: "Sabrás devolver errores que le dicen a quien consume la API qué campo falló y por qué."
---

Pydantic valida solo. Lo que no hace solo es explicar bien el error.

## El mensaje por defecto

`value is not a valid integer` es correcto y es inútil para quien está integrando tu API a las dos de la mañana.

## Mensajes con contexto

Cada validador acepta un mensaje propio. Vale la pena escribirlos: son la única documentación que alguien lee cuando algo falla.

```python
cantidad: int = Field(gt=0, description="Unidades a despachar, mayor que cero")
```

Y si el error cruza varios campos, un `model_validator` te deja explicar la regla completa en vez de tres errores sueltos que no se entienden juntos.
