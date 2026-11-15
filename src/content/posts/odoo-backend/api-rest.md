---
title: "API REST con API keys para un sistema legacy"
description: Exponer un endpoint propio con autenticación por API key, validación de entrada y respuestas de error que sirvan para algo.
date: 2026-10-10
topic: ERP
tags: [odoo, python, http]
goal: Que otro sistema dé de alta órdenes sin pasar por la interfaz.
course: odoo-backend-framework
section: integracion
order: 3
---

El taller tiene un sistema viejo en recepción que no se va a reemplazar. Cuando entra un equipo, ese sistema tiene que crear la orden en Odoo.

Podríamos usar XML-RPC —la próxima lección—, pero para un sistema ajeno que solo necesita hacer una cosa, un endpoint propio es mejor: superficie mínima, contrato explícito, validación en un solo lugar.

## Las API keys de Odoo

Odoo trae autenticación por clave de API. El usuario la genera en **su perfil → Seguridad de la cuenta → Claves de API**, y la clave se muestra una sola vez.

Para verificarla desde código:

```python
uid = request.env["res.users"]._check_credentials(api_key, {"interactive": False})
```

Lo bueno de usar el mecanismo de Odoo y no inventar uno: la clave está asociada a **un usuario real**, con sus grupos y sus reglas de registro. Toda la seguridad de la sección anterior sigue aplicando.

## El endpoint

```python controllers/api.py
import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class ServiceAPI(http.Controller):

    def _autenticar(self):
        """Devuelve el usuario de la API key, o None."""
        key = request.httprequest.headers.get("X-API-Key")
        if not key:
            return None
        uid = request.env["res.users"]._check_credentials(key, {"interactive": False})
        return uid

    def _error(self, codigo, mensaje, detalles=None):
        cuerpo = {"error": mensaje}
        if detalles:
            cuerpo["detalles"] = detalles
        return request.make_json_response(cuerpo, status=codigo)

    @http.route("/api/taller/ordenes", type="http", auth="none",
                methods=["POST"], csrf=False, save_session=False)
    def crear_orden(self, **kwargs):
        uid = self._autenticar()
        if not uid:
            return self._error(401, "Clave de API inválida o ausente.")

        env = request.env(user=uid)

        try:
            datos = request.get_json_data()
        except ValueError:
            return self._error(400, "El cuerpo tiene que ser JSON válido.")

        faltan = [c for c in ("documento", "equipo") if not datos.get(c)]
        if faltan:
            return self._error(400, "Faltan campos obligatorios.", faltan)

        partner = env["res.partner"].search([("vat", "=", datos["documento"])], limit=1)
        if not partner:
            return self._error(404, "No existe un cliente con ese documento.")

        equipo = env["service.equipment"].search([
            ("partner_id", "=", partner.id),
            ("serial", "=", datos["equipo"]),
        ], limit=1)
        if not equipo:
            equipo = env["service.equipment"].create({
                "name": datos.get("descripcion_equipo") or datos["equipo"],
                "serial": datos["equipo"],
                "partner_id": partner.id,
            })

        orden = env["service.order"].create({
            "partner_id": partner.id,
            "equipment_id": equipo.id,
            "diagnosis": datos.get("falla_reportada"),
        })
        _logger.info("API: orden %s creada por %s", orden.code, env.user.login)

        return request.make_json_response({
            "code": orden.code,
            "id": orden.id,
            "url": orden._portal_url(),
        }, status=201)
```

## Las decisiones que importan

### `auth="none"` y `request.env(user=uid)`

Usamos `auth="none"` porque la autenticación la hacemos nosotros con la clave, no con una sesión. Pero entonces **el environment no tiene usuario**, y hay que construirlo:

```python
env = request.env(user=uid)
```

A partir de ahí, todo corre con ese usuario y **sus permisos**. Nada de `sudo()`: si la clave es de un técnico, solo puede hacer lo que un técnico puede hacer.

Eso es lo que hace a este endpoint seguro por construcción. El control de acceso no lo programaste acá; lo heredaste de la sección de seguridad.

### `save_session=False`

Sin eso, cada llamada crea una sesión en disco. Un sistema externo que llama mil veces por día te deja mil archivos de sesión sin usar.

### Buscar al cliente por documento, no por id

```python
partner = env["res.partner"].search([("vat", "=", datos["documento"])], limit=1)
```

El sistema viejo no conoce los ids de Odoo y no tiene por qué. Identificar por algo que **los dos sistemas conocen** —el RUC, el documento— es lo que hace que la integración no sea frágil.

Es la diferencia entre una API que sobrevive a una migración de base y una que no.

### Códigos de estado que signifiquen algo

| Código | Cuándo |
|---|---|
| 201 | se creó |
| 400 | el JSON está mal o faltan campos |
| 401 | la clave no sirve |
| 403 | la clave sirve pero no tiene permiso |
| 404 | no existe lo que referencia |
| 409 | conflicto: ya existe |
| 500 | se rompió algo del lado nuestro |

Devolver siempre 200 con un `{"ok": false}` adentro obliga al otro lado a parsear para saber si funcionó, y rompe todos los reintentos automáticos.

### Decir qué falta

```json
{"error": "Faltan campos obligatorios.", "detalles": ["documento", "equipo"]}
```

Del otro lado hay alguien tratando de integrar. Un «petición inválida» sin más lo obliga a adivinar.

## Idempotencia

Esto es lo que separa una integración que funciona de una que llena la base de duplicados.

**El otro sistema va a reintentar.** Se le cortó la red justo después de que Odoo creara la orden pero antes de recibir la respuesta. Para él, falló. Reintenta. Y ahora hay dos órdenes.

La solución es una clave de idempotencia:

```python
referencia = datos.get("referencia_externa")
if referencia:
    existente = env["service.order"].search([("external_ref", "=", referencia)], limit=1)
    if existente:
        return request.make_json_response({
            "code": existente.code,
            "id": existente.id,
            "duplicado": True,
        }, status=200)
```

Con un campo `external_ref` en el modelo, con índice y restricción de unicidad:

```python models/service_order.py
external_ref = fields.Char(string="Referencia externa", copy=False, index=True)

_external_ref_uniq = models.UniqueIndex("(external_ref) WHERE external_ref IS NOT NULL")
```

El índice único parcial de la lección de restricciones: único cuando hay valor, sin molestar a las órdenes creadas a mano.

**Un reintento devuelve la orden que ya existe en vez de crear otra.** Eso es todo lo que hace falta, y cambia completamente la robustez de la integración.

## Registrar lo que entra

```python
_logger.info("API: orden %s creada por %s", orden.code, env.user.login)
```

Cuando el otro sistema diga «mandé la orden y no está», el log es lo único que responde la pregunta. Registrá al menos quién llamó y qué se creó.

Para integraciones serias conviene un modelo de bitácora con la petición completa, que además sirve para reprocesar.

## Probarlo

```bash Terminal · Crear una orden desde afuera
curl -X POST http://localhost:8069/api/taller/ordenes \
  -H "X-API-Key: tu-clave" \
  -H "Content-Type: application/json" \
  -d '{"documento": "20100030838", "equipo": "SN-12345",
       "falla_reportada": "No enciende",
       "referencia_externa": "REC-2026-0041"}'
```

Y la prueba que importa: **mandá la misma petición dos veces**. La segunda tiene que devolver 200 con `duplicado: true`, no crear una orden nueva.

## Documentarlo

Lo mínimo que tiene que recibir quien integra: la URL, el método, cómo autenticarse, un ejemplo de petición, un ejemplo de respuesta, y la tabla de códigos de error.

Media página de markdown en el README del módulo. Sin eso, cada integración nueva son tres días de ida y vuelta.

> **Quedate con esto**
> `auth="none"` más `request.env(user=uid)` te da un endpoint que respeta todos los permisos sin un solo `sudo()`. Identificá por una clave que los dos sistemas conozcan, no por ids de Odoo. Y la idempotencia no es opcional: el otro lado va a reintentar, y sin una referencia externa única eso son duplicados.
