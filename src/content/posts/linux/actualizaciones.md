---
title: "Actualizaciones de seguridad sin sorpresas"
description: Parches automáticos con unattended-upgrades, qué hacer cuando hace falta reiniciar, y una rutina de actualización para lo que no conviene automatizar.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ubuntu, seguridad]
goal: Tener los parches de seguridad aplicándose solos y una rutina clara para el resto.
course: linux-administracion
section: software
order: 2
---

La mayoría de los servidores comprometidos no caen por un ataque sofisticado: caen por una vulnerabilidad que tenía parche desde hacía meses. Las actualizaciones de seguridad son lo más barato que existe en seguridad, siempre que se apliquen.

## Dos tipos de actualización

| | Seguridad | Todo lo demás |
|---|---|---|
| Repositorio en Ubuntu | `noble-security` | `noble-updates` |
| Qué cambia | Corrige una vulnerabilidad, sin cambiar comportamiento | Corrige bugs, a veces cambia comportamiento |
| Cuándo aplicar | Ya, automáticamente | En una ventana de mantenimiento, después de probar |

Las versiones LTS no cambian la versión mayor de los paquetes, así que hasta las del segundo grupo suelen ser seguras. Pero «suelen» no es «siempre», y por eso se separan.

## unattended-upgrades

Ubuntu Server lo trae instalado. Dos archivos lo controlan:

```text Terminal · /etc/apt/apt.conf.d/20auto-upgrades
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

El `1` es cada cuántos días. Si el archivo no existe, no corre nada: créalo, o `sudo dpkg-reconfigure -plow unattended-upgrades`.

Qué se instala lo decide `/etc/apt/apt.conf.d/50unattended-upgrades`. Por defecto, solo seguridad:

```text Terminal · 50unattended-upgrades
Unattended-Upgrade::Allowed-Origins {
	"${distro_id}:${distro_codename}";
	"${distro_id}:${distro_codename}-security";
```

Y una simulación muestra qué haría:

```text Terminal · sudo unattended-upgrade --dry-run -d
Allowed origins are: o=Ubuntu,a=noble, o=Ubuntu,a=noble-security, o=UbuntuESMApps,a=noble-apps-security, o=UbuntuESM,a=noble-infra-security
No packages found that can be upgraded unattended and no pending auto-removals
```

Corre con un timer de systemd, `apt-daily-upgrade.timer`, y deja su registro en `/var/log/unattended-upgrades/`.

Las opciones que vale la pena tocar, en un drop-in propio como `/etc/apt/apt.conf.d/52unattended-local`:

```text 52unattended-local
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Mail "admin@empresa.pe";
Unattended-Upgrade::MailReport "only-on-error";
Unattended-Upgrade::Automatic-Reboot "false";
```

En Rocky, el equivalente es `dnf-automatic`: `sudo dnf install dnf-automatic`, `upgrade_type = security` en `/etc/dnf/automatic.conf` y `sudo systemctl enable --now dnf-automatic.timer`.

## Cuando hace falta reiniciar

Un parche del kernel o de bibliotecas como `glibc` no tiene efecto hasta reiniciar. Ubuntu lo avisa con un archivo:

```bash Terminal
cat /var/run/reboot-required          # existe si hace falta
cat /var/run/reboot-required.pkgs     # qué paquetes lo pidieron
```

Y cuando apt actualiza una biblioteca, `needrestart` revisa qué procesos siguen usando la versión vieja y ofrece reiniciarlos:

```text Terminal · Al final de un apt install
No services need to be restarted.

No containers need to be restarted.

No user sessions are running outdated binaries.
```

Para el kernel hay dos caminos:

**Reiniciar en un horario.** `Unattended-Upgrade::Automatic-Reboot "true"` con `Automatic-Reboot-Time "04:00"`. Es razonable si la aplicación tolera unos minutos afuera, o si hay más de un servidor detrás de un balanceador y no se reinician todos el mismo día.

**Livepatch.** Ubuntu Pro, gratis hasta cinco máquinas, aplica parches críticos del kernel sin reiniciar. No reemplaza al reinicio, lo posterga hasta la ventana de mantenimiento.

Lo que no puede pasar es un servidor con 400 días de *uptime* corriendo un kernel con vulnerabilidades conocidas. El *uptime* largo no es un logro.

## La rutina manual

Para todo lo que no es seguridad, o para servidores donde no se automatiza:

```bash Terminal
sudo apt update
apt list --upgradable                       # qué hay
sudo apt-get upgrade -s | grep ^Inst        # qué haría
sudo apt upgrade                            # aplicar
cat /var/run/reboot-required 2>/dev/null    # ¿reinicio?
```

Y antes, en un servidor que importa: un snapshot de la VM o del disco, que es la forma más rápida de volver atrás si algo se rompe. Lo vas a ver en [KVM](/blog/linux/kvm) y en [AWS](/blog/linux/aws-y-azure).

`apt upgrade` nunca quita paquetes. `apt full-upgrade` sí puede, cuando un paquete nuevo reemplaza a otro. En una LTS casi no hace falta; si `apt upgrade` deja paquetes «retenidos», mirá cuáles son antes de usar `full-upgrade`.

## Cambiar de versión de la distribución

Pasar de 22.04 a 24.04 es otra cosa: `do-release-upgrade`, y cambia versiones mayores de todo. En un servidor de producción, la práctica más sana es **no actualizar en el lugar**: crear un servidor nuevo con la versión nueva, configurarlo con Ansible, migrar los datos y apagar el viejo. Si eso te parece mucho trabajo, es un buen argumento para automatizar la configuración desde el principio.

> **Quedate con esto**
> Los parches de seguridad se aplican solos con unattended-upgrades, que necesita `20auto-upgrades` para correr. Lo demás se aplica en una ventana, simulando primero. Un parche del kernel no sirve hasta reiniciar: `/var/run/reboot-required` lo avisa, y o reiniciás en un horario o usás Livepatch hasta la ventana. Y un cambio de versión de la distribución se hace mejor con un servidor nuevo que en el lugar.
