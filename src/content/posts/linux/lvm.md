---
title: "LVM: volúmenes que crecen sin apagar"
description: Volúmenes físicos, grupos y lógicos. Crear el volumen de PostgreSQL, sumarle un disco y agrandarlo en caliente, y qué hace un snapshot de LVM.
date: 2026-10-19
topic: Infraestructura
tags: [linux, almacenamiento, lvm]
goal: Usar LVM para que el espacio de un servicio crezca sumando discos, sin downtime.
course: linux-administracion
section: almacenamiento
order: 3
---

Con particiones, un sistema de archivos vive en un disco. Con LVM, vive en un **volumen lógico** que puede ocupar pedazos de varios discos y crecer sumando discos nuevos, todo en caliente.

## Las tres capas

| Capa | Qué es | Comando para verla |
|---|---|---|
| PV, volumen físico | Un disco o una partición entregada a LVM | `pvs` |
| VG, grupo de volúmenes | Un «disco grande» hecho con uno o más PV | `vgs` |
| LV, volumen lógico | Lo que formateás y montás, sacado del VG | `lvs` |

```text Esquema
/dev/sdb ─┐
          ├─► VG «datos» ─► LV «postgres» ─► XFS montado en /srv/postgres
/dev/sdc ─┘
```

La instalación estándar de Ubuntu Server ya usa LVM para la raíz: `ubuntu-vg/ubuntu-lv`. Las imágenes cloud no.

## El volumen de PostgreSQL

```bash Terminal
sudo pvcreate /dev/sdb
sudo vgcreate datos /dev/sdb
sudo lvcreate -n postgres -L 1G datos
sudo mkfs.xfs /dev/datos/postgres
sudo mkdir -p /srv/postgres && sudo mount /dev/datos/postgres /srv/postgres
```

```text Terminal
$ sudo pvs
  PV         VG    Fmt  Attr PSize  PFree
  /dev/loop3 datos lvm2 a--  <2.00g 1020.00m
$ sudo vgs
  VG    #PV #LV #SN Attr   VSize  VFree
  datos   1   1   0 wz--n- <2.00g 1020.00m
$ sudo lvs
  LV       VG    Attr       LSize Pool Origin Data%  Meta%  Move Log Cpy%Sync Convert
  postgres datos -wi-ao---- 1.00g
```

Fijate que el LV usa 1 GB de los 2 del grupo. **Dejar espacio libre en el VG es a propósito**: es lo que permite crecer en segundos cuando haga falta, o crear un snapshot.

## Crecer, con un disco más

El volumen tiene datos y la base está escribiendo. Llega un disco nuevo:

```bash Terminal
sudo pvcreate /dev/sdc
sudo vgextend datos /dev/sdc
sudo lvextend -r -L +1G datos/postgres
```

```text Terminal
data blocks changed from 262144 to 524288
/dev/mapper/datos-postgres  2.0G  121M  1.9G   7% /srv/postgres
  VG    #PV #LV #SN Attr   VSize VFree
  datos   2   1   0 wz--n- 3.99g 1.99g
```

`-r` agranda también el sistema de archivos, con la herramienta que corresponda, en el mismo comando. Sin `-r`, quedan las tres capas de la [lección anterior](/blog/linux/particiones) y te tocaría correr `xfs_growfs` a mano.

`-L +1G` suma un giga; `-l +100%FREE` usa todo lo que queda en el VG.

## Mover datos entre discos

Si un disco empieza a fallar, o querés pasar a uno más rápido, LVM mueve los datos **en caliente**:

```bash Terminal
sudo pvmove /dev/sdb          # mueve todo lo de sdb a los otros PV del grupo
sudo vgreduce datos /dev/sdb  # saca sdb del grupo
sudo pvremove /dev/sdb
```

Mientras corre `pvmove`, la base sigue funcionando. Es de las cosas que hacen que valga la pena usar LVM aunque hoy tengas un solo disco.

## Snapshots

Un snapshot de LVM es una foto instantánea de un volumen. No copia los datos: guarda los bloques **originales** a medida que el volumen cambia (*copy-on-write*). Sirve para tener una versión congelada y consistente mientras hacés un backup del volumen en uso:

```bash Terminal
sudo lvcreate -s -n postgres-snap -L 2G datos/postgres
sudo mount -o ro,nouuid /dev/datos/postgres-snap /mnt/snap
sudo tar -czf /var/backups/postgres-$(date +%F).tar.gz -C /mnt/snap .
sudo umount /mnt/snap
sudo lvremove -y datos/postgres-snap
```

Tres detalles:

- **`-L 2G` es cuánto cambio aguanta.** Si mientras existe el snapshot cambian más de 2 GB del original, el snapshot se invalida. `lvs` muestra su ocupación en `Data%`.
- **Un snapshot activo hace más lentas las escrituras** del original, porque cada bloque que cambia se copia primero. Se crea, se usa y se borra; no se deja vivo.
- **`nouuid` es por XFS**, que se niega a montar dos sistemas de archivos con el mismo UUID.

Para una base de datos, el snapshot captura lo que había en disco en ese instante, como si se hubiera cortado la luz. PostgreSQL se recupera bien de eso, pero la forma correcta de respaldarla es con sus herramientas, `pg_dump` o `pg_basebackup`, que vas a ver en [backups](/blog/linux/backups). El snapshot de LVM brilla con datos que no tienen herramienta propia, o como red de seguridad antes de una actualización riesgosa.

En el laboratorio de este curso los snapshots no se pudieron probar: el kernel de Docker Desktop no trae el módulo `dm-snapshot`. Los comandos son los de la documentación de LVM y funcionan igual en cualquier servidor con un kernel de distribución.

## Cuándo usar LVM

| Situación | LVM |
|---|---|
| Servidor físico o VM con discos que vas a sumar | Sí |
| Datos que van a crecer y no sabés cuánto | Sí |
| Nube, donde el disco se agranda solo desde la consola | Opcional: `growpart` alcanza |
| Disco del sistema en una imagen cloud | No viene, y no hace falta |

> **Quedate con esto**
> LVM tiene tres capas: discos (PV), un grupo que los junta (VG) y volúmenes que se montan (LV). Dejá espacio libre en el VG. Para crecer, `vgextend` con el disco nuevo y `lvextend -r`, que agranda también el sistema de archivos, en caliente. `pvmove` saca datos de un disco sin parar nada. Y un snapshot es una foto para respaldar, no un backup: se crea, se usa y se borra.
