---
title: "Eventos de dominio: avisar sin acoplar"
description: Cuando SUNAT rechaza un comprobante, contabilidad tiene que enterarse. El comprobante registra lo que pasó y quien quiera reacciona, sin que el envío sepa quiénes son.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, ddd]
goal: Modelar hechos del negocio como eventos y publicarlos después de guardar.
course: clean-architecture-python
section: aplicacion
order: 3
---

Un rechazo de SUNAT hay que corregirlo rápido, así que contabilidad tiene que recibir un correo. Mañana van a pedir también un webhook al ERP. Pasado, una alerta en el chat del equipo.

La versión directa es que `EnviarPendientes` llame a `correo.enviar(...)` después de cada rechazo. Con la segunda reacción ya tiene dos dependencias que no tienen nada que ver con enviar comprobantes, y con la tercera, tres.

## Un evento es un hecho

```python dominio/eventos.py
@dataclass(frozen=True)
class Evento:
    numero: NumeroComprobante


@dataclass(frozen=True)
class ComprobanteAceptado(Evento):
    pass


@dataclass(frozen=True)
class ComprobanteRechazado(Evento):
    cliente: str
    motivo: str
```

En pasado, inmutable y con los datos que una reacción necesita para no tener que ir a buscarlos. Es parte del dominio porque es lenguaje del negocio: «se rechazó un comprobante» lo dice un contador, no un programador.

## La entidad registra, no publica

```python dominio/comprobante.py · Lo que suma el comprobante
    eventos: list[Evento] = field(default_factory=list, init=False, repr=False)

    def aceptar(self) -> None:
        self._exigir_pendiente()
        self.estado = Estado.ACEPTADO
        self.eventos.append(ComprobanteAceptado(self.numero))

    def rechazar(self, motivo: str) -> None:
        self._exigir_pendiente()
        self.estado = Estado.RECHAZADO
        self.motivo_rechazo = motivo
        self.eventos.append(ComprobanteRechazado(self.numero, self.cliente.nombre, motivo))
```

El comprobante anota lo que le pasó. No sabe que existe un bus ni quién escucha, así que sigue sin dependencias. `init=False` deja la lista afuera del constructor: cuando el repositorio reconstruye un comprobante desde la base, nace sin eventos, porque no le pasó nada nuevo.

## El bus

```python aplicacion/eventos.py
class Bus:
    def __init__(self) -> None:
        self._manejadores: defaultdict[type[Evento], list[Callable[[Any], None]]] = defaultdict(list)

    def suscribir[E: Evento](self, tipo: type[E], manejador: Callable[[E], None]) -> None:
        self._manejadores[tipo].append(manejador)

    def publicar(self, evento: Evento) -> None:
        for manejador in self._manejadores[type(evento)]:
            try:
                manejador(evento)
            except Exception:
                log.exception("Falló una reacción a %s", type(evento).__name__)
```

Veinte líneas, sin biblioteca. `suscribir` es genérico: mypy exige que el manejador reciba el tipo de evento al que se suscribe.

El `except Exception` es a propósito, y es de los pocos lugares donde un `except` tan amplio se justifica: si el SMTP está caído, el envío a SUNAT no se puede cortar por eso, ni las otras reacciones dejar de correr. El error queda en el log con su traceback.

## Publicar después de guardar

```python aplicacion/enviar.py · El final del bucle
            with self.uow:
                self.uow.comprobantes.actualizar_estado(comprobante)
                self.uow.confirmar()
            for evento in comprobante.eventos:
                self.publicar(evento)
```

El orden importa. Si se publicara antes del `confirmar()` y el commit fallara, contabilidad recibiría un aviso de un rechazo que no quedó registrado.

`EnviarPendientes` recibe `publicar: Callable[[Evento], None]`, no el bus. Le alcanza con una función, y en los tests le pasás `lista.append`.

## La reacción

```python aplicacion/avisos.py
@dataclass
class AvisarRechazo:
    correo: Correo
    destinatario: str

    def __call__(self, evento: ComprobanteRechazado) -> None:
        self.correo.enviar(
            self.destinatario,
            f"SUNAT rechazó {evento.numero}",
            f"El comprobante {evento.numero} de {evento.cliente} fue rechazado: {evento.motivo}",
        )
```

`Correo` es un puerto más, y `CorreoSmtp`, su adaptador de veinte líneas con `smtplib`. Quién reacciona a qué se decide en un solo lugar, el [arranque](/blog/clean-architecture/segunda-entrada):

```python arranque.py · Conectar eventos con reacciones
    bus.suscribir(ComprobanteRechazado, AvisarRechazo(correo, os.environ["AVISOS_A"]))
```

El webhook al ERP de mañana es otra clase y otra línea acá. `EnviarPendientes` no se entera.

## El hueco

Si el proceso muere entre el `confirmar()` y el `publicar()`, el evento se pierde: el rechazo quedó guardado pero nadie avisó. Para un correo de aviso es aceptable, porque el rechazo sigue visible en el listado y en los logs.

Cuando no es aceptable, como al descontar stock o mover plata, la solución conocida es el **outbox**: el evento se guarda en una tabla dentro de la misma transacción que el cambio, y un proceso aparte lo publica y lo marca como enviado. El evento y el cambio se confirman juntos o no se confirman. Es más infraestructura, y conviene sumarla cuando un evento perdido cuesta plata.

## Cuándo no usar eventos

Si la reacción es parte de la operación, como reservar el correlativo al emitir, va en el caso de uso como llamada directa. Los eventos sirven para lo que la operación **no necesita** para terminar: avisos, integraciones, estadísticas.

> **Quedate con esto**
> Un evento es un hecho del negocio en pasado; la entidad lo registra sin saber quién escucha. Se publica después de confirmar, nunca antes. Un bus propio de veinte líneas alcanza, y una reacción que falla no debe frenar a las otras. Y si perder un evento cuesta plata, outbox; si es un aviso, alcanza con publicar después del commit.
