---
title: "Usuarios de servicio, API keys y permisos"
description: El principio de menor privilegio aplicado a las cuentas que no son personas.
date: 2026-10-11
topic: ERP
tags: [odoo, seguridad]
goal: Que una integración comprometida no se lleve la base entera.
course: odoo-produccion
section: hardening
order: 2
---

En el curso de backend construimos un endpoint REST y vimos cómo conectarse por XML-RPC. Las dos cosas necesitan credenciales, y ahí es donde se toman decisiones que se pagan caras.

La pregunta de esta lección: **si alguien se lleva las credenciales de tu integración, ¿qué puede hacer con ellas?**

## Un usuario por integración

El error habitual es usar `admin` para todo. Es cómodo: funciona siempre, nunca falta un permiso.

Y eso es exactamente el problema. Si esas credenciales se filtran —en un repositorio, en un log, en la máquina del otro sistema— quien las tenga **puede hacer todo lo que hace un administrador**, incluido leer la base entera y borrarla.

```text
Sistema de recepción  →  usuario "api.recepcion"
Sincronización de stock →  usuario "api.stock"
Reportes de BI        →  usuario "api.bi" (solo lectura)
```

Un usuario por integración, con nombre que diga de quién es.

Tres beneficios concretos:

**Alcance limitado.** El de recepción crea órdenes y nada más. Si se filtra, eso es todo lo que se puede hacer.

**Trazabilidad.** El `create_uid` de cada registro —el campo que Odoo pone solo, de la lección del modelo— te dice qué sistema lo creó.

**Revocación quirúrgica.** Desactivás esa cuenta y las demás integraciones siguen funcionando.

## Qué grupos darle

Lo mínimo para hacer su trabajo. Para el de recepción del taller:

- `base.group_user` — usuario interno, el mínimo.
- `service_workshop.group_service_technician` — crear y leer órdenes.

**Y nada más.** Nada de `base.group_system`, que es administrador de ajustes.

Si además querés limitar **qué** registros toca, ahí entran las reglas de registro del curso de backend. Una regla sobre el usuario de BI que lo deje ver solo el año en curso es una línea de XML.

### Solo lectura

Para un usuario de reportes, el `ir.model.access.csv` es el lugar:

```csv
access_service_order_bi,service.order bi,model_service_order,service_workshop.group_bi,1,0,0,0
```

Lectura en 1, el resto en 0. Acordate de la lección de permisos: **no existe la denegación**, se construye sumando. Un usuario que solo está en ese grupo no puede escribir nada.

## API keys, no contraseñas

Desde el perfil del usuario: **Seguridad de la cuenta → Claves de API**.

Por qué siempre una clave y nunca la contraseña:

**Se revoca sola.** Borrás la clave y esa integración deja de funcionar. La cuenta sigue viva.

**No sirve para entrar.** Una API key no permite iniciar sesión en la interfaz web.

**Se puede tener varias.** Una por sistema, y sabés cuál revocar.

**Se muestra una sola vez.** Si no quedó guardada, se genera otra — cosa que una contraseña no tiene.

Hay además un parámetro que vale la pena conocer:

```ini config/odoo.conf
api_key_duration = 90
```

También se puede fijar por grupo con el campo `api_key_duration` de `res.groups`. Una clave con vencimiento obliga a rotarla, que es exactamente lo que nadie hace si no lo obliga nada.

## El rol de PostgreSQL

Esto viene de la primera lección del curso de backend y es donde más se peca por comodidad.

```sql
CREATE ROLE odoo WITH LOGIN CREATEDB PASSWORD '...';
```

**`CREATEDB`, no `SUPERUSER`.** Odoo necesita poder crear bases; no necesita poder leer y modificar todo el clúster.

La diferencia importa cuando alguien encuentra una inyección de SQL en cualquier módulo instalado —tuyo o de terceros—. Con un rol normal, el daño queda acotado a las bases de Odoo. Con un superusuario, se lleva el servidor entero.

## Revisar quién tiene qué

Vale la pena correr esto cada tanto:

```python odoo shell
# usuarios con permisos de administrador
admin = env.ref("base.group_system")
for u in admin.all_user_ids:
    print(u.login, "|", u.name)
```

```python
# claves de API activas
for k in env["res.users.apikeys"].sudo().search([]):
    print(k.user_id.login, "|", k.name, "|", k.create_date)
```

```python
# usuarios que no entran hace tiempo
from datetime import timedelta
limite = fields.Datetime.now() - timedelta(days=90)
for u in env["res.users"].search([("login_date", "<", limite), ("active", "=", True)]):
    print(u.login, "| último acceso:", u.login_date)
```

Esa última lista suele tener sorpresas: cuentas de gente que ya no trabaja ahí, y claves de integraciones que se desconectaron hace meses.

## Cuando una clave se filtra

El procedimiento, en orden:

1. **Revocar la clave.** Primero cortás, después investigás.
2. **Mirar qué hizo.** `create_uid` y `write_uid` en los modelos que esa cuenta podía tocar.
3. **Revisar el log de Nginx** para ver desde qué IPs se usó.
4. **Generar una clave nueva** y actualizar el sistema externo.
5. **Preguntarte por qué esa cuenta podía hacer tanto**, y bajarle los permisos.

El paso 5 es el que convierte un incidente en una mejora.

## La pregunta de la lección

Para cada credencial que exista en tu despliegue:

**Si esto se filtra, ¿qué puede hacer quien lo tenga?**

Si la respuesta es «todo», hay trabajo por hacer. Si es «crear órdenes de servicio del cliente tal», estás donde tenés que estar.

> **Quedate con esto**
> Un usuario por integración, con los grupos mínimos, y API key en vez de contraseña — la clave se revoca sin tocar la cuenta y no sirve para entrar a la interfaz. El rol de PostgreSQL va con `CREATEDB`, nunca `SUPERUSER`: eso acota el daño de cualquier inyección. Y revisá cada tanto quién tiene permisos de administrador y qué claves siguen activas.
