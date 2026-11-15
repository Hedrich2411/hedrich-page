---
title: "Cuando el servidor no arranca"
description: Un fstab roto llevado al modo emergencia en una VM real y reparado desde la consola serie, más GRUB, el modo rescate, la contraseña de root y la técnica de la instancia de rescate en la nube.
date: 2026-10-19
topic: Infraestructura
tags: [linux, recuperacion, systemd, grub]
goal: Recuperar un servidor que no arranca sin reinstalarlo.
course: linux-administracion
section: recuperacion
order: 4
---

Todo lo de esta lección se probó rompiendo a propósito la VM de la [lección de KVM](/blog/linux/kvm), con su consola serie grabada en un archivo. La causa más común de un servidor que no vuelve después de un reinicio no es el hardware: es un cambio de configuración que nadie probó con un reinicio.

## Primero: ¿hasta dónde llegó?

Las [etapas del arranque](/blog/linux/arranque) dicen dónde buscar:

| Ves | Etapa | Causa típica |
|---|---|---|
| Nada, o «no bootable device» | Firmware | Disco equivocado, partición EFI dañada |
| `grub>` o `grub rescue>` | GRUB | `grub.cfg` roto, disco cambiado |
| *Kernel panic*, «unable to mount root fs» | Kernel | Falta un driver en el initramfs, la raíz cambió de UUID |
| Una shell `(initramfs)` | initramfs | La raíz no aparece: disco, RAID o cifrado |
| «You are in emergency mode» | systemd | fstab, un servicio crítico |
| Arranca, pero sin red o sin SSH | systemd | netplan, firewall, sshd |

En un servidor físico eso se ve en la pantalla. En la nube, en la **consola serie** del proveedor: EC2 Serial Console en AWS, *Serial console* en Azure, la consola web en DigitalOcean o Hetzner. Conviene saber dónde está **antes** de necesitarla.

## El caso: un fstab que apunta a la nada

Se agregó una línea para un disco que no existe, sin `nofail`:

```text /etc/fstab · La línea que rompe
UUID=00000000-0000-0000-0000-000000000000  /srv/datos  ext4  defaults  0  2
```

`findmnt --verify` lo hubiera avisado, junto con algo que suele pasar desapercibido:

```text Terminal · sudo findmnt --verify
   [E] unreachable on boot required source: UUID=00000000-0000-0000-0000-000000000000
   [W] your fstab has been modified, but systemd still uses the old version;
       use 'systemctl daemon-reload' to reload
```

Se reinició igual. En la consola serie:

```text Consola serie
[ TIME ] Timed out waiting for device dev-d…000000-0000-0000-0000-000000000000.
[DEPEND] Dependency failed for srv-datos.mount - /srv/datos.
[DEPEND] Dependency failed for local-fs.target - Local File Systems.
[  OK  ] Started emergency.service - Emergency Shell.
[  OK  ] Reached target emergency.target - Emergency Mode.
You are in emergency mode. After logging in, type "journalctl -xb" to view
system logs, "systemctl reboot" to reboot, or "exit"
to continue bootup.
Press Enter for maintenance
(or press Control-D to continue):
```

systemd esperó 90 segundos al disco y, como un montaje obligatorio falló, no siguió: modo emergencia. Sin red, sin SSH.

### Reparar

Con Enter, una shell de root en la consola:

```text Consola serie
root@facturacion-01:~# findmnt / -o TARGET,OPTIONS
/ rw,relatime,discard,errors=remount-ro,commit=30
root@facturacion-01:~# mount -o remount,rw /
root@facturacion-01:~# sed -i "/00000000-0000/s/^/# /" /etc/fstab && grep -n 0000 /etc/fstab
4:# UUID=00000000-0000-0000-0000-000000000000  /srv/datos  ext4  defaults  0  2
root@facturacion-01:~# systemctl daemon-reload && systemctl default
Ubuntu 24.04.5 LTS facturacion-01 ttyS0
facturacion-01 login:
```

El procedimiento, en general:

1. **Ver qué falló:** `journalctl -xb -p err`.
2. **Raíz en escritura**, si está en solo lectura: `mount -o remount,rw /`. Acá ya lo estaba; muchas veces no.
3. **Corregir:** comentar la línea, no borrarla, para acordarte después de qué era.
4. **`systemctl daemon-reload`**, porque systemd genera sus unidades de montaje desde fstab al arrancar y sigue con las viejas.
5. **`systemctl default`** sigue el arranque normal sin reiniciar.

### La contraseña de root

En esta imagen, root no tiene contraseña: `getent shadow root` muestra `root:*`. El modo emergencia dio la shell igual. Depende de la distribución y la configuración: en otras, con root bloqueado, el mensaje es otro:

```text Consola
Cannot open access to console, the root account is locked.
```

y no hay shell. Ahí se entra por GRUB.

Un detalle de seguridad que se desprende: **quien tiene la consola tiene root**. La consola serie de la nube se protege con los permisos de la cuenta del proveedor, como cualquier otra puerta.

## Entrar por GRUB

Las imágenes cloud traen `GRUB_TIMEOUT=0`: el menú no aparece. Para verlo, mantené **Shift** (BIOS) o apretá **Esc** (UEFI) durante el arranque, desde la consola. Mejor todavía, subí el timeout en un servidor que importa, como en la [lección de arranque](/blog/linux/arranque).

En el menú, `e` edita la entrada. En la línea que empieza con `linux`, al final, se agrega un parámetro y `Ctrl+X` arranca con él, solo esta vez:

| Parámetro | Lleva a |
|---|---|
| `systemd.unit=rescue.target` | Modo rescate: monousuario, discos montados, sin red |
| `systemd.unit=emergency.target` | Modo emergencia: lo mínimo |
| `init=/bin/bash` | Una shell directa, sin systemd y sin pedir contraseña |
| `rd.break` | En RHEL y Rocky: una shell dentro del initramfs, antes de montar la raíz |

### Resetear la contraseña de root

Con `init=/bin/bash` en Ubuntu:

```bash Consola
mount -o remount,rw /
passwd root
sync
exec /sbin/init
```

En RHEL y Rocky, con `rd.break`, la raíz real está en `/sysroot` y hay un paso más por SELinux:

```bash Consola
mount -o remount,rw /sysroot
chroot /sysroot
passwd root
touch /.autorelabel
exit
exit
```

`/.autorelabel` hace que SELinux vuelva a etiquetar los archivos en el próximo arranque, porque el `/etc/shadow` nuevo se escribió sin contexto. Sin eso, nadie puede iniciar sesión. El reetiquetado tarda varios minutos; es normal.

## Sin consola: la instancia de rescate

Si el proveedor no tiene consola serie, o el problema es antes de que haya consola, la técnica es la misma en todas las nubes:

1. Apagar la VM rota.
2. Desconectar su disco y conectarlo como **segundo disco** a otra VM sana.
3. En la sana: montarlo, `mount /dev/vdb1 /mnt`, y corregir `/mnt/etc/fstab`, `/mnt/etc/ssh/...` o lo que esté mal.
4. Desmontar, volver a conectar el disco a la VM original, arrancar.

Cuidado en el paso 3 con los **clones**: si la VM sana se creó de la misma imagen, los dos discos tienen la misma etiqueta y el mismo UUID de sistema de archivos. Conectalo con la sana ya arrancada, y montá por dispositivo, no por `LABEL=`.

Para problemas de GRUB o del initramfs, desde la sana hace falta un `chroot`:

```bash Terminal · En la VM de rescate, con el disco roto en /dev/vdb
sudo mount /dev/vdb1 /mnt
sudo mount /dev/vdb16 /mnt/boot
for d in dev proc sys run; do sudo mount --bind /$d /mnt/$d; done
sudo chroot /mnt
update-initramfs -u && update-grub
```

Dentro del `chroot`, los comandos operan sobre el sistema roto como si hubiera arrancado.

## Prevenir

- `findmnt --verify` y `mount -a` después de tocar fstab; `nofail` en lo que puede faltar.
- `netplan try` para la red, una segunda sesión SSH para sshd y el firewall.
- Un snapshot antes de cambios en el arranque, el kernel o los discos.
- Probar un reinicio **en horario de trabajo** después de cambios de ese tipo, no esperar al reinicio del parche de seguridad de las 4 de la mañana.

> **Quedate con esto**
> Identificá la etapa en la que se quedó; en la nube, por la consola serie, que conviene ubicar antes de necesitarla. Un fstab roto lleva a modo emergencia: raíz en escritura, comentar la línea, `daemon-reload` y `systemctl default`. Si no hay shell, GRUB con `systemd.unit=rescue.target` o `init=/bin/bash`; en Rocky, `rd.break` y `/.autorelabel`. Sin consola, el disco en una VM de rescate. Y después de cualquier cambio en el arranque, un reinicio de prueba en horario de trabajo.
