---
title: "Llevarlo a un proyecto que ya existe"
description: Nadie arranca de cero. Cómo extraer el dominio de un proyecto en producción de a un flujo por vez, sin reescribir.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, refactor]
goal: Tener un plan de migración incremental que se pueda empezar el lunes.
course: clean-architecture-python
section: produccion
order: 5
---

El curso construyó todo desde cero, que es la situación menos común. Lo normal es un proyecto FastAPI o Django de tres años, con la lógica repartida entre endpoints, modelos y una carpeta `utils/`. Reescribirlo no es opción, y tampoco hace falta.

## Elegir dónde empezar

No todo el sistema merece capas. El catálogo de productos, la gestión de usuarios y la configuración probablemente son CRUD y pueden seguir así para siempre.

Empezá por donde se concentran los cambios. Git lo sabe:

```bash Terminal
git log --since="6 months ago" --name-only --format= -- "*.py" | sort | uniq -c | sort -rn | head
```

Los archivos que más cambiaron en seis meses son los que tienen el negocio que se mueve. Si además ahí están los bugs que se repiten, ese es el primer flujo.

## Paso 1: extraer las reglas, sin tocar nada más

Volvé al endpoint de [la primera lección](/blog/clean-architecture/por-que-clean-architecture). El primer paso no toca la base ni la API:

```python dominio/valores.py · Lo primero que sale
def ruc_valido(ruc: str) -> bool: ...
def calcular_igv(subtotal: Decimal) -> Decimal: ...
```

```python app/main.py · El endpoint, casi igual
@app.post("/facturas")
def crear_factura(datos: dict, db: Session = Depends(get_db)):
    if not ruc_valido(datos["ruc"]):
        raise HTTPException(422, "RUC inválido")
    subtotal = sum(Decimal(i["cantidad"]) * Decimal(i["precio"]) for i in datos["items"])
    igv = calcular_igv(subtotal)
    ...
```

Funciones puras con sus tests. El endpoint hace lo mismo que antes, pero la regla está en un solo lugar y probada, y de paso se fue el bug del `float`.

Este paso, aplicado a los flujos que más cambian, da más de la mitad del beneficio. Si el proyecto no necesita más, podés parar acá.

## Paso 2: la entidad

Cuando las funciones sueltas empiezan a recibir los mismos cinco argumentos, son un objeto. Ahí aparece `Comprobante` con `emitir()`, sus totales y sus transiciones. El endpoint construye la entidad y después la copia al modelo del ORM, como antes.

Todavía no hay repositorio, y está bien: el dominio ya no depende de nada y tiene tests.

## Paso 3: repositorio y caso de uso, para un flujo

Elegí **un** flujo, emitir, y hacé el recorrido completo: puerto, adaptador SQL, unidad de trabajo y caso de uso. El endpoint queda en dos líneas.

Las tablas no cambian. `ComprobanteFila` se puede declarar sobre la tabla que ya existe, y el mapeo absorbe los nombres viejos de las columnas. No hay migración de datos.

Los demás endpoints que leen o escriben facturas siguen usando el ORM directo y conviven con el nuevo. Un flujo migrado por vez, cada uno desplegado por separado.

## Paso 4: el linter, con excepciones

Prender import-linter en un proyecto existente da cuarenta violaciones el primer día. No las arregles todas: anotalas.

```toml pyproject.toml
[[tool.importlinter.contracts]]
name = "El centro no conoce frameworks"
type = "forbidden"
source_modules = ["facturacion.dominio", "facturacion.aplicacion"]
forbidden_modules = ["sqlalchemy", "fastapi", "pydantic", "httpx"]
ignore_imports = [
    "facturacion.dominio.cliente -> sqlalchemy",
]
```

```text Terminal
El centro no conoce frameworks KEPT (1 ignored import)
```

El contrato pasa y, desde ese momento, **no puede aparecer una violación nueva**. La lista de excepciones es la deuda, visible y versionada, y se achica cada vez que se migra un flujo.

Este paso no requiere tocar código, así que se puede hacer el primer día.

## Lo que no hay que hacer

**Crear todas las carpetas y los puertos primero.** Una estructura vacía con interfaces sin implementar no resuelve nada y parece progreso.

**Migrar el CRUD.** Si el endpoint de productos guarda lo que recibe, dejalo así. Un sistema puede tener un módulo con capas y diez sin ellas, y está bien.

**Una rama de «refactor de arquitectura» de tres meses.** No se mergea nunca. Cada paso de esta lección es un PR chico que se despliega solo.

**Copiar la estructura de este curso tal cual.** Lo que importa son las capas y la regla de dependencias. Si tu proyecto no habla con un servicio externo, no tiene `Pse`. Si tiene una sola entrada, el arranque pueden ser tres líneas en `main.py`.

## El orden, resumido

| Paso | Qué ganás | Riesgo |
|---|---|---|
| Reglas como funciones puras | Reglas testeadas y bugs de cálculo arreglados | Casi nulo |
| Entidad con sus reglas | Estados y validaciones en un lugar | Bajo |
| Repositorio y caso de uso, un flujo | Tests sin base y una segunda entrada posible | Medio, acotado a un flujo |
| import-linter con excepciones | La deuda deja de crecer | Nulo |

## Convencer al equipo

La parte técnica es la fácil. Lo difícil es que un equipo con entregas encima acepte cambiar cómo escribe código.

**No vendas «Clean Architecture».** Nadie aprueba una palabra. Vendé el problema que ya tienen: «el bug del IGV volvió tres veces este año» o «para probar un descuento hay que levantar la base». La arquitectura es la solución a eso, no el objetivo.

**Un ejemplo vale más que una presentación.** Migrá un flujo, el que más duele, y mostralo terminado: los tests que corren en milisegundos, el PR del cambio siguiente que tocó un solo archivo. Un flujo hecho es la plantilla que los demás copian.

**Medí antes y después.** Bugs reportados en ese flujo, tiempo de la suite de tests, cuántos archivos toca un cambio típico. Tres números en una tabla convencen más que cualquier diagrama.

**Escuchá las objeciones, que suelen tener razón.** «Son demasiados archivos para un CRUD» es correcto, y la respuesta es no aplicarlo al CRUD. «El mapeo es duplicación» es cierto en parte, y el costo está justificado solo donde hay reglas. Ceder donde la objeción es buena es lo que hace que el resto se acepte.

**Pragmatismo sobre pureza.** Un endpoint de lectura que usa el ORM directo no traiciona nada. La regla que no se negocia es una: las dependencias apuntan hacia el dominio. Lo demás se discute caso por caso.

> **Quedate con esto**
> No se reescribe: se extrae de a un flujo, empezando por donde más cambia el código. Las reglas como funciones puras dan la mitad del beneficio con casi nada de riesgo. Las tablas existentes no se tocan; el mapeo absorbe la diferencia. import-linter con `ignore_imports` congela la deuda desde el primer día. Y al equipo se lo convence con un flujo terminado y tres números, no con un diagrama.
