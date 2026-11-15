---
title: "Discos, sistemas de archivos y fstab"
description: Cómo se llaman los discos, qué sistema de archivos elegir, montar por UUID y validar el fstab antes de que un reinicio te deje en modo emergencia.
date: 2026-10-19
topic: Infraestructura
tags: [linux, almacenamiento]
goal: Agregar un disco nuevo a un servidor y dejarlo montado de forma que sobreviva a los reinicios.
course: linux-administracion
section: almacenamiento
order: 1
---

PostgreSQL va a crecer. Lo sano es que sus datos vivan en un disco aparte del sistema: si se llena, el sistema sigue funcionando; si hay que agrandarlo o moverlo, no se toca la raíz.

En el laboratorio los discos son archivos conectados como dispositivos de bloque con `losetup`; en una VM o en la nube son discos de verdad, y los comandos son los mismos.

## Cómo se llaman

| Nombre | Qué es |
|---|---|
| `/dev/sda`, `/dev/sdb` | Discos SATA, SAS o USB, y los de muchas nubes |
| `/dev/nvme0n1` | El primer disco NVMe; `nvme1n1` el segundo |
| `/dev/vda` | Disco virtio en una VM de KVM |
| `/dev/sda1`, `/dev/nvme0n1p1` | Su primera partición |
| `/dev/loop0` | Un archivo usado como disco |
| `/dev/mapper/datos-postgres` | Un volumen de LVM o un disco cifrado |

**Los nombres no son estables.** El disco que hoy es `sdb` puede ser `sdc` mañana si agregás otro, o si la nube los presenta en otro orden. Por eso no se usan en la configuración.

```text Terminal · lsblk
NAME     SIZE TYPE FSTYPE MOUNTPOINTS
vda       10G disk
├─vda1     9G part ext4   /
├─vda14    4M part
├─vda15  106M part vfat   /boot/efi
└─vda16  913M part ext4   /boot
```

`lsblk` es la primera mirada a cualquier servidor: qué discos hay, cómo están partidos y dónde está montado cada uno.

## Qué sistema de archivos

| | ext4 | XFS | Btrfs |
|---|---|---|---|
| Por defecto en | Ubuntu, Debian | RHEL, Rocky | Fedora, SUSE |
| Crecer en caliente | Sí | Sí | Sí |
| Achicar | Sí, desmontado | **No** | Sí |
| Fuerte en | Uso general, robusto | Archivos grandes, mucho paralelismo | Snapshots y compresión propios |

Para un servidor, ext4 o XFS, y elegir el de la distribución es lo más seguro. XFS es excelente para bases de datos, pero no se puede achicar nunca; si dudás de cuánto espacio vas a necesitar, empezá chico y crecé.

## Formatear y montar

```bash Terminal
sudo mkfs.ext4 -L datos /dev/sdb1
sudo blkid /dev/sdb1
```

```text Terminal
/dev/loop2p1: LABEL="datos" UUID="e54c79d8-f847-4d38-9f77-f805af0955c2" BLOCK_SIZE="4096" TYPE="ext4" PARTLABEL="datos" PARTUUID="eacafaf5-a1d7-4830-b7a3-80837a3ebd79"
```

El **UUID** es el identificador del sistema de archivos: no cambia aunque el disco cambie de nombre. Es lo que va en la configuración.

```bash Terminal
sudo mkdir -p /srv/datos
sudo mount /dev/sdb1 /srv/datos
findmnt /srv/datos
```

```text Terminal
TARGET     SOURCE       FSTYPE OPTIONS
/srv/datos /dev/loop2p1 ext4   rw,relatime
```

## fstab

`mount` a mano dura hasta el próximo reinicio. Para que sea permanente, una línea en `/etc/fstab`:

```text /etc/fstab
UUID=e54c79d8-f847-4d38-9f77-f805af0955c2  /srv/datos  ext4  defaults,noatime  0  2
```

| Campo | Valor | Significa |
|---|---|---|
| 1 | `UUID=...` | Qué montar |
| 2 | `/srv/datos` | Dónde |
| 3 | `ext4` | Tipo |
| 4 | `defaults,noatime` | Opciones; `noatime` no escribe la fecha de acceso en cada lectura |
| 5 | `0` | Para `dump`, que ya nadie usa |
| 6 | `2` | Orden de revisión con `fsck` al arrancar: `1` la raíz, `2` el resto, `0` nunca |

### Un fstab mal escrito no arranca

Si una línea de fstab apunta a algo que no existe, systemd no puede montar un sistema de archivos que considera obligatorio, y el arranque termina en **modo emergencia**: una shell de root en la consola, sin red y sin SSH. En un servidor en la nube, eso significa entrar por la consola serie del proveedor, si la tiene.

Por eso, después de tocar fstab, antes de reiniciar:

```text Terminal · sudo findmnt --verify
0 parse errors, 2 errors, 0 warnings
/srv/backups
   [E] unreachable on boot required target: No such file or directory
   [E] unreachable on boot required source: UUID=00000000-0000-0000-0000-000000000000
```

Y `sudo mount -a` intenta montar todo lo que falta: si da error, también lo va a dar al arrancar.

Para un disco que puede no estar, como uno externo o uno de red, `nofail` en las opciones: si no aparece, el arranque sigue sin él.

```text /etc/fstab
UUID=...  /srv/backups  ext4  defaults,nofail  0  2
```

## tmpfs

Un sistema de archivos en memoria. Rapidísimo, y se vacía al reiniciar:

```text /etc/fstab
tmpfs  /srv/facturacion/cache  tmpfs  size=256m,mode=0750,uid=facturacion,gid=facturacion  0  0
```

`size` es un tope, no una reserva: solo ocupa la memoria que se usa.

## Discos que no se ven

Si agregaste un disco a una VM en caliente y no aparece en `lsblk`:

```bash Terminal
echo "- - -" | sudo tee /sys/class/scsi_host/host*/scan
```

Para discos NVMe y virtio suele aparecer solo. Y `dmesg | tail` muestra lo que el kernel vio al conectarlo.

> **Quedate con esto**
> Los nombres como `sdb` no son estables; en la configuración, siempre `UUID=`. ext4 o XFS, y XFS no se achica. fstab tiene seis campos y un error en él manda el arranque a modo emergencia, así que `findmnt --verify` y `mount -a` antes de reiniciar, y `nofail` para lo que puede faltar.
