---
title: "El restore que probaste"
description: Un backup no probado no es un backup. Cómo probarlo sin tocar producción.
date: 2026-10-11
topic: ERP
tags: [odoo, postgresql, backups]
goal: Saber que el backup funciona antes de necesitarlo.
course: odoo-produccion
section: backups
order: 2
---

Un backup que nunca restauraste no es un backup: es un archivo que esperás que sea un backup.

La lista de formas en que un backup falla el día que lo necesitás es larga y poco imaginativa: el `pg_dump` se cortó a la mitad y nadie leyó el log, el filestore nunca entró, el cron apuntaba a una base que se renombró hace seis meses, el disco se llenó en marzo.

Todas se detectan con una restauración de prueba. Ninguna se detecta mirando el archivo.

## El comando

Igual que para el dump, Odoo 19 tiene el otro lado:

```bash Terminal
odoo-bin db -c /etc/odoo/odoo.conf load --neutralize taller_prueba /var/backups/taller.zip
```

```text
Restoring /var/backups/taller.zip...
INFO ? odoo.service.db: RESTORING DB: taller_prueba
INFO ? odoo.modules.neutralize: Neutralization finished
INFO ? odoo.modules.loading: loading 29 modules...
INFO ? odoo.registry: Registry loaded in 0.676s
INFO ? odoo.service.db: RESTORE DB: taller_prueba
```

Ocho segundos para una base chica. Para la tuya va a ser más, y **cuánto más es justamente uno de los datos que venís a buscar**.

Tres cosas de ese comando:

**Se niega a pisar una base que existe.** Si `taller_prueba` ya está, aborta y te lo dice. Hay un `--force` que la borra antes, pero el default es el seguro: nada de restaurar encima de producción por un nombre mal tipeado.

**`load` solo acepta el ZIP.** Si le pasás un `pg_dump -Fc` te manda a usar `pg_restore` directo, que para ese formato es lo correcto.

**Ese `--neutralize` no es opcional.** Es la mitad de esta lección.

## Qué hace neutralizar

Restaurar una copia de producción en otro lado tiene un riesgo que se subestima: **esa copia cree que es producción**. Tiene las credenciales del SMTP, los crons activos, los webhooks apuntando a los sistemas reales.

Arrancala sin pensar y mandás correos de verdad a clientes de verdad desde una base de pruebas.

Odoo trae un comando dedicado:

```bash Terminal
odoo-bin neutralize -d taller_prueba
```

Y uno para ver qué va a hacer antes de hacerlo, que es el que conviene correr primero:

```bash Terminal
odoo-bin neutralize -d taller_prueba --stdout
```

Lo que ejecuta el módulo `base` —no es un misterio, está en `base/data/neutralize.sql`—:

```sql base/data/neutralize.sql
-- desactiva los servidores de correo y les borra las credenciales
UPDATE ir_mail_server SET active = false, smtp_user = NULL, smtp_pass = NULL;

-- y mete uno falso, para que no caiga en el de la línea de comandos
INSERT INTO ir_mail_server(name, smtp_port, smtp_host, smtp_encryption, active, smtp_authentication)
VALUES ('neutralization - disable emails', 1025, 'invalid', 'none', true, 'login');

-- desactiva todos los crons menos el autovacuum
UPDATE ir_cron SET active = false WHERE id NOT IN (...autovacuum_job...);

-- la bandera
INSERT INTO ir_config_parameter (key, value) VALUES ('database.is_neutralized', true) ...;

-- desactiva los webhooks
UPDATE ir_act_server SET webhook_url = 'neutralization - disable webhook' WHERE state = 'webhook';

-- y el secreto de la base
UPDATE ir_config_parameter SET value = 'dummysecret' WHERE key = 'database.secret';
```

Vale la pena leer esas seis cosas una por una, porque cada una es un incidente que alguien ya tuvo:

**Borra `smtp_user` y `smtp_pass`, no solo desactiva el servidor.** Un servidor archivado sigue llevando una contraseña que funciona dentro de cada copia del dump.

**Mete un servidor falso a propósito.** Si solo desactivara los reales, Odoo caería en el que le pasaste por `--smtp-server` en la línea de comandos. El falso apunta a `invalid:1025` y lo intercepta.

**Deja vivo solo el autovacuum.** Lo medí en la restauración de arriba: de 13 crons, **quedó 1 activo**. Los otros 12 —cola de correo, notificaciones push, SMS— están apagados.

**La bandera no es decorativa.** En `ir_cron.toggle()` hay un corte explícito: si la base está neutralizada, la función devuelve sin hacer nada. Eso existe para que **ningún módulo vuelva a encender un cron como efecto secundario** de instalarse o configurarse.

**Los webhooks también.** Es el que más se olvida: una regla de automatización que postea a un sistema externo no manda correos, pero igual toca el mundo real.

Y lo que conviene saber de memoria:

| | |
|---|---|
| `odoo-bin db load --neutralize` | neutraliza **antes** de que los crons vean la base |
| `odoo-bin neutralize -d x` | neutraliza una base ya restaurada |

La diferencia importa. En la primera, la neutralización corre dentro del mismo proceso de restauración, antes de que la base sea visible para ningún worker de cron. En la segunda hay una ventana entre que la base existe y que vos corrés el comando — y si tenés un Odoo apuntando a ese servidor con `max_cron_threads > 0`, esa ventana alcanza para mandar correos.

**Usá la primera.** La segunda es para cuando ya es tarde.

Y además: **77 módulos del core traen su propio `neutralize.sql`**. Pasarelas de pago, facturación electrónica, Peppol, almacenamiento en la nube. Cada uno apaga lo suyo. Por eso neutralizar con el comando es mejor que un `UPDATE` tuyo a mano: cubre cosas que ni sabés que están instaladas.

## El UUID

Hay un detalle silencioso. Lo verifiqué comparando las dos bases después de restaurar:

```text
curso           uuid: 0d938f1e-c50c…
curso_restore   uuid: 27f6d3a8-c54a…
```

**El restore regenera el `database.uuid` por defecto.** Es a propósito: dos bases con el mismo UUID se pisan en cualquier servicio que las identifique por ahí.

Si lo que estás haciendo es *mover* la base a otro servidor —no copiarla— querés conservarlo:

```bash Terminal
odoo-bin db load --move taller /var/backups/taller.zip
```

La regla simple: **copia → UUID nuevo** (el default), **mudanza → `--move`**.

## La lista de verificación

Que el comando termine sin error no alcanza. Lo que hay que mirar:

```python odoo shell -d taller_prueba
# ¿están los registros?
print(env["service.order"].search_count([]))
print(env["res.partner"].search_count([]))
```

```python
# ¿están los adjuntos de verdad, o solo las referencias?
faltan = 0
for a in env["ir.attachment"].search([("store_fname", "!=", False)], limit=200):
    if not a.raw:
        faltan += 1
print("adjuntos rotos en la muestra:", faltan)
```

Esa segunda es **la prueba que justifica toda la lección**. Leer `a.raw` va al disco a buscar el archivo. Si el filestore no entró en el backup, ese contador no da cero, y te enterás hoy y no el día del incidente.

Después, cinco minutos en la interfaz:

| | |
|---|---|
| Entrar con un usuario real | ☐ |
| Abrir una orden de servicio y ver sus líneas | ☐ |
| Imprimir el PDF de la orden | ☐ |
| Ver la imagen de un producto | ☐ |
| Descargar un adjunto | ☐ |
| Confirmar que el banner de modo desarrollador no aparece donde no toca | ☐ |

El PDF y la imagen son los que destapan el filestore faltante en diez segundos.

## Cada cuánto

**Después de cada cambio en la infraestructura** — versión de PostgreSQL, del servidor, del script de backup.

**Y una vez por trimestre aunque no haya cambiado nada**, porque las cosas se rompen solas: un volumen que se desmontó, un permiso que cambió, un disco que se llenó.

Es media hora. La alternativa es descubrirlo el día que no tenés media hora.

## Lo que medís mientras tanto

Aprovechá el ensayo para anotar dos números:

**Cuánto tarda el restore.** Es tu tiempo de recuperación real. Si el backup pesa 40 GB y restaurarlo son tres horas, eso es lo que dura la caída — y es un dato que tenés que decirle al cliente *antes*, no durante.

**Cuánto se pierde.** Entre el último backup y el momento del incidente. Con un backup diario a las 3am y una caída a las 5pm, son catorce horas de trabajo.

Esos dos números son la conversación que tenés que tener con quien decide. Si catorce horas es inaceptable, la respuesta no es un script mejor: es más frecuencia o archivado de WAL, y las dos cuestan.

## Automatizarlo del todo

Lo que separa un procedimiento de una intención:

```bash scripts/probar-restore.sh
#!/usr/bin/env bash
set -euo pipefail

ULTIMO=$(ls -t /var/backups/odoo/*.zip | head -1)
BASE="prueba_$(date +%F)"

odoo-bin db -c /etc/odoo/odoo.conf load --force --neutralize "$BASE" "$ULTIMO"

ORDENES=$(odoo-bin shell -d "$BASE" --no-http <<< 'print(env["service.order"].search_count([]))' | tail -1)
echo "órdenes restauradas: $ORDENES"
[ "$ORDENES" -gt 0 ] || { echo "RESTORE VACÍO"; exit 1; }

odoo-bin db -c /etc/odoo/odoo.conf drop "$BASE"
echo "restore verificado: $ULTIMO"
```

Un cron semanal con eso y un aviso si falla, y el problema está resuelto de verdad.

Dos cuidados: **que corra en un servidor que no es el de producción** —restaurar consume CPU y disco—, y que el nombre de la base de prueba no pueda colisionar nunca con la real. Un `--force` con el nombre equivocado hace exactamente lo que dice.

> **Quedate con esto**
> `odoo-bin db load --neutralize` restaura y neutraliza en el mismo proceso, **antes** de que los crons puedan ver la base; neutralizar después deja una ventana en la que se mandan correos reales. La neutralización borra las credenciales del SMTP, mete un servidor falso para tapar el de la línea de comandos, apaga todos los crons menos el autovacuum y los webhooks. El restore regenera el UUID salvo que pases `--move`. Y la prueba que de verdad importa es leer `attachment.raw`: si el filestore no entró, ahí se ve.
