---
title: "Particiones y crecer un disco en caliente"
description: GPT contra MBR, particionar sin interactuar con sgdisk, y el procedimiento para agrandar un disco de la nube sin apagar el servidor.
date: 2026-10-19
topic: Infraestructura
tags: [linux, almacenamiento]
goal: Particionar un disco nuevo y agrandar uno existente sin downtime.
course: linux-administracion
section: almacenamiento
order: 2
---

Una partición es una porción de un disco que el sistema trata como un disco aparte. La tabla de particiones, al principio del disco, dice dónde empieza y termina cada una.

## GPT, siempre

| | MBR | GPT |
|---|---|---|
| Tamaño máximo de disco | 2 TB | Prácticamente sin límite |
| Particiones | 4 primarias | 128 |
| Copia de la tabla | No | Sí, al final del disco |
| Necesario para | BIOS legacy | UEFI |

En un disco nuevo, GPT. MBR aparece en servidores viejos y en discos que vinieron así.

## Particionar

`fdisk` y `gdisk` son interactivos; `parted` y `sgdisk` se pueden usar en scripts. Con `sgdisk`, una partición de 1 GB para datos:

```bash Terminal
sudo sgdisk --new=1:0:+1G --typecode=1:8300 --change-name=1:datos /dev/sdb
sudo partprobe /dev/sdb
```

`--new=1:0:+1G` es «partición 1, empezando en el primer lugar libre, de 1 GB». `8300` es el código de «Linux filesystem».

```text Terminal · sgdisk --print /dev/sdb
Number  Start (sector)    End (sector)  Size       Code  Name
   1            2048         2099199   1024.0 MiB  8300  datos
```

`partprobe` le pide al kernel que relea la tabla. Si el disco está en uso, a veces hace falta `partx -u /dev/sdb` en su lugar.

### ¿Hace falta particionar?

Para un disco de datos que va entero a un solo uso, no. Podés hacer `mkfs.ext4 /dev/sdb` sobre el disco completo, o mejor, usarlo con [LVM](/blog/linux/lvm). Particionar tiene sentido en el disco de arranque, que necesita partición EFI y `/boot`, o cuando el disco se reparte.

## Crecer un disco en caliente

La situación más común en la nube: el disco de 20 GB se queda corto, lo agrandás a 40 en la consola del proveedor, y adentro del servidor sigue diciendo 20. Hay tres capas y cada una se agranda por separado:

```text Las tres capas
disco (20 → 40 GB)  →  partición (sigue en 20)  →  sistema de archivos (sigue en 20)
```

En el laboratorio, un disco de 2 GB con una partición de 1 GB, montada y en uso:

```text Terminal · df -h /srv/datos
/dev/loop2p1    974M   24K  907M   1% /srv/datos
```

**1. La partición**, con `growpart`, del paquete `cloud-guest-utils`:

```text Terminal · sudo growpart /dev/sdb 1
CHANGED: partition=1 start=2048 old: size=2097152 end=2099199 new: size=4192223 end=4194270
```

Fijate el espacio entre el disco y el número de partición: es `growpart /dev/sdb 1`, no `/dev/sdb1`.

**2. El sistema de archivos**, con la herramienta de cada uno:

```bash Terminal
sudo resize2fs /dev/sdb1          # ext4
sudo xfs_growfs /srv/datos        # XFS: se le pasa el punto de montaje
```

```text Terminal · df -h /srv/datos
/dev/loop2p1    2.0G   24K  1.9G   1% /srv/datos
```

Sin desmontar y sin reiniciar. ext4 y XFS crecen montados, y es la operación de almacenamiento más segura que hay. Achicar es otra historia: ext4 lo permite desmontado, XFS no lo permite nunca.

Si el disco del sistema es la raíz con LVM, como en una instalación estándar de Ubuntu Server, hay una capa más en el medio, y es la lección siguiente.

En las imágenes cloud de Ubuntu, `cloud-init` hace los pasos 1 y 2 sobre la raíz al arrancar. Por eso a veces alcanza con reiniciar; pero no hace falta.

## Respaldar la tabla antes de tocar

```bash Terminal
sudo sgdisk --backup=/root/sdb-tabla.gpt /dev/sdb      # guardar
sudo sgdisk --load-backup=/root/sdb-tabla.gpt /dev/sdb # restaurar
```

Un `sgdisk --zap-all` o un `mkfs` sobre el disco equivocado son los errores más caros de esta sección. Antes de cualquier comando destructivo: `lsblk`, mirá dos veces el nombre, y si podés, el tamaño, que es más difícil de confundir.

> **Quedate con esto**
> GPT en todo disco nuevo, con `sgdisk` o `parted` cuando lo hacés en un script. Para un disco de datos de un solo uso, no hace falta particionar. Crecer en caliente son dos pasos, `growpart disco número` y después `resize2fs` o `xfs_growfs`, sin desmontar. Achicar XFS es imposible. Y antes de cualquier comando destructivo, `lsblk` y mirá el tamaño.
