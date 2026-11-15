---
title: "Hablar con el PSE sin que el dominio se entere"
description: Un cliente HTTP que traduce errores de red a algo que el caso de uso entiende, y un envío que sobrevive a un proveedor caído.
date: 2026-10-19
topic: Backend
tags: [python, httpx, arquitectura]
goal: Integrar un servicio externo que falla, sin perder comprobantes ni duplicarlos.
course: clean-architecture-python
section: adaptadores
order: 2
---

El PSE firma el comprobante y lo manda a SUNAT. Para el sistema es una API HTTP que a veces tarda, a veces responde 503 y a veces no responde.

El formato del JSON depende de tu proveedor; el de esta lección es ilustrativo. Lo que importa es dónde vive esa dependencia: en un solo archivo.

## Tres resultados, no dos

Un envío termina de tres formas, y el caso de uso necesita distinguirlas:

| Qué pasó | Qué significa | Qué hacer |
|---|---|---|
| SUNAT aceptó | Listo | Marcar `aceptado` |
| SUNAT rechazó | El comprobante tiene un problema | Marcar `rechazado` con el motivo; reintentar no sirve |
| Timeout, sin red o un 5xx | No sabemos nada | Dejarlo `pendiente` y reintentar después |

Hay un cuarto caso: un 4xx, como un token vencido o un JSON mal armado. Eso es un bug o un error de configuración y reintentar no lo arregla. Que explote y quede en los logs.

## El adaptador

```python adaptadores/pse.py
class PseHttp:
    def __init__(self, cliente: httpx.Client):
        self._cliente = cliente

    def enviar(self, comprobante: Comprobante) -> RespuestaSunat:
        try:
            respuesta = self._cliente.post(
                "/comprobantes",
                json=_a_json(comprobante),
                headers={"X-Request-ID": id_operacion.get()},
            )
        except httpx.TransportError as error:
            raise PseNoDisponible(f"{type(error).__name__}: {error}") from error
        if respuesta.status_code >= 500:
            raise PseNoDisponible(f"El PSE respondió {respuesta.status_code}")
        respuesta.raise_for_status()
        datos = respuesta.json()
        return RespuestaSunat(aceptado=datos["aceptado"], mensaje=datos.get("mensaje", ""))


def _a_json(comprobante: Comprobante) -> dict[str, Any]:
    documento = comprobante.cliente.documento
    return {
        "tipo": comprobante.tipo.value,
        "numero": str(comprobante.numero),
        "fecha": comprobante.fecha.isoformat(),
        "cliente": {
            "nombre": comprobante.cliente.nombre,
            "tipo_documento": documento.tipo.value if documento else None,
            "numero_documento": documento.numero if documento else None,
        },
        "items": [
            {"descripcion": i.descripcion, "cantidad": str(i.cantidad), "valor_unitario": str(i.precio_unitario)}
            for i in comprobante.items
        ],
        "subtotal": str(comprobante.subtotal),
        "igv": str(comprobante.igv),
        "total": str(comprobante.total),
        "referencia": str(comprobante.referencia) if comprobante.referencia else None,
        "sustento": comprobante.sustento or None,
    }
```

**`httpx.TransportError`** cubre timeouts, conexión rechazada y DNS: todo lo que significa «no llegamos».

**Los montos viajan como string.** `json` no sabe serializar `Decimal`, y pasarlo a `float` para mandarlo deshace todo el cuidado de [los value objects](/blog/clean-architecture/value-objects).

**`X-Request-ID`** manda el identificador de la operación para poder cruzar nuestros logs con los del proveedor; lo armamos en [observabilidad](/blog/clean-architecture/observabilidad).

**El cliente HTTP se recibe, no se crea.** URL, token y timeout son configuración y se arman en [el arranque](/blog/clean-architecture/segunda-entrada). Además, el test puede pasar un cliente con un transporte falso.

## Enviar los pendientes

```python aplicacion/enviar.py
log = logging.getLogger(__name__)


@dataclass
class EnviarPendientes:
    uow: UnidadDeTrabajo
    pse: Pse
    publicar: Callable[[Evento], None] = lambda evento: None

    def ejecutar(self, limite: int = 50) -> int:
        with self.uow:
            pendientes = self.uow.comprobantes.pendientes(limite)

        enviados = 0
        for comprobante in pendientes:
            try:
                respuesta = self.pse.enviar(comprobante)
            except PseNoDisponible as error:
                log.warning("PSE no disponible, se reintenta en la próxima corrida", extra={"error": str(error)})
                break

            if respuesta.aceptado:
                comprobante.aceptar()
            else:
                comprobante.rechazar(respuesta.mensaje)
                log.error(
                    "%s rechazado: %s",
                    comprobante.numero,
                    respuesta.mensaje,
                    extra={"comprobante": str(comprobante.numero), "motivo": respuesta.mensaje},
                )

            with self.uow:
                self.uow.comprobantes.actualizar_estado(comprobante)
                self.uow.confirmar()
            for evento in comprobante.eventos:
                self.publicar(evento)
            enviados += 1
        return enviados
```

**Ninguna transacción abierta durante el HTTP.** Se leen los pendientes y se cierra. Por cada uno se llama al PSE fuera de cualquier transacción, y se abre una corta solo para guardar el resultado. Una transacción que espera diez segundos a un tercero retiene una conexión del pool y, si tocara las series, bloquearía a las cajas.

**Uno por uno, confirmando cada uno.** Si el proceso muere en el comprobante 30, los 29 anteriores ya quedaron guardados.

**`break` con el PSE caído.** Si no respondió para el primero, no va a responder para los otros 49. Seguir es esperar 49 timeouts.

**Las transiciones las decide el dominio.** El caso de uso llama a `aceptar()` o `rechazar()`; no asigna el estado.

**`publicar`** reparte los [eventos de dominio](/blog/clean-architecture/eventos-de-dominio) recién después de confirmar. **`extra`** suma campos al log que vamos a aprovechar en [observabilidad](/blog/clean-architecture/observabilidad).

### El reenvío

Queda una ventana: el PSE acepta y el proceso muere antes de guardar `aceptado`. En la próxima corrida el comprobante sigue `pendiente` y se vuelve a enviar.

Esa ventana no se puede cerrar de este lado. Lo que sí se puede es hacer que el reenvío sea inofensivo: SUNAT identifica el comprobante por el RUC del emisor, el tipo, la serie y el correlativo, y no lo registra dos veces. Revisá qué responde tu PSE ante un número ya informado, que suele ser un código de error específico, y hacé que el adaptador lo traduzca a `aceptado`. Es un cambio en un solo archivo.

## Los tests

El adaptador, con el transporte falso de `httpx`, sin servidor ni red:

```python tests/test_pse.py · Extracto
def pse(responder: httpx.MockTransport) -> PseHttp:
    return PseHttp(httpx.Client(base_url="https://pse.test", transport=responder))


def test_caido() -> None:
    with pytest.raises(PseNoDisponible):
        pse(httpx.MockTransport(lambda _: httpx.Response(503))).enviar(FACTURA)


def test_sin_red() -> None:
    def sin_red(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin red", request=request)

    with pytest.raises(PseNoDisponible):
        pse(httpx.MockTransport(sin_red)).enviar(FACTURA)
```

El caso de uso, con un PSE falso que se configura para rechazar ciertos números o para estar caído:

```python tests/test_enviar.py · Extracto
def test_acepta_y_rechaza_segun_sunat() -> None:
    uow = con_pendientes(2)
    enviados = EnviarPendientes(uow, PseFalso(rechazar=("F001-2",))).ejecutar()

    assert enviados == 2
    assert estado(uow, "F001-1") is Estado.ACEPTADO
    assert estado(uow, "F001-2") is Estado.RECHAZADO


def test_pse_caido_deja_todo_pendiente() -> None:
    uow = con_pendientes(3)

    assert EnviarPendientes(uow, PseFalso(caido=True)).ejecutar() == 0
    assert len(uow.comprobantes.pendientes(10)) == 3
```

`PseFalso` vive en `tests/fakes.py` con los demás: guarda lo que se le mandó, rechaza los números que le indicás y lanza `PseNoDisponible` si está caído.

> **Quedate con esto**
> El adaptador traduce el mundo HTTP a tres resultados: aceptado, rechazado o no disponible; los 4xx son bugs y explotan. Nunca una transacción abierta mientras se espera a un tercero. Se confirma comprobante por comprobante y se corta al primer «no disponible». Y el reenvío tiene que ser inofensivo, porque la ventana entre «el PSE aceptó» y «lo guardé» no se puede cerrar.
