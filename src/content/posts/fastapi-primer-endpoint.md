---
title: "Tu primer endpoint, pero bien"
description: "Un endpoint de FastAPI con tipos, validación y respuesta tipada desde la primera línea."
date: 2026-09-01
course: apis-fastapi
section: base
order: 1
tags: [python, fastapi]
topic: Backend
goal: "Sabrás definir un contrato de respuesta explícito para que tu API sea más fácil de entender y mantener."
---

Un endpoint que funciona y un endpoint que vas a poder mantener se escriben distinto desde el minuto uno.

## El que casi todos escriben primero

La tentación es devolver un diccionario y seguir. Funciona, y en tres semanas nadie sabe qué campos tiene esa respuesta.

```python main.py · Sin contrato explícito
@app.get("/usuarios/{id}")
def obtener(id: int):
    return {"id": id, "nombre": "Ana"}
```

## El que conviene escribir

Declarar la respuesta con un modelo cuesta cuatro líneas más y te da documentación, validación de salida y autocompletado en el cliente.

```python main.py · Respuesta tipada
class Usuario(BaseModel):
    id: int
    nombre: str

@app.get("/usuarios/{id}", response_model=Usuario)
def obtener(id: int) -> Usuario:
    return Usuario(id=id, nombre="Ana")
```

La diferencia se nota cuando alguien cambia el modelo: el primero sigue devolviendo lo que sea, el segundo falla en el momento correcto.

> **Quédate con esto**
> Tu respuesta también es un contrato. Definirla explícitamente hace visibles los cambios y evita sorpresas.
