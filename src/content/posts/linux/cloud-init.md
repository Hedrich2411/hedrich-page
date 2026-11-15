---
title: "cloud-init: servidores que se configuran solos"
description: Qué hace cloud-init en el primer arranque, un user-data real para el servidor de facturación, validarlo antes de usarlo, y cómo depurar cuando no hizo lo que esperabas.
date: 2026-10-19
topic: Infraestructura
tags: [linux, cloud-init, automatizacion]
goal: Crear servidores que llegan configurados desde el primer arranque, en una VM local o en cualquier nube.
course: linux-administracion
section: virtualizacion
order: 2
---

Toda imagen cloud de Ubuntu, Debian, Rocky o Alma trae **cloud-init**: un programa que corre en el primer arranque, busca una configuración y la aplica. Es lo que hace que al crear un servidor en AWS ya tengas tu clave SSH adentro.

## De dónde saca la configuración

cloud-init busca un **datasource**, una fuente de datos, en orden:

| Datasource | Dónde |
|---|---|
| EC2, Azure, GCE, DigitalOcean… | Un servicio de metadatos en `169.254.169.254` del proveedor |
| NoCloud | Un disco o ISO adjunto con la etiqueta `cidata`, o archivos locales |
| ConfigDrive | OpenStack |

De ahí lee dos cosas: **meta-data**, la identidad de la instancia, y **user-data**, lo que vos querés que haga.

## Un user-data para el servidor

```yaml user-data
#cloud-config
hostname: facturacion-01
timezone: America/Lima
users:
  - name: ana
    groups: [sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: true
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... ana@laptop
ssh_pwauth: false
disable_root: true
package_update: true
package_upgrade: true
packages:
  - nftables
  - fail2ban
  - unattended-upgrades
write_files:
  - path: /etc/ssh/sshd_config.d/10-endurecer.conf
    permissions: "0644"
    content: |
      PasswordAuthentication no
      PermitRootLogin no
runcmd:
  - systemctl enable --now nftables
  - systemctl reload ssh
```

La primera línea, `#cloud-config`, **es obligatoria**: sin ella, cloud-init no reconoce el formato. El archivo puede ser también un script que empiece con `#!/bin/bash`, pero el formato declarativo es más claro y cada módulo sabe hacer su parte bien.

| Clave | Hace |
|---|---|
| `users` | Crea usuarios, con grupos, sudo y claves; `lock_passwd` deja la cuenta sin contraseña |
| `ssh_pwauth: false` | Desactiva el acceso por contraseña a SSH |
| `package_update`, `packages` | `apt update` e instalación |
| `write_files` | Escribe archivos con contenido y permisos |
| `runcmd` | Comandos, al final, una sola vez |

El orden entre módulos lo decide cloud-init, no el orden del archivo: `write_files` corre antes que `packages`, y `runcmd` casi al final.

## Validar antes de usar

Un error en el user-data no se ve hasta que el servidor arranca mal. Se valida antes:

```text Terminal
$ cloud-init schema --config-file user-data
Valid schema user-data
```

Con un error de tipeo, `paquetes:` en lugar de `packages:`:

```text Terminal · cloud-init schema --config-file malo.yaml --annotate
paquetes:		# E1
# Errors: -------------
# E1: Additional properties are not allowed ('paquetes' was unexpected)
```

Sin validar, cloud-init habría ignorado esa clave en silencio y el servidor habría arrancado sin nftables ni fail2ban.

## En una VM local

Para KVM o VirtualBox se usa el datasource NoCloud: una ISO chiquita con el user-data y el meta-data.

```yaml meta-data
instance-id: facturacion-01
local-hostname: facturacion-01
```

```text Terminal
$ cloud-localds seed.iso user-data meta-data
$ file seed.iso
seed.iso: ISO 9660 CD-ROM filesystem data 'cidata'
```

Se adjunta como CD a la VM. `virt-install --cloud-init user-data=...`, como en la [lección de KVM](/blog/linux/kvm), arma esa ISO solo.

El `instance-id` importa: cloud-init corre la configuración de «primer arranque» una vez por `instance-id`. Si cambiás el user-data y querés que se vuelva a aplicar, cambiá el `instance-id` o borrá el estado con `sudo cloud-init clean`.

## En la nube

El mismo archivo, sin cambios, se pasa al crear la instancia:

| Proveedor | Cómo |
|---|---|
| AWS | `aws ec2 run-instances --user-data file://user-data` |
| Azure | `az vm create --custom-data user-data` |
| DigitalOcean, Hetzner | El campo «User data» al crear el servidor |

Es lo que vas a hacer en [AWS y Azure](/blog/linux/aws-y-azure).

## Cuando no hizo lo que esperabas

```bash Terminal
cloud-init status --wait --long
```

```text Terminal
status: done
extended_status: done
boot_status_code: enabled-by-generator
```

`--wait` espera a que termine, útil en scripts que crean un servidor y siguen. Si dice `error`:

| Archivo | Tiene |
|---|---|
| `/var/log/cloud-init-output.log` | La salida de cada comando: lo primero que hay que mirar |
| `/var/log/cloud-init.log` | El detalle interno, módulo por módulo |
| `/var/lib/cloud/instance/user-data.txt` | El user-data que de verdad recibió |

La tercera fila resuelve muchos misterios: a veces el problema es que el user-data no llegó, o llegó otro.

## Dos cuidados

**El user-data no es secreto.** Cualquier proceso del servidor puede leer el servicio de metadatos y obtenerlo, y en algunos proveedores queda visible en la consola. No pongas contraseñas de la base ni tokens ahí: que cloud-init instale lo mínimo y que los secretos lleguen después, con [Ansible y Vault](/blog/linux/ansible-roles) o un gestor de secretos del proveedor.

**cloud-init es para el primer arranque.** No es una herramienta de gestión de configuración: no vuelve a aplicar nada si alguien cambia algo a mano después. Para mantener la configuración en el tiempo, Ansible. La combinación que funciona: cloud-init deja el usuario y la clave para que Ansible pueda entrar, y Ansible hace el resto.

> **Quedate con esto**
> cloud-init configura un servidor en su primer arranque con un user-data que empieza con `#cloud-config`. Validalo siempre con `cloud-init schema --annotate`, porque una clave mal escrita se ignora en silencio. El mismo archivo sirve en una VM local con NoCloud y en cualquier nube. Si falla, `/var/log/cloud-init-output.log`. Y nada de secretos en el user-data: cloud-init deja la puerta abierta para Ansible, que hace el resto.
