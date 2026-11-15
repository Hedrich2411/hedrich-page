---
title: "Inversión de dependencias con Protocol"
description: La D de SOLID. Cómo un caso de uso usa la base de datos y el PSE sin importarlos, sin herencia.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, solid]
goal: Entender la inversión de dependencias y por qué la interfaz la define quien la usa.
course: clean-architecture-python
section: solid
order: 5
---

Es el último principio de SOLID y el que convierte a los otros cuatro en arquitectura: los módulos de alto nivel no dependen de los de bajo nivel; los dos dependen de abstracciones.

En concreto: la regla de dependencias dice que la aplicación no importa infraestructura. Pero el caso de uso «enviar pendientes» **tiene que** mandar comprobantes al PSE. ¿Cómo lo llama sin importarlo?

## El problema

La versión directa:

```python aplicacion/enviar.py · Mal · el caso de uso conoce httpx
import httpx

def enviar_pendientes(sesion):
    for comprobante in pendientes(sesion):
        respuesta = httpx.post("https://pse.example/comprobantes", json=...)
        ...
```

La flecha apunta hacia afuera: `aplicacion → httpx`. Para testear esto hace falta un servidor. Para cambiar de PSE hay que tocar el caso de uso.

## Invertir la flecha

El caso de uso declara **qué necesita**, en sus propios términos:

```python aplicacion/puertos.py · El puerto
@dataclass(frozen=True)
class RespuestaSunat:
    aceptado: bool
    mensaje: str


class PseNoDisponible(Exception):
    """El PSE no respondió: el comprobante sigue pendiente y se reintenta."""


class Pse(Protocol):
    def enviar(self, comprobante: Comprobante) -> RespuestaSunat: ...
```

Y lo recibe sin saber quién lo implementa:

```python aplicacion/enviar.py · Recibe el puerto
@dataclass
class EnviarPendientes:
    uow: UnidadDeTrabajo
    pse: Pse
```

Afuera, el adaptador cumple el contrato:

```python adaptadores/pse.py · El adaptador
import httpx

from facturacion.aplicacion.puertos import PseNoDisponible, RespuestaSunat
from facturacion.dominio.comprobante import Comprobante


class PseHttp:
    def __init__(self, cliente: httpx.Client):
        self._cliente = cliente

    def enviar(self, comprobante: Comprobante) -> RespuestaSunat:
        ...
```

Ahora `httpx` solo lo importa `adaptadores/pse.py`, y `adaptadores` importa `aplicacion`. **La flecha apunta hacia adentro.** En ejecución el control sigue yendo de adentro hacia afuera, porque el caso de uso llama al PSE, pero la dependencia de código va al revés. Eso es lo que se invierte.

## Por qué `Protocol` y no `ABC`

`PseHttp` no hereda de `Pse`. Ni siquiera lo importa. `Protocol` es tipado estructural: si la clase tiene un `enviar` con esa firma, cumple.

| | `abc.ABC` | `typing.Protocol` |
|---|---|---|
| El adaptador hereda | Sí | No |
| Se verifica | Al instanciar | Con mypy, antes de correr |
| Un fake de test | Tiene que heredar | Cualquier clase con el método |

Con `Protocol` el puerto es una descripción, no una jerarquía. Los fakes de los tests son clases sueltas de diez líneas.

La contracara: si te equivocás en una firma, Python no se queja hasta que corre mypy. Por eso el `strict = true`.

## La interfaz es de quien la usa

Fijate dónde vive `Pse`: en `aplicacion/puertos.py`, no en `adaptadores/`. Y habla el idioma del caso de uso, `enviar(comprobante) -> RespuestaSunat`, no el del proveedor, `post(url, json)`.

Si la escribiera el adaptador, terminaría pareciéndose a la API del proveedor, y cambiar de proveedor cambiaría la interfaz. Así, cada proveedor nuevo es un adaptador que traduce a lo mismo.

Lo mismo con `PseNoDisponible`. El caso de uso necesita distinguir «SUNAT rechazó» de «no hubo respuesta» para decidir si reintenta, pero no le importa si fue un timeout, un 503 o la red. El adaptador traduce las tres cosas a una excepción que la aplicación entiende.

## Cuántos puertos

En todo el curso hay cinco: `Comprobantes`, `Series`, `UnidadDeTrabajo`, `Pse` y `Correo`. Cada uno tiene dos implementaciones reales: la de producción y la de los tests.

Esa es la vara. Un puerto para el logger, para el reloj o para la configuración, «por si algún día», es ceremonia. La fecha de hoy, por ejemplo, se resuelve con un parámetro, como vas a ver en [casos de uso](/blog/clean-architecture/casos-de-uso).

> **Quedate con esto**
> El caso de uso define un `Protocol` con lo que necesita, en sus términos, y el adaptador lo implementa sin heredar. La dependencia de código apunta hacia adentro aunque la ejecución vaya hacia afuera. La interfaz vive en la aplicación, no en el adaptador. Y un puerto se crea cuando hay dos implementaciones reales, no antes.
