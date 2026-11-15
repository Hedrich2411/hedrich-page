---
title: "Actualizar tus módulos sin romper datos"
description: El procedimiento para subir una versión de tu módulo a producción.
date: 2026-10-11
topic: ERP
tags: [odoo, produccion, despliegue]
goal: Un despliegue que se puede deshacer.
course: odoo-produccion
section: actualizacion
order: 1
---

Desplegar una versión nueva de tu módulo es un `-u` y treinta segundos de espera. El problema no es el comando: es lo que el comando hace con los datos que ya están ahí.

Esta lección es una prueba concreta de lo que se pierde y cómo evitarlo. La corrí sobre `service_workshop` en una base real.

## Qué hace `-u` de verdad

```bash Terminal
odoo-bin -c /etc/odoo/odoo.conf -d taller -u service_workshop --stop-after-init
```

Cuatro cosas, en este orden:

**Compara el modelo con la tabla y la ajusta.** Campos nuevos → columnas nuevas. Campos que desaparecieron → ya vamos a ver.

**Vuelve a cargar los archivos de `data`.** Vistas, acciones, menús, datos maestros. Todo lo que está en la lista `data` del manifiesto se reescribe.

**Corre los scripts de migración** si los hay. El tema de la segunda mitad de esta lección.

**Recalcula lo que haga falta**: campos calculados almacenados nuevos, índices, restricciones.

Y `--stop-after-init` hace que termine y salga, en vez de quedarse sirviendo. Para un despliegue es lo que querés: corrés la actualización, mirás el código de salida, y recién después levantás el servicio.

### Lo que `-u` **no** vuelve a cargar

Los registros marcados con `noupdate="1"`.

```xml data/service_sequence.xml
<odoo noupdate="1">
    <record id="seq_service_order" model="ir.sequence">
        ...
    </record>
</odoo>
```

Esos se crean la primera vez y después **no se tocan nunca más**. Es a propósito: si el cliente cambió el prefijo de la secuencia, no querés pisárselo en cada despliegue.

La consecuencia que sorprende: **si corregís un error en un registro `noupdate`, el `-u` no lo arregla en las bases que ya lo tienen**. Eso se arregla con un script de migración, no con el XML.

## La prueba: qué pasa al renombrar un campo

El caso más común y el que más daño hace. En `service.order` teníamos:

```python models/service_order.py
is_warranty = fields.Boolean(string="En garantía")
```

Con datos reales en la base:

```text
en garantía / total: (2, 3)
```

Lo renombré a `under_warranty`, subí la versión del manifiesto de `19.0.1.0.0` a `19.0.1.1.0`, y corrí el `-u` **sin script de migración**. Esto apareció en el log:

```text
INFO curso odoo.addons.base.models.ir_model: Deleting 1873@ir.model.fields
    (service_workshop.field_service_order__is_warranty)
```

Y esto quedó en la base:

```text
columnas: ['under_warranty']
psycopg2.errors.UndefinedColumn: column "is_warranty" does not exist
```

**La columna vieja no quedó huérfana: se borró.** Es fácil encontrar la creencia contraria —que Odoo deja la columna ahí y uno la recupera después— y en Odoo 19 no es cierta. Está en `ir_model.py`, sin ambigüedad:

```python odoo/addons/base/models/ir_model.py
self.env.cr.execute(SQL('ALTER TABLE %s DROP COLUMN %s CASCADE',
    SQL.identifier(model._table), SQL.identifier(field.name),
))
```

`DROP COLUMN ... CASCADE`. Los datos se fueron, y el único lugar donde siguen existiendo es el backup de anoche.

Lo mismo vale para **borrar** un campo, que es el mismo camino con un paso menos.

## El script de migración

El mismo renombre, hecho bien:

```python migrations/19.0.1.1.0/pre-rename-warranty.py
from odoo.tools import sql


def migrate(cr, version):
    """Renombra is_warranty -> under_warranty conservando los datos."""
    if sql.column_exists(cr, "service_order", "is_warranty"):
        sql.rename_column(cr, "service_order", "is_warranty", "under_warranty")
```

Con ese archivo y el mismo `-u`, el log dice otra cosa:

```text
INFO curso odoo.modules.migration: module service_workshop:
    Running upgrade [>19.0.1.1.0] pre-rename-warranty
```

Y la base:

```text
columnas: ['under_warranty']
under_warranty / total: (2, 3)
```

Los dos registros siguen ahí.

La clave es **`pre-`**: el script corre *antes* de que Odoo compare el modelo con la tabla. Cuando llega a comparar, ya existe una columna `under_warranty` con los datos adentro, y no tiene nada que crear ni nada que borrar.

El `if column_exists` no es paranoia: ese script se va a ejecutar en bases que ya están actualizadas, y tiene que poder correr dos veces sin romper. **Un script de migración se escribe idempotente o no se escribe.**

### Cómo se organizan

La estructura exacta, que está documentada en `odoo/modules/migration.py`:

```text
service_workshop/
`-- migrations/
    |-- 19.0.1.1.0/
    |   |-- pre-rename-warranty.py       antes de cargar el módulo
    |   |-- post-backfill-priority.py    después de cargarlo
    |   `-- end-cleanup.py               después de TODOS los módulos
    `-- 0.0.0/
        `-- end-invariants.py            en cualquier cambio de versión
```

| Prefijo | Cuándo corre | Para qué |
|---|---|---|
| `pre-` | antes de tocar el esquema | renombrar columnas, salvar datos |
| `post-` | después, con el ORM ya cargado | rellenar campos nuevos, recalcular |
| `end-` | después de todos los módulos | limpieza que depende de otros módulos |

La firma siempre es `migrate(cr, version)`, donde `version` es la que estaba instalada antes.

**El nombre de la carpeta es la versión a la que vas**, y el script corre cuando la versión instalada es *menor* que esa. Por eso el renombre va en `19.0.1.1.0`: es la versión que lo introduce.

Y la trampa número uno: **si no subís la versión del manifiesto, el script no corre**. Odoo compara la versión instalada con la del manifiesto; si son iguales no hay nada que migrar, aunque el `-u` sí recargue los datos. Dos minutos de confusión garantizados la primera vez.

### `pre-` tiene cursor, no ORM

En un `pre-` el modelo todavía no está cargado. Tenés `cr` y SQL:

```python
cr.execute("UPDATE service_order SET state = 'repair' WHERE state = 'reparacion'")
```

En un `post-` sí podés usar el ORM:

```python migrations/19.0.1.2.0/post-backfill-priority.py
from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    pendientes = env["service.order"].search([("priority", "=", False)])
    pendientes.write({"priority": "1"})
```

Para rellenar un campo nuevo en miles de registros, SQL directo en un `pre-` es mucho más rápido que el ORM en un `post-`. Para algo que necesita lógica de negocio, el ORM. La elección es esa.

Y las herramientas que ya existen, en `odoo.tools.sql`, para no escribir el SQL a mano:

```python
from odoo.tools import sql

sql.column_exists(cr, "service_order", "is_warranty")
sql.rename_column(cr, "service_order", "viejo", "nuevo")
sql.table_exists(cr, "service_order")
```

## El procedimiento

El orden importa y cada paso está por una razón:

**1. Backup, y verificado.** El de la lección anterior. No el de la semana pasada: uno de ahora.

**2. Probarlo en una copia.** Restaurá el backup en otra base y corré ahí el `-u` primero:

```bash Terminal
odoo-bin db load --force --neutralize taller_staging /var/backups/taller.zip
odoo-bin -d taller_staging -u service_workshop --stop-after-init
```

Esto es lo que convierte un despliegue en algo aburrido. Si el script de migración tiene un error, te enterás acá, con una base de prueba y sin nadie esperando.

**3. Mirar el log entero**, no solo el código de salida. Un `WARNING` sobre una vista que no se pudo cargar es un despliegue roto que termina con éxito.

**4. Avisar y parar.** Un `-u` mientras hay gente trabajando da errores de concurrencia y usuarios con la pantalla a medio cargar.

```bash Terminal
docker compose stop odoo
docker compose run --rm odoo odoo -d taller -u service_workshop --stop-after-init
docker compose start odoo
```

El `run --rm` corre la actualización en un contenedor descartable, con el servicio detenido. Nadie entra a la mitad.

**5. Revisar que funciona.** Abrir el módulo, crear un registro, imprimir un PDF. Treinta segundos.

## Volver atrás

La parte que casi nadie prepara y la que define si el despliegue es reversible.

**El código vuelve fácil.** Un tag de git y listo.

**Los datos no.** El `-u` ya corrió: las columnas se renombraron, los campos viejos se borraron, los datos se transformaron. Volver el código a la versión anterior deja una base con el esquema nuevo y un código que espera el viejo.

Las dos opciones reales, en orden de preferencia:

**Restaurar el backup.** Es la única garantía. Por eso el paso 1 no es negociable, y por eso el backup tiene que ser de minutos antes y no de anoche.

**Escribir el script inverso.** Si el cambio es simple —un renombre— es un `rename_column` al revés y se resuelve en cinco minutos. Si tocaste la forma de los datos, no.

Y la decisión que evita todo esto:

```python
# en vez de renombrar
old_field = fields.Char(string="Viejo")       # queda, deprecado
new_field = fields.Char(string="Nuevo")       # el que se usa
```

**Dejá el campo viejo una versión más.** Copiás los datos al nuevo, dejás de usar el viejo en el código, y lo borrás en el despliegue siguiente cuando ya sabés que todo anda. Dos despliegues chicos y reversibles en vez de uno grande que no lo es.

Es el mismo patrón que se usa en cualquier migración de base de datos seria, y en Odoo aplica igual.

## `-u all`

```bash Terminal
odoo-bin -d taller -u all --stop-after-init
```

Actualiza **todos** los módulos instalados. Sirve después de subir la versión de Odoo, o cuando sospechás que algo quedó a medias.

Dos cuidados: tarda mucho más —minutos en vez de segundos— y recarga los datos de todos los módulos, lo que puede revertir configuraciones hechas desde la interfaz sobre registros que no son `noupdate`.

Para un despliegue de tu módulo, nombrá tu módulo. `-u all` es para cuando hay una razón.

> **Quedate con esto**
> Renombrar un campo sin script de migración no deja la columna huérfana: Odoo corre `ALTER TABLE ... DROP COLUMN ... CASCADE` y los datos se van. El script `pre-` corre antes de que Odoo compare el modelo con la tabla, y por eso es el que salva los datos — pero **solo corre si subís la versión del manifiesto**. Escribilos idempotentes con `column_exists`, probá el `-u` sobre una copia restaurada antes de tocar producción, y cuando puedas elegí deprecar el campo viejo en vez de renombrarlo: dos despliegues reversibles valen más que uno que no lo es.
