---
title: "Para qué sirve Clean Architecture (y cuándo no)"
description: Una regla, cuatro capas y el problema concreto que resuelven. Sin diagramas de círculos de más.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Saber qué problema resuelve, cuál es la única regla que importa y cuándo no vale la pena.
course: clean-architecture-python
section: fundamentos
order: 1
---

Un sistema de facturación en FastAPI suele empezar así:

```python app/main.py · Todo junto
@app.post("/facturas")
def crear_factura(datos: dict, db: Session = Depends(get_db)):
    if len(datos["ruc"]) != 11:
        raise HTTPException(400, "RUC inválido")
    ultimo = db.query(func.max(Factura.correlativo)).scalar() or 0
    subtotal = sum(i["cantidad"] * i["precio"] for i in datos["items"])
    factura = Factura(correlativo=ultimo + 1, subtotal=subtotal, igv=round(subtotal * 0.18, 2))
    db.add(factura)
    db.commit()
    requests.post(PSE_URL, json=factura.to_dict())
    return factura
```

Funciona. Y tiene cinco problemas que vas a descubrir de a uno, en producción:

- **La regla del RUC vive en un endpoint.** Cuando agregues un import desde Excel, la vas a copiar. Cuando la corrijas, te vas a olvidar de una copia.
- **`max() + 1` con dos cajas a la vez** da dos facturas con el mismo número.
- **`float` para plata.** Con un valor de venta de S/ 10.25, `round(10.25 * 0.18, 2)` da `1.84`. El IGV correcto es `1.85`.
- **Si el PSE está caído, el request falla**, pero la factura ya se guardó. ¿Se mandó o no?
- **Para testear el cálculo del IGV necesitás una base de datos** y un servidor HTTP falso.

Ninguno es culpa de FastAPI ni de SQLAlchemy. Es que la regla de negocio está mezclada con todo lo demás, y no se puede razonar sobre ella por separado.

## La única regla

Clean Architecture se resume en una oración:

> **Las dependencias de código apuntan hacia adentro.** Lo de adentro no sabe que existe lo de afuera.

«Adentro» es lo que cambiaría si cambia el negocio. «Afuera», lo que cambiaría si cambia la tecnología.

| Capa | Qué tiene | En este curso | Puede importar |
|---|---|---|---|
| Dominio | Reglas del negocio | Un RUC tiene dígito verificador. Una factura exige RUC. | Solo la stdlib |
| Aplicación | Casos de uso | Emitir un comprobante. Enviar los pendientes. | Dominio |
| Adaptadores | Traducción con el mundo | Tablas de SQLAlchemy, la API, el cliente del PSE | Aplicación y dominio |
| Arranque | Armar todo | Leer el entorno, crear el engine | Todo |

El cálculo del IGV no importa `sqlalchemy`. El caso de uso «emitir» no importa `fastapi`. Cuando el caso de uso necesita guardar algo, declara **qué** necesita y alguien de afuera lo implementa. Eso es inversión de dependencias, y tiene [su propia lección](/blog/clean-architecture/depender-de-abstracciones).

Detrás de la regla hay cinco principios de diseño de clases, SOLID, que tienen una sección entera. Clean Architecture es esos mismos principios aplicados a la escala de un sistema completo.

## Qué ganás, concretamente

**Tests de reglas instantáneos.** Los 48 tests del dominio y de los casos de uso de este curso corren en menos de una décima de segundo, sin base de datos.

**Una segunda entrada sin duplicar.** El mismo caso de uso lo llama la API y lo llama un comando de consola. La regla vive en un lugar.

**Cambiar de proveedor sin tocar el negocio.** Si mañana cambiás de PSE, reescribís un archivo de 40 líneas.

**Leer el negocio sin leer infraestructura.** `dominio/comprobante.py` lo podría revisar un contador.

## Cuándo no

Tiene un costo: más archivos, mapeo entre entidades y filas, una indirección más. No lo pagues si:

- **Es un CRUD.** Si la lógica es guardar lo que llega y devolverlo, FastAPI con el ORM directo o el admin de Django son la respuesta correcta.
- **El framework es el producto.** Un módulo de Odoo vive dentro del ORM de Odoo; pelearte con eso es peor que aceptarlo. Lo mismo un proyecto Django que se apoya en el admin, los forms y los signals.
- **Es un prototipo.** Primero averiguá si el negocio existe.
- **Es un script.** Un ETL de 200 líneas no necesita puertos.

La señal para adoptarlo es otra: **reglas que cambian por razones de negocio y más de una forma de entrar al sistema**. La facturación electrónica tiene las dos.

Tampoco es todo o nada. Separar el dominio y testearlo solo ya da la mitad del beneficio. Las lecciones siguen el orden en que conviene adoptarlo.

## Lo que este curso no hace

No crea una interfaz por clase, ni un DTO por capa, ni una carpeta `interfaces/` con quince archivos vacíos. Cada abstracción está porque tiene dos implementaciones reales, la de producción y la de los tests, o porque protege una regla. Cuando una capa no aporta nada, se salta, y [la lección de lecturas](/blog/clean-architecture/lecturas) lo hace a propósito.

> **Quedate con esto**
> Clean Architecture es una regla: las dependencias apuntan hacia el negocio. Lo que ganás es testear y razonar sobre las reglas sin infraestructura, y reusar los casos de uso desde más de una entrada. Si tu sistema es un CRUD o vive dentro de un framework como Odoo, no lo necesitás.
