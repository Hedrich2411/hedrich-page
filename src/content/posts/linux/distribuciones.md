---
title: "Linux, distribuciones y el laboratorio del curso"
description: Kernel, distribución y ciclo de soporte. Qué elegir para un servidor y cómo armar un laboratorio donde romper cosas sin miedo.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ubuntu]
goal: Elegir una distribución para producción con criterios concretos y tener un laboratorio listo.
course: linux-administracion
section: fundamentos
order: 1
---

«Linux» es, estrictamente, solo el kernel: el programa que habla con el hardware, reparte la CPU y la memoria y ofrece archivos, procesos y red. Lo que instalás es una **distribución**: ese kernel más el gestor de arranque, systemd, las herramientas GNU, un gestor de paquetes y miles de programas probados juntos.

Para administrar, la diferencia importa. El kernel es casi el mismo en todas; lo que cambia de una distribución a otra es **cómo se instalan paquetes, cada cuánto salen versiones y cuánto tiempo reciben parches de seguridad**.

## Las dos familias que vas a encontrar

| Familia | Distribuciones | Paquetes | Seguridad obligatoria | Firewall por defecto |
|---|---|---|---|---|
| Debian | Debian, Ubuntu | `.deb`, `apt` | AppArmor | `ufw` (Ubuntu) |
| Red Hat | RHEL, Rocky Linux, AlmaLinux, Fedora | `.rpm`, `dnf` | SELinux | `firewalld` |

Rocky y AlmaLinux son reconstrucciones gratuitas de RHEL: mismos paquetes, mismo comportamiento, sin soporte comercial. Fedora es donde Red Hat prueba lo que va a llegar a RHEL; no es para servidores de larga vida.

Hay más, como SUSE, Arch o Alpine, pero en servidores de empresa y en la nube vas a ver estas dos familias el 95 % del tiempo.

## El criterio que importa: el ciclo de soporte

Un servidor de producción se instala una vez y vive años. Lo que decide la distribución es **hasta cuándo va a recibir parches**:

| Versión | Soporte estándar hasta | Con suscripción extendida |
|---|---|---|
| Ubuntu 24.04 LTS | 2029 | 2034 (Ubuntu Pro, gratis hasta 5 máquinas) |
| Debian 13 | 2028 | 2030 (LTS comunitario) |
| RHEL 9, Rocky 9, Alma 9 | 2032 | — |

En las versiones LTS (*long term support*) los paquetes **no cambian de versión mayor** durante todo el ciclo: reciben parches, no novedades. Es exactamente lo que querés en producción. La API de facturación que funciona con el PostgreSQL de hoy va a seguir funcionando después de cada `apt upgrade`.

Las versiones intermedias de Ubuntu, como la 24.10, tienen nueve meses de soporte. No van en un servidor.

## Lo que usa este curso

**Ubuntu Server 24.04 LTS** como base, porque es lo que vas a encontrar en la mayoría de los VPS y las nubes, y **Rocky Linux 9** cada vez que algo se hace distinto en la familia Red Hat: paquetes, SELinux y firewall.

```text Terminal · /etc/os-release del laboratorio
PRETTY_NAME="Ubuntu 24.04.5 LTS"
VERSION_ID="24.04"
VERSION_CODENAME=noble
ID_LIKE=debian
```

`/etc/os-release` es la forma portable de saber dónde estás parado; los scripts lo leen con `. /etc/os-release` y usan `$ID` o `$VERSION_CODENAME`.

## El escenario

Todo el curso gira alrededor de un caso real: el servidor donde corre la **API de facturación electrónica** del [curso de Clean Architecture](/blog/clean-architecture/por-que-clean-architecture). Lo vas a recibir vacío y, lección a lección, le vas a crear usuarios, instalar PostgreSQL, convertir la API en un servicio, darle discos, firewall, backups y monitoreo, y al final replicarlo en dos servidores nuevos con Ansible.

No hace falta haber hecho el otro curso: la API es solo «una aplicación Python que escucha en el puerto 8000 y usa PostgreSQL».

## El laboratorio

Vas a romper cosas a propósito: un `fstab` que no arranca, un firewall que te deja afuera. Hacelo donde no duela.

| Opción | Para qué sirve | Límite |
|---|---|---|
| VPS barato (Hetzner, DigitalOcean, Linode) | Lo más parecido a producción, con IP pública | Cuesta unos dólares al mes |
| VM local con VirtualBox, Hyper-V o KVM | Snapshots: rompés, volvés atrás | Consume RAM de tu máquina |
| WSL en Windows | Practicar la shell, scripts, paquetes | Comparte kernel con Windows; sin GRUB ni discos reales |
| Contenedores con systemd | Varios «servidores» livianos a la vez | Comparten kernel: nada de módulos ni particiones de verdad |

Para este curso se usó una mezcla: contenedores de Ubuntu 24.04 con systemd como servidores, una red interna `192.168.10.0/24` para los servicios de oficina, y una VM real con libvirt para la sección de virtualización. Si una prueba necesitó algo que los contenedores no tienen, la lección lo dice.

Para seguirlo, alcanza con **una VM de Ubuntu Server 24.04** con 2 GB de RAM y un segundo disco vacío de 10 GB para la sección de almacenamiento. Tomá un snapshot apenas la instales: es tu botón de deshacer.

> **Quedate con esto**
> Linux es el kernel; lo que elegís es una distribución, y la elegís por su ciclo de soporte. Para servidores, una LTS: Ubuntu 24.04 o la familia RHEL 9, que cambian parches y no versiones durante años. Y practicá en una VM con snapshots, porque en este curso vas a romper cosas a propósito.
