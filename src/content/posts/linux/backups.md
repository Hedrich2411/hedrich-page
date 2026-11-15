---
title: "Backups con restic y rsync"
description: Backups cifrados, deduplicados e incrementales a otro servidor con restic, snapshots con enlaces duros usando rsync, y por qué un dd del disco no es un backup.
date: 2026-10-19
topic: Infraestructura
tags: [linux, backups, restic]
goal: Tener backups fuera del servidor, cifrados, con política de retención y restauración probada.
course: linux-administracion
section: recuperacion
order: 2
---

El [script de backup](/blog/linux/scripts-de-administracion) deja un volcado por día en `/var/backups/facturacion`. Eso es una copia, en el mismo disco que la base. Si el disco muere o alguien entra al servidor, se va con todo. Falta sacarla de ahí.

## restic

restic hace backups **cifrados**, **deduplicados** e **incrementales** a un repositorio que puede estar en otro servidor por SFTP, en un bucket S3 o compatible, o en un disco. Lo que se guarda una vez no se vuelve a guardar, aunque aparezca en otro archivo o en otro día.

El repositorio, en el servidor de respaldo, con un usuario que solo sirve para eso:

```bash Terminal · En respaldo
sudo useradd -m -s /bin/bash restic
sudo install -d -o restic -g restic -m 700 /srv/restic
```

Y en el servidor de facturación, una clave SSH dedicada y su entrada en `~/.ssh/config` de root:

```bash Terminal · En servidor
sudo ssh-keygen -t ed25519 -N "" -C "backup@servidor" -f /root/.ssh/id_backup
```

```text /root/.ssh/config
Host respaldo
    User restic
    IdentityFile /root/.ssh/id_backup
```

La clave pública va al `authorized_keys` del usuario `restic` en el servidor de respaldo. La clave del repositorio, la que cifra, en un archivo que solo lee root:

```bash Terminal
sudo sh -c 'umask 077; head -c 32 /dev/urandom | base64 > /root/.restic-clave'
```

**Guardá una copia de esa clave fuera del servidor**, en el gestor de contraseñas del equipo. Sin ella, los backups son ruido cifrado.

```bash Terminal · Como root
export RESTIC_REPOSITORY=sftp:respaldo:/srv/restic/facturacion
export RESTIC_PASSWORD_FILE=/root/.restic-clave
restic init
```

```text Terminal
created restic repository a1cf86c950 at sftp:respaldo:/srv/restic/facturacion
```

### Respaldar

```text Terminal · restic backup --tag diario /var/backups/facturacion /etc
Files:         850 new,     0 changed,     0 unmodified
Dirs:          171 new,     0 changed,     0 unmodified
Added to the repository: 2.553 MiB (831.327 KiB stored)
snapshot 69e002df saved
```

Después de cambiar un archivo de configuración, el segundo:

```text Terminal
Files:           0 new,     1 changed,   849 unmodified
Added to the repository: 57.359 KiB (12.245 KiB stored)
snapshot 659bf731 saved
```

12 KB. Cada snapshot se ve completo, pero solo guarda lo que cambió.

```text Terminal · restic snapshots --compact
ID        Time                 Host      Tags
-----------------------------------------------
69e002df  2026-10-19 21:53:53  servidor  diario
659bf731  2026-10-19 21:53:54  servidor  diario
-----------------------------------------------
2 snapshots
```

```text Terminal · restic diff 69e002df 659bf731
M    /etc/nginx/sites-available/facturacion
Files:           0 new,     0 removed,     1 changed
```

### Restaurar

Un archivo puntual, a un directorio aparte para no pisar nada:

```text Terminal · restic restore latest --target /tmp/restaurado --include /etc/ssh/sshd_config.d/10-endurecer.conf
Summary: Restored 4 / 1 files/dirs (204 B / 204 B) in 0:00
```

`restic mount /mnt/restic` monta el repositorio como un sistema de archivos con un directorio por snapshot, para navegarlo con `ls` y copiar lo que haga falta.

### Retención

```text Terminal · restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --dry-run
Applying Policy: keep 7 daily, 4 weekly, 6 monthly snapshots
keep 2 snapshots:
```

Siete diarios, cuatro semanales y seis mensuales: medio año de historia con 17 snapshots como mucho, porque uno puede contar a la vez como diario y semanal. `--prune` libera el espacio de los datos que ya no usa ningún snapshot; sin `--dry-run`, aplica.

### Verificar

```text Terminal · restic check
no errors were found
```

`check` verifica la estructura del repositorio. Una vez por mes, `restic check --read-data-subset=10%` lee y verifica un décimo de los datos de verdad.

En el servidor de respaldo, lo que hay es ilegible sin la clave:

```text Terminal · ls /srv/restic/facturacion
config
data
index
keys
locks
snapshots
```

### En el timer

Se suma al final del script de backup, o en su propia unidad después:

```bash /usr/local/sbin/backup-facturacion · Al final
export RESTIC_REPOSITORY=sftp:respaldo:/srv/restic/facturacion
export RESTIC_PASSWORD_FILE=/root/.restic-clave
restic backup --tag diario --quiet /var/backups/facturacion /etc
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet
```

### Que el servidor no pueda borrar sus backups

Con SFTP, el servidor que respalda también puede borrar el repositorio. Si alguien lo compromete, puede llevarse los backups antes de cifrar los datos. Dos salidas:

- **rest-server en modo `--append-only`** en el servidor de respaldo: restic sube por HTTP, puede agregar snapshots pero no borrarlos. El `forget --prune` se corre desde el servidor de respaldo.
- **Un bucket con bloqueo de objetos** (S3 Object Lock o equivalente), donde los datos no se pueden borrar durante un período aunque tengas las credenciales.

## rsync con enlaces duros

Para copias de directorios que querés poder recorrer sin herramientas, rsync con `--link-dest` arma snapshots diarios que **comparten los archivos que no cambiaron** mediante [enlaces duros](/blog/linux/sistema-de-archivos):

```bash Terminal
rsync -a --delete /etc/ respaldo:/srv/rsync/2026-10-18/
rsync -a --delete --link-dest=../2026-10-18 /etc/ respaldo:/srv/rsync/2026-10-19/
```

```text Terminal · En respaldo
5.7M	2026-10-18
692K	2026-10-19
2 2026-10-18/hostname
1 2026-10-19/nginx/sites-available/facturacion
```

El segundo día ocupa una fracción, porque los archivos iguales son el mismo inodo con contador de enlaces en 2. El que cambió tiene uno solo, propio. Cada directorio se ve como una copia completa y se borra el más viejo con `rm -rf` sin afectar a los otros.

| | restic | rsync `--link-dest` |
|---|---|---|
| Cifrado | Sí | No |
| Deduplicación | Por bloques, entre archivos | Por archivo completo |
| Restaurar | Con restic | `cp` |
| A la nube | S3, B2, Azure, GCS | Solo destinos con SSH o montados |

## dd no es un backup

`dd if=/dev/sda of=disco.img` copia el disco bloque a bloque. Sirve para clonar un disco antes de una operación arriesgada o para analizar uno que falla. Como backup, no:

- Copia un sistema de archivos **en uso**, que puede quedar inconsistente.
- Ocupa el tamaño del disco entero, con el espacio vacío incluido.
- No tiene historia: un solo punto en el tiempo.

Para clonar en serio, en frío y desde un sistema arrancado aparte, hay herramientas como Clonezilla. Para backups, lo de arriba.

> **Quedate con esto**
> Un backup en el mismo disco es una copia; fuera del servidor recién es un backup. restic cifra, deduplica y guarda solo lo que cambió, a SFTP o a un bucket; su clave va también fuera del servidor. Retención con `forget --keep-*`, verificación con `check`, y que el servidor no pueda borrar sus propios backups. rsync con `--link-dest` da snapshots navegables. Y `dd` clona discos, no hace backups.
