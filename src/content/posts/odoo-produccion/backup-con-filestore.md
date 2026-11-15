---
title: "Un backup que incluye el filestore"
description: Por qué el dump de la base no alcanza, y qué más hay que copiar.
date: 2026-10-11
topic: ERP
tags: [odoo, postgresql, backups]
goal: Una copia que sirve para restaurar de verdad.
course: odoo-produccion
section: backups
order: 1
---

Esto viene anunciándose desde la primera lección del curso de backend: **el filestore no está en PostgreSQL**.

Es el error de backup más común en Odoo, y el peor, porque no se descubre hasta el día de restaurar.

## Las dos mitades

| Mitad | Qué guarda | Dónde |
|---|---|---|
| **La base** | registros, configuración, vistas, permisos | PostgreSQL |
| **El filestore** | adjuntos, imágenes de productos, logos, PDFs guardados | `data_dir`, en el disco |

Odoo guarda los archivos binarios **fuera** de la base, y en la base deja solo una referencia con el hash del contenido.

Un backup de solo la base restaura perfecto, arranca, y todo parece bien — hasta que alguien abre un presupuesto con el logo roto, o un adjunto que no se descarga. Cientos de referencias apuntando a archivos que no existen.

Y no hay forma de recuperarlos después.

```ini config/odoo.conf
data_dir = /var/lib/odoo
```

En el compose, eso es el volumen `odoo-data`.

## El script

```bash scripts/backup.sh
#!/usr/bin/env bash
set -euo pipefail

BASE="taller"
DESTINO="/var/backups/odoo"
FECHA=$(date +%F-%H%M)
DIR="$DESTINO/$BASE-$FECHA"

mkdir -p "$DIR"

# 1. la base, en formato comprimido de PostgreSQL
docker compose exec -T db pg_dump -U odoo -Fc "$BASE" > "$DIR/db.dump"

# 2. el filestore de esa base
docker compose exec -T odoo tar czf - -C /var/lib/odoo/filestore "$BASE" > "$DIR/filestore.tar.gz"

# 3. la configuración y los módulos propios
tar czf "$DIR/config.tar.gz" ./config ./addons

# 4. que el backup se pueda verificar
sha256sum "$DIR"/* > "$DIR/SHA256SUMS"

# 5. limpiar los viejos
find "$DESTINO" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +

echo "backup completo en $DIR"
du -sh "$DIR"
```

Las decisiones de ese script:

**`-Fc`** es el formato comprimido de PostgreSQL. Ocupa menos que un SQL plano y, más importante, **permite restaurar tablas sueltas** y restaurar en paralelo.

**El filestore de esa base nada más.** El directorio `filestore/` tiene una carpeta por base; copiar la de la base que estás respaldando mantiene el backup coherente.

**`set -euo pipefail`** corta el script ante el primer error. Sin eso, un `pg_dump` que falla deja un archivo vacío y el script sigue como si nada — y vos tenés un backup de cero bytes que no vas a mirar hasta que lo necesites.

**Los hashes.** Es lo que te deja comprobar que el archivo no se corrompió en el camino.

## Automatizarlo

```bash Terminal · crontab
0 3 * * * /opt/taller/scripts/backup.sh >> /var/log/odoo-backup.log 2>&1
```

Y lo que casi nadie hace: **enterarte si falló**.

```bash scripts/backup.sh · al final
if [ ! -s "$DIR/db.dump" ]; then
    curl -s -X POST "$WEBHOOK_URL" -d "El backup de $BASE falló el $FECHA"
    exit 1
fi
```

Un cron que falla en silencio durante tres meses es peor que no tener backup, porque creés que lo tenés.

Como mínimo, un chequeo semanal de que el archivo más reciente existe y pesa lo que debería.

## Dónde guardarlos

**No en el mismo servidor.** Un backup en el disco que se quemó no es un backup. Si el servidor se pierde entero —hardware, un borrado, un cifrado— los backups se van con él.

La regla clásica sigue vigente: **tres copias, dos medios, una fuera del sitio**.

```bash scripts/backup.sh · sincronizar afuera
rclone sync "$DESTINO" "remoto:backups-odoo" --max-age 30d
```

A un bucket, a otro servidor, a donde sea que no esté en la misma máquina.

Y una advertencia sobre el destino: **un backup es una copia completa de los datos de tus clientes**. Va cifrado y con acceso restringido, no en una carpeta compartida.

## Cada cuánto

Depende de cuántas horas de trabajo podés permitirte perder:

| Frecuencia | Perdés hasta |
|---|---|
| Diario | un día |
| Cada 6 horas | 6 horas |
| Diario + WAL archiving | minutos |

Para la mayoría de las pymes, **diario a la madrugada más retención de 30 días** es razonable.

Si un día de datos es inaceptable, lo que necesitás es *point-in-time recovery* con archivado de WAL, que es otro nivel de complejidad y vale la pena solo si el negocio lo justifica.

## La alternativa que trae Odoo 19: `odoo-bin db`

Antes de que te armes el script, Odoo 19 trae un subcomando que hace las dos mitades de una sola vez:

```bash Terminal
odoo-bin db --help
```

```text
positional arguments:
  {init,load,dump,duplicate,rename,drop}
    init        Create and initialize a database
    load        Load a dump file.
    dump        Create a dump with filestore.
    duplicate   Duplicate a database including filestore.
    rename      Rename a database including filestore.
    drop        Delete a database including filestore
```

Y arriba de esa lista, la frase que importa: **«Commands are all filestore-aware»**.

```bash Terminal
odoo-bin db -c /etc/odoo/odoo.conf dump taller /var/backups/taller.zip
```

```text
INFO ? odoo.service.db: DUMP DB: taller format zip with filestore
```

Lo que sale es un ZIP con tres cosas:

```text
dump.sql        la base
filestore/      los adjuntos
manifest.json   versión de Odoo, de PostgreSQL y de cada módulo instalado
```

Ese `manifest.json` es la pieza que el script casero no tiene, y vale más de lo que parece:

```json manifest.json
{
    "odoo_dump": "1",
    "db_name": "taller",
    "version": "19.0",
    "major_version": "19.0",
    "pg_version": "17.0",
    "modules": { "base": "19.0.1.3", "mail": "19.0.1.0", "...": "..." }
}
```

**Te dice de qué versión salió el backup y con qué versión exacta de cada módulo.** El día que restaures uno de hace ocho meses, eso es la diferencia entre saber qué estás restaurando y adivinarlo. Y es lo primero que mira el proceso de migración cuando te toque subir de versión.

Dos aclaraciones:

**No es el backup de la interfaz.** El de `/web/database/manager` carga el archivo entero en memoria y, con una base grande, el worker llega a `limit_memory_hard` y el backup muere a la mitad. El de la CLI escribe directo al archivo. Y el de la interfaz, además, lo cerramos en la lección anterior con toda la razón.

**`db dump` necesita `pg_dump` en el PATH**, o `pg_path` apuntando a donde esté. Si no lo encuentra:

```text
Exception: Command `pg_dump` not found.
```

Y fijate lo que pasa cuando falla: **el archivo de salida queda creado y con cero bytes**, porque Odoo lo abre antes de ejecutar `pg_dump`. Exactamente el escenario contra el que te protege el `set -euo pipefail` del script.

### ¿Cuál de los dos?

| | `odoo-bin db dump` | El script con `pg_dump -Fc` |
|---|---|---|
| Filestore | incluido | lo agregás vos |
| Manifiesto de versiones | sí | no |
| Formato | ZIP (o `--format dump`) | `-Fc` |
| Restaurar una tabla sola | no | sí |
| Restaurar en paralelo | no | sí |
| Depende de que Odoo esté instalado | sí | no |

**Si tenés una instancia y una base, `odoo-bin db dump` y listo.** Es menos código tuyo que mantener y el manifiesto viene gratis.

El script sigue teniendo sentido cuando querés el formato `-Fc` —por el restore selectivo y el paralelo, que importan cuando la base es grande—, cuando el backup lo corre una máquina que no tiene Odoo instalado, o cuando querés la configuración y los módulos propios dentro del mismo paquete.

Lo que **no** tiene sentido es la mezcla mal hecha: un `pg_dump` a secas, sin el filestore.

## Lo que no hay que hacer

**Copiar el directorio de PostgreSQL con el servidor corriendo.** `cp -r /var/lib/postgresql/data` mientras PostgreSQL escribe produce una copia inconsistente que a veces restaura y a veces no. Para eso está `pg_dump`.

**Confiar en el snapshot del proveedor sin probarlo.** Un snapshot de disco es útil, pero restaura el servidor entero y no te deja sacar una tabla. Tenelo, pero no como único backup.

**Guardar el backup en el volumen de Docker.** Si hacés `docker compose down -v` por error, se va con todo lo demás.

## Comprobar que pesa lo que debe

```bash Terminal
ls -lh /var/backups/odoo/ | tail -5
```

Un backup que de pronto pesa la décima parte que el de ayer es una señal de alarma. Vale la pena que el script lo compare:

```bash
ANTERIOR=$(du -s "$DESTINO"/*/ 2>/dev/null | sort -rn | sed -n 2p | cut -f1)
ACTUAL=$(du -s "$DIR" | cut -f1)
if [ -n "$ANTERIOR" ] && [ "$ACTUAL" -lt $((ANTERIOR / 2)) ]; then
    echo "AVISO: el backup pesa menos de la mitad que el anterior"
fi
```

> **Quedate con esto**
> Un backup son **dos** mitades: el dump de PostgreSQL y el filestore del disco. Con solo la primera, restaurás una base llena de referencias a archivos que no existen y no hay vuelta atrás. `set -euo pipefail` para que un fallo no te deje un archivo vacío, los backups fuera del servidor, y un aviso cuando el cron falla — porque un backup que falla en silencio es peor que no tenerlo.
