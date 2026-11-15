---
title: "Observabilidad: saber qué pasó con F001-42"
description: Logs estructurados en JSON, un identificador que acompaña cada operación desde la API hasta el PSE, y qué capa registra qué.
date: 2026-10-19
topic: Backend
tags: [python, logging, observabilidad]
goal: Poder reconstruir qué pasó con un comprobante a partir de los logs, sin atar el negocio a una biblioteca.
course: clean-architecture-python
section: produccion
order: 3
---

Un martes, el cliente llama: su factura F001-42 «no llegó». ¿Se emitió? ¿Se mandó? ¿Qué respondió SUNAT? ¿Fue en la corrida de las 10:05 o en la de las 10:10?

Con logs de texto libre, eso es un `grep` y adivinar. Con logs estructurados, una consulta.

## Quién registra qué

| Capa | Registra | Ejemplo |
|---|---|---|
| Dominio | Nada | Sin I/O, ni siquiera logs |
| Aplicación | Hechos del negocio | «F001-42 emitido por S/ 2,360.00», «PSE no disponible» |
| Adaptadores | Lo técnico | Un reintento, una consulta lenta |
| Entradas | Nada propio; **configuran** el formato | `configurar_logs()` en `cli.py` y `web.py` |

El dominio no loguea porque loguear es I/O, y la [función de fitness](/blog/clean-architecture/proteger-la-arquitectura) lo vigila: un `print` en `dominio/` rompe el build. Si una regla necesita dejar rastro, el caso de uso lo registra al ver el resultado.

La aplicación usa solo `logging` de la biblioteca estándar. Nada de `structlog` ni de un SDK de proveedor importado en un caso de uso: **el formato lo decide el borde**.

## Campos, no frases

```python aplicacion/emitir.py · Un hecho con datos
        log.info(
            "%s emitido por S/ %s",
            comprobante.numero,
            comprobante.total,
            extra={"comprobante": str(comprobante.numero), "total": comprobante.total},
        )
```

El mensaje es para personas; `extra` es para máquinas. Un formateador de texto común ignora `extra` y no se rompe nada.

## El formato, en el borde

```python adaptadores/observabilidad.py
id_operacion: ContextVar[str] = ContextVar("id_operacion", default="-")

_ATRIBUTOS_DE_LOGGING = set(vars(logging.makeLogRecord({}))) | {"message", "asctime", "id_operacion"}


class ConIdDeOperacion(logging.Filter):
    def filter(self, registro: logging.LogRecord) -> bool:
        registro.id_operacion = id_operacion.get()
        return True


class FormatoJson(logging.Formatter):
    def format(self, registro: logging.LogRecord) -> str:
        datos = {
            "momento": self.formatTime(registro, "%Y-%m-%dT%H:%M:%S%z"),
            "nivel": registro.levelname,
            "origen": registro.name,
            "operacion": getattr(registro, "id_operacion", "-"),
            "mensaje": registro.getMessage(),
        }
        datos |= {k: v for k, v in vars(registro).items() if k not in _ATRIBUTOS_DE_LOGGING}
        if registro.exc_info:
            datos["error"] = self.formatException(registro.exc_info)
        return json.dumps(datos, ensure_ascii=False, default=str)


def configurar_logs(nivel: int = logging.INFO) -> None:
    manejador = logging.StreamHandler()
    manejador.addFilter(ConIdDeOperacion())
    manejador.setFormatter(FormatoJson())
    logging.basicConfig(level=nivel, handlers=[manejador], force=True)
```

`_ATRIBUTOS_DE_LOGGING` son los atributos que todo `LogRecord` trae de fábrica; lo que no está ahí vino por `extra`. `default=str` porque `json` no sabe serializar `Decimal`. Una línea real:

```json Una línea del log
{"momento": "2026-10-19T03:36:51-0500", "nivel": "INFO", "origen": "facturacion.aplicacion.emitir", "operacion": "importar-e1e95b98", "mensaje": "B001-1 emitido por S/ 83.78", "comprobante": "B001-1", "total": "83.78"}
```

## Un identificador por operación

`operacion` agrupa todo lo que pasó en un mismo request o en una misma corrida del cron. Es una `ContextVar`: cada request y cada thread ve la suya, sin pasarla como parámetro por todas las capas.

En la API la pone un middleware:

```python adaptadores/api.py · El middleware
    @app.middleware("http")
    async def con_id_de_operacion(request: Request, siguiente: Callable[[Request], Awaitable[Response]]) -> Response:
        recibido = request.headers.get("x-request-id", "")
        valor = recibido if re.fullmatch(r"[\w-]{1,64}", recibido) else uuid4().hex[:12]
        token = id_operacion.set(valor)
        try:
            respuesta = await siguiente(request)
        finally:
            id_operacion.reset(token)
        respuesta.headers["x-request-id"] = valor
        return respuesta
```

Si el balanceador o el frontend ya mandan un `X-Request-ID`, se reusa; si no, se genera. **Lo que llega en un header es entrada no confiable**: sin el `fullmatch`, alguien manda un id de diez mil caracteres o con saltos de línea y te ensucia los logs. En el CLI, cada corrida tiene el suyo: `id_operacion.set(f"{args.comando}-{uuid4().hex[:8]}")`.

Y el adaptador del PSE lo manda hacia afuera:

```python adaptadores/pse.py · Hacia el proveedor
            respuesta = self._cliente.post(
                "/comprobantes",
                json=_a_json(comprobante),
                headers={"X-Request-ID": id_operacion.get()},
            )
```

Cuando le escribas al soporte del PSE, le das el identificador y pueden buscarlo en sus propios logs. Es la misma operación de punta a punta.

Los endpoints `def` de FastAPI corren en un pool de threads, y Starlette copia el contexto al thread, así que la `ContextVar` llega. Hay un test que lo verifica con un endpoint de eco.

## Consultar

Con una línea JSON por evento, cualquier agregador sirve: Loki, CloudWatch, Datadog. En el servidor, `jq` alcanza:

```bash Terminal
jq -c 'select(.comprobante == "F001-42")' /var/log/facturacion.log
jq -c 'select(.operacion == "enviar-pendientes-4a7be9d9")' /var/log/facturacion.log
```

El primero te da la historia de la factura; el segundo, todo lo que hizo esa corrida.

## Métricas, después

«¿Cuántos rechazos hubo hoy?» se responde contando líneas. Prometheus y sus contadores valen la pena cuando necesitás alertas sobre tasas, como «más de 5 % de rechazos en una hora». Antes, son infraestructura para un problema que todavía no tenés.

> **Quedate con esto**
> El dominio no loguea; la aplicación registra hechos con campos en `extra`; el formato lo deciden las entradas. Logs en JSON convierten «¿qué pasó con F001-42?» en una consulta. Un identificador por operación en una `ContextVar` agrupa todo y viaja hasta el PSE. Y el header que llega de afuera se valida, como cualquier entrada.
