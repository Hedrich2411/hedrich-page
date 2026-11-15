---
title: "MVC, microservicios y serverless"
description: Tres formas de repartir una aplicación, cuándo conviene cada una, y una función serverless real que calcula el IGV de un pedido. Con una pasada por eventos, CQRS y Clean Architecture.
date: 2026-10-19
topic: Backend
tags: [python, patrones, arquitectura]
goal: Elegir cómo repartir una aplicación según su tamaño, su equipo y su carga, sin adoptar complejidad que no hace falta.
course: patrones-python
section: arquitectura
order: 1
---

Los patrones de las secciones anteriores ordenan clases y funciones. Los de arquitectura ordenan la aplicación entera: dónde vive cada responsabilidad y cómo se despliega.

## MVC: separar datos, pantalla y control

**Model-View-Controller** divide una aplicación en tres partes:

- **Modelo**: los datos y las reglas. Un pedido sabe calcular su total.
- **Vista**: cómo se muestra. Una plantilla HTML, un JSON.
- **Controlador**: recibe la petición, le pide al modelo lo necesario y elige la vista.

Ningún framework de Python lo nombra igual, pero todos lo aplican:

| | Modelo | Vista | Controlador |
|---|---|---|---|
| Django | `models.py` | Plantillas | `views.py`, que en Django se llama «vista» |
| FastAPI | Modelos de SQLAlchemy y Pydantic | La respuesta JSON | La función de la ruta |
| Odoo | `models/` | Vistas XML | `controllers/` y los métodos de botón |

La regla que más se rompe: **la lógica de negocio va en el modelo**, no en el controlador. Una ruta de 80 líneas que calcula descuentos e impuestos es un controlador gordo, y esa lógica no se puede reusar desde un comando o una tarea. El curso de [Clean Architecture](/blog/clean-architecture/por-que-clean-architecture) lleva esta misma idea más lejos.

## Microservicios: repartir en procesos

Un **monolito** es una aplicación que se despliega entera. Los **microservicios** la reparten en servicios chicos, cada uno con su base de datos, que se hablan por la red.

Lo que ganás:

- Equipos que despliegan sin coordinarse con los demás.
- Escalar solo lo que tiene carga: el catálogo recibe cien veces más visitas que la facturación.
- Una falla en un servicio no tumba todo, si está bien diseñado.

Lo que pagás:

- **Cada llamada puede fallar.** Una función que antes era una llamada en memoria ahora puede tardar, cortarse o devolver error. Por eso existen [reintentos y circuit breakers](/blog/patrones/retry-y-circuit-breaker).
- **No hay transacciones entre servicios.** Descontar stock en un servicio y cobrar en otro ya no es un `COMMIT`.
- **Operar es más caro**: despliegue, logs y trazas repartidos en diez procesos.

Para un equipo de una a cinco personas, un monolito bien ordenado en módulos casi siempre gana. Se separa un servicio cuando una parte tiene **otra carga, otro ritmo de cambios u otro equipo**, no antes. Si los módulos del monolito ya tienen fronteras claras, como los [contextos delimitados](/blog/clean-architecture/contextos-delimitados), separarlos después es mover código, no reescribirlo.

## Serverless: funciones que despliega otro

En **serverless**, como AWS Lambda o Azure Functions, subís una función y la plataforma la ejecuta cuando llega un evento: una petición HTTP, un archivo nuevo en un bucket, un mensaje en una cola. No hay servidor que mantener, escala solo, y se paga por ejecución.

Una función que calcula el IGV de un pedido, con la firma de AWS Lambda detrás de API Gateway:

```python funcion.py
TASA_IGV = Decimal("0.18")


def calcular(items: list[dict[str, str]]) -> dict[str, str]:
    subtotal = sum((Decimal(i["cantidad"]) * Decimal(i["precio"]) for i in items), Decimal(0))
    igv = (subtotal * TASA_IGV).quantize(Decimal("0.01"))
    return {"subtotal": f"{subtotal:.2f}", "igv": f"{igv:.2f}", "total": f"{subtotal + igv:.2f}"}


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    cuerpo = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        cuerpo = base64.b64decode(cuerpo).decode()
    try:
        items = json.loads(cuerpo)["items"]
        resultado = calcular(items)
    except (KeyError, ValueError, ArithmeticError) as e:
        return {"statusCode": 400, "body": json.dumps({"error": f"pedido inválido: {e}"})}
    return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": json.dumps(resultado)}
```

```text Terminal
{'statusCode': 200, 'headers': {'content-type': 'application/json'}, 'body': '{"subtotal": "71.00", "igv": "12.78", "total": "83.78"}'}
{'statusCode': 400, 'body': '{"error": "pedido inv\\u00e1lido: \'items\'"}'}
```

Dos cosas que muestra el ejemplo:

- **La lógica está fuera del `handler`.** `calcular` no sabe nada de Lambda, y se prueba con un `assert`. El `handler` solo traduce el evento de la plataforma. Si mañana la función se muda a FastAPI, `calcular` viaja tal cual.
- **El cuerpo puede llegar en base64**, según cómo esté configurado API Gateway. Es el tipo de detalle de plataforma que conviene aislar en el `handler`.

Conviene para cargas esporádicas o con picos: un webhook, procesar archivos subidos, una tarea nocturna. No conviene para procesos largos, porque hay un límite de ejecución, ni para tráfico constante, donde un servidor sale más barato. Y el **arranque en frío**: la primera invocación después de un rato inactiva carga Python y las dependencias, y puede tardar cientos de milisegundos o más.

## Otros que conviene ubicar

- **Arquitectura dirigida por eventos**: los servicios no se llaman entre sí; publican eventos en un bus, como Kafka o RabbitMQ, y quien quiera se suscribe. Es [Observer](/blog/patrones/observer) entre procesos.
- **CQRS**: separar el modelo que escribe del que lee. Las escrituras validan reglas; las lecturas van a tablas o vistas armadas para cada pantalla. Lo viste en [lecturas](/blog/clean-architecture/lecturas).
- **Clean Architecture**: el dominio en el centro, sin depender de frameworks ni de la base. Tiene su [propio curso](/blog/clean-architecture/por-que-clean-architecture).
- **Event Sourcing**: guardar los hechos en lugar del estado. Es la [lección siguiente](/blog/patrones/event-sourcing).

> **Quedate con esto**
> MVC separa datos, pantalla y control, y la regla clave es que el negocio vive en el modelo. Los microservicios cambian llamadas en memoria por llamadas de red que fallan y transacciones que ya no existen: separá un servicio cuando tenga otra carga, otro ritmo u otro equipo. En serverless, mantené la lógica fuera del `handler` para que no dependa de la plataforma.
