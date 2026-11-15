---
title: "Errores al usuario: UserError, ValidationError y logging"
description: Las excepciones de Odoo, cuál lanzar en cada caso, y qué nunca debería llegar a la pantalla del usuario.
date: 2026-10-10
topic: ERP
tags: [odoo, python]
goal: Que el usuario entienda qué hizo mal y vos qué falló.
course: odoo-backend-framework
section: recordsets
order: 4
---

Cuando algo sale mal hay dos públicos distintos. El usuario necesita saber **qué hacer**. Vos necesitás saber **qué pasó**. Son dos mensajes diferentes y conviene no mezclarlos.

## Las excepciones de Odoo

```python
from odoo.exceptions import UserError, ValidationError, AccessError, MissingError
```

- **`UserError`** — el usuario intentó algo que no corresponde. «No se puede entregar una orden sin diagnóstico.» Es la que más vas a usar.
- **`ValidationError`** — los datos no son válidos. Es la que va en los `@api.constrains`.
- **`AccessError`** — no tiene permiso. Normalmente la lanza Odoo solo.
- **`MissingError`** — el registro ya no existe. También suele lanzarla el ORM.

En la práctica, `UserError` y `ValidationError` se muestran casi igual. La diferencia es semántica, y vale la pena respetarla: `ValidationError` en las validaciones de datos, `UserError` en las reglas de flujo.

```python
raise UserError("No se puede entregar la orden %s: todavía está en reparación." % self.code)
```

## Lo que pasa con la transacción

Esto es lo más importante de la lección y lo que menos se explica.

**Cada petición en Odoo es una transacción de PostgreSQL.** Cuando lanzás una excepción, la transacción entera hace rollback: **todo lo que se escribió desde que empezó la petición se deshace**.

Eso es lo que querés casi siempre. Si una orden no se puede entregar, tampoco deberían quedar la fecha de entrega ni las líneas que se generaron antes de darse cuenta.

Pero tiene dos consecuencias prácticas:

**No sirve de nada escribir algo antes de lanzar el error.** Si registrás el intento fallido en un campo y después lanzás la excepción, ese registro se va con el rollback.

```python Esto no deja rastro de nada
def entregar(self):
    self.write({"intentos": self.intentos + 1})
    if not self.diagnosis:
        raise UserError("Falta el diagnóstico.")   # ← también deshace el write de arriba
```

Si de verdad necesitás que quede constancia, el camino es el log del servidor, que no participa de la transacción.

**Después de una excepción, el cursor está inutilizable.** Si capturás la excepción y seguís trabajando con la base, vas a recibir errores raros de PostgreSQL. Por eso capturar excepciones alrededor de operaciones del ORM casi nunca es buena idea.

## El log, que es para vos

```python models/service_order.py
import logging

_logger = logging.getLogger(__name__)


class ServiceOrder(models.Model):
    _inherit = "service.order"

    def _sincronizar_con_sistema_externo(self):
        try:
            respuesta = self._llamar_api()
        except Exception:
            _logger.exception("Falló la sincronización de la orden %s", self.code)
            raise UserError(
                "No se pudo sincronizar con el sistema de inventario. Probá en unos minutos."
            )
```

Ese patrón es el que conviene adoptar: **el detalle técnico al log, el mensaje accionable al usuario**.

`_logger.exception()` escribe el traceback completo. El usuario ve una frase que le dice qué hacer. Vos abrís el log y tenés todo.

Lo contrario —mostrarle el traceback al usuario— es malo por dos razones: no puede hacer nada con eso, y puede exponer rutas internas, nombres de tablas y a veces datos de otros registros.

### Los niveles

```python
_logger.debug("Valores recibidos: %s", vals)      # detalle de desarrollo
_logger.info("Orden %s entregada", self.code)      # eventos normales
_logger.warning("Orden %s sin técnico asignado", self.code)   # raro pero no fatal
_logger.error("No se pudo generar el PDF de %s", self.code)   # falló algo
_logger.exception("Falló la sincronización")       # error + traceback
```

Dos costumbres que valen la pena:

**Usá `%s` y pasá los valores como argumentos**, no concatenación ni f-strings. Si el nivel está desactivado, el mensaje ni se arma.

**`_logger.exception()` solo dentro de un `except`.** Fuera de ahí no hay traceback que registrar.

### Ver solo tu módulo

```bash Terminal · Subir el detalle de un solo módulo
./odoo-bin -c odoo.conf --log-handler=odoo.addons.service_workshop:DEBUG
```

Es mucho mejor que `--log-level=debug`, que te inunda con el detalle de todo Odoo.

## Mensajes que sirven

Un mensaje de error es parte de la interfaz. Se nota enseguida cuál se pensó y cuál no.

| | |
|---|---|
| ❌ | «Error» |
| ❌ | «Operación no permitida» |
| ⚠️ | «No se puede entregar sin diagnóstico» |
| ✅ | «La orden TAL/0007 no se puede entregar: falta cargar el diagnóstico.» |

El último dice **qué registro**, **qué pasó** y **qué falta**. En el servidor tenés el registro a mano, así que nombralo.

Una prueba rápida: si el mensaje no le permite a alguien resolver el problema sin preguntarte, falta información.

## Avisar sin cortar

A veces querés informar algo que no es un error. Para eso no sirve una excepción, porque haría rollback de todo.

```python models/service_order.py · Devolver una notificación
def entregar(self):
    self.ensure_one()
    self.write({"state": "done"})
    return {
        "type": "ir.actions.client",
        "tag": "display_notification",
        "params": {
            "title": "Orden entregada",
            "message": "Se notificó al cliente por correo.",
            "type": "success",
            "sticky": False,
        },
    }
```

El método hace su trabajo, **devuelve una acción** y la interfaz muestra el aviso. Los `type` posibles son `success`, `warning`, `danger` e `info`.

Es la forma correcta de confirmar que algo salió bien, y de advertir sin abortar.

> **Quedate con esto**
> Una excepción hace rollback de toda la transacción, así que no tiene sentido escribir algo antes de lanzarla. El detalle técnico va al log con `_logger.exception()` y al usuario le llega una frase que nombra el registro y dice qué falta. Y si solo querés avisar sin cancelar, devolvé una notificación en vez de lanzar un error.
