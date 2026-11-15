---
title: "Qué pasa entre el botón de encendido y el login"
description: Firmware, GRUB, kernel, initramfs y systemd. El recorrido completo del arranque y dónde se configura cada etapa.
date: 2026-10-19
topic: Infraestructura
tags: [linux, systemd, grub]
goal: Conocer las etapas del arranque para saber dónde mirar cuando una falla.
course: linux-administracion
section: fundamentos
order: 2
---

Saber cómo arranca Linux parece teoría hasta el día en que un servidor no levanta. Ese día, lo único que importa es saber **en qué etapa se quedó**, porque cada una se arregla en un lugar distinto.

Las salidas de esta lección son de una VM real con Ubuntu 24.04 creada con libvirt, la misma de la [lección de KVM](/blog/linux/kvm).

## Las cinco etapas

| Etapa | Qué hace | Si falla, ves |
|---|---|---|
| 1. Firmware (UEFI o BIOS) | Prueba el hardware y busca un disco arrancable | Nada en pantalla o «no bootable device» |
| 2. Gestor de arranque (GRUB) | Muestra el menú, carga el kernel y el initramfs | `grub>` o `grub rescue>` |
| 3. Kernel | Inicializa el hardware y monta la raíz | *Kernel panic*, «VFS: unable to mount root fs» |
| 4. initramfs | Sistema mínimo en memoria con los drivers para llegar a la raíz real | Una shell `(initramfs)` |
| 5. systemd | Levanta servicios, monta discos, abre el login | *Emergency mode* o servicios caídos |

## Firmware

Un servidor moderno usa **UEFI**: lee la partición EFI (FAT32, montada en `/boot/efi`) y ejecuta el gestor de arranque que encuentre ahí. El viejo **BIOS** lee los primeros sectores del disco. Para saber cuál tenés:

```bash Terminal
[ -d /sys/firmware/efi ] && echo UEFI || echo "BIOS (legacy)"
```

La VM del laboratorio da `BIOS (legacy)`, que es lo que usa libvirt por defecto; en la mayoría del hardware actual vas a ver `UEFI`.

## GRUB

GRUB lee su configuración de `/boot/grub/grub.cfg`, que **no se edita a mano**: se genera a partir de `/etc/default/grub` y de los scripts de `/etc/grub.d/`.

```bash /etc/default/grub · Lo que importa
GRUB_DEFAULT=0
GRUB_TIMEOUT_STYLE=hidden
GRUB_TIMEOUT=0
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""
```

Después de cambiar algo, se regenera:

```bash Terminal
sudo update-grub                                   # Ubuntu y Debian
sudo grub2-mkconfig -o /boot/grub2/grub.cfg        # familia Red Hat
```

Una trampa que muestra la VM: las imágenes cloud traen archivos en `/etc/default/grub.d/` que **pisan** a `/etc/default/grub`:

```text Terminal · /etc/default/grub.d/50-cloudimg-settings.cfg
GRUB_RECORDFAIL_TIMEOUT=0
GRUB_TIMEOUT=0
GRUB_CMDLINE_LINUX_DEFAULT="console=tty1 console=ttyS0"
GRUB_TERMINAL=console
```

Por eso el kernel no arrancó con `quiet splash` sino con la consola serie:

```text Terminal · cat /proc/cmdline
BOOT_IMAGE=/vmlinuz-6.8.0-147-generic root=PARTUUID=ba1c44fb-69af-47e1-9c42-526851717124 ro console=tty1 console=ttyS0 panic=-1
```

Si agregás un parámetro en `/etc/default/grub` y no aparece en `/proc/cmdline` después de reiniciar, buscá en `grub.d/`.

`GRUB_TIMEOUT=0` también significa que **no vas a ver el menú**. En una VM o un servidor con consola remota, conviene subirlo a 3 o 5 segundos: es la única forma de entrar a modo rescate cuando algo se rompe, como vas a ver en [cuando el servidor no arranca](/blog/linux/arranque-que-falla).

## Kernel e initramfs

```text Terminal · ls /boot
System.map-6.8.0-147-generic
config-6.8.0-147-generic
efi
grub
lost+found
microcode.cpio
vmlinuz
vmlinuz-6.8.0-147-generic
vmlinuz.old
```

`vmlinuz-*` es el kernel, y `vmlinuz` un enlace al actual. En una instalación normal hay al lado un `initrd.img-*`: el **initramfs**, un sistema de archivos mínimo que se carga en memoria con los drivers necesarios para llegar a la raíz real, como los de una controladora RAID o un disco cifrado. Se regenera solo cuando instalás un kernel o un módulo nuevo; a mano es `update-initramfs -u` en Ubuntu o `dracut -f` en Red Hat.

Las imágenes cloud mínimas, como la de la VM, arrancan sin initramfs: sus drivers virtio vienen dentro del kernel. Por eso la raíz se indica con `root=PARTUUID=...`, que el kernel resuelve solo.

`vmlinuz.old` es el kernel anterior. Ubuntu conserva uno o dos por si el nuevo falla, y GRUB los ofrece en «Advanced options».

## systemd y los targets

Cuando el kernel monta la raíz, ejecuta `/sbin/init`, que es systemd: el proceso con PID 1, padre de todos los demás. systemd no arranca «niveles» como el viejo SysV; arranca un **target** y todo lo que ese target necesita.

| Target | Para qué |
|---|---|
| `multi-user.target` | Servidor normal: red, servicios, login por consola y SSH |
| `graphical.target` | Lo anterior más el entorno gráfico |
| `rescue.target` | Monousuario, con los discos montados, sin red ni servicios |
| `emergency.target` | Lo mínimo: raíz en solo lectura y una shell de root |

```text Terminal · systemctl get-default
graphical.target
```

En un servidor sin entorno gráfico no hace diferencia, pero lo prolijo es `sudo systemctl set-default multi-user.target`.

## Cuánto tardó y por qué

```text Terminal · systemd-analyze
Startup finished in 3.226s (kernel) + 18.254s (userspace) = 21.481s
graphical.target reached after 16.390s in userspace.
```

```text Terminal · systemd-analyze blame | head -5
6.555s snapd.seeded.service
5.122s snapd.service
3.608s dev-vda1.device
3.581s apport.service
1.836s grub-common.service
```

`blame` ordena por lo que más tardó, pero los servicios arrancan en paralelo. Lo que de verdad retrasa el arranque es la **cadena crítica**:

```text Terminal · systemd-analyze critical-chain multi-user.target
multi-user.target @16.389s
└─snapd.seeded.service @9.775s +6.555s
  └─basic.target @9.671s
    └─sockets.target @9.669s
      └─snapd.socket @9.631s +35ms
```

En esta VM, snapd es casi la mitad del arranque. En un servidor que no usa snaps, `sudo apt purge snapd` lo saca del camino.

El registro de todo lo que pasó en el arranque actual está en el journal: `journalctl -b`. El del arranque anterior, que es el que importa cuando el servidor se reinició solo, en `journalctl -b -1`.

> **Quedate con esto**
> El arranque tiene cinco etapas: firmware, GRUB, kernel, initramfs y systemd, y cada falla se ve y se arregla distinto. GRUB se configura en `/etc/default/grub` y en `grub.d/`, que pisa al primero, y se regenera con `update-grub`. systemd arranca un target, no un nivel. Y `systemd-analyze critical-chain` dice qué retrasa el arranque de verdad.
