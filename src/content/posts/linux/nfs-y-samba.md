---
title: "Archivos compartidos: NFS y Samba"
description: NFS entre servidores Linux con root_squash y montajes que no traban el arranque, y Samba para que contabilidad abra sus planillas desde Windows.
date: 2026-10-19
topic: Infraestructura
tags: [linux, nfs, samba]
goal: Compartir directorios entre servidores Linux y con equipos Windows, con los permisos correctos.
course: linux-administracion
section: servicios
order: 3
---

Dos necesidades distintas con la misma palabra: los **servidores** que comparten un directorio de releases o de archivos subidos, y las **personas** de contabilidad que guardan sus planillas en una carpeta de red desde Windows.

| | NFS | Samba (SMB) |
|---|---|---|
| Para | Linux con Linux | Windows, macOS y Linux |
| Usuarios | Por número de UID, el mismo en ambas puntas | Usuarios y contraseñas propios, o el dominio |
| Típico | Servidores de aplicaciones | Personas |

## NFS

En ns1, el servidor de archivos:

```bash Terminal
sudo apt install nfs-kernel-server
sudo mkdir -p /srv/compartido/releases
```

```text /etc/exports
/srv/compartido/releases  192.168.10.20(rw,sync,no_subtree_check,root_squash)
```

| Opción | Hace |
|---|---|
| `192.168.10.20` | Solo ese cliente; puede ser una red: `192.168.10.0/24` |
| `rw` | Lectura y escritura |
| `sync` | Confirma la escritura recién cuando está en disco. `async` es más rápido y pierde datos si el servidor se corta |
| `root_squash` | Root del cliente es `nobody` en el servidor. Es el valor por defecto, y debería quedarse así |

```bash Terminal
sudo exportfs -ra
sudo exportfs -v
```

```text Terminal
/srv/compartido/releases
		192.168.10.20(sync,wdelay,hide,no_subtree_check,sec=sys,rw,secure,root_squash,no_all_squash)
```

`exportfs -v` muestra también los valores por defecto que no escribiste. `showmount -e ns1` lo ve desde un cliente.

En el cliente, el servidor de facturación:

```bash Terminal
sudo apt install nfs-common
sudo mkdir -p /mnt/releases
sudo mount -t nfs ns1:/srv/compartido/releases /mnt/releases
```

### root_squash en acción

```text Terminal · En el cliente, como root
$ sudo touch /mnt/releases/como-root.txt && ls -ln /mnt/releases/como-root.txt
-rw-r--r-- 1 65534 65534 0 Oct 19 21:59 /mnt/releases/como-root.txt
```

El archivo que root creó en el cliente es de `65534`, `nobody`, en el servidor. Sin `root_squash`, cualquiera que sea root en un cliente sería root sobre los archivos del servidor.

### Los UID tienen que coincidir

```text Terminal · Como ana, UID 1001
$ touch /mnt/releases/como-ana.txt
touch: cannot touch '/mnt/releases/como-ana.txt': Permission denied
```

NFS no manda nombres de usuario, manda **números**. Si `ana` es el 1001 en el cliente y el 1001 en el servidor es otra persona, los permisos se mezclan. Para que funcione: los mismos UID en todas las máquinas, o un directorio central como LDAP o FreeIPA, o NFSv4 con Kerberos.

### En fstab, sin trabar el arranque

```text /etc/fstab
ns1:/srv/compartido/releases  /mnt/releases  nfs  defaults,_netdev,nofail,x-systemd.automount  0  0
```

```text Terminal · sudo findmnt --verify --tab-file /etc/fstab
Success, no errors or warnings detected
```

| Opción | Por qué |
|---|---|
| `_netdev` | Esperar a la red antes de montar |
| `nofail` | Si ns1 no responde, el arranque sigue |
| `x-systemd.automount` | Montar recién cuando alguien accede al directorio |

Un montaje NFS caído deja procesos en estado `D` esperando, y la [carga del sistema](/blog/linux/diagnostico) se dispara sin que la CPU haga nada. Con `automount`, al menos el arranque no depende de que ns1 esté vivo.

El laboratorio montó con NFSv3: NFSv4, el valor por defecto en Ubuntu, necesita exportar la raíz del servidor, y la raíz de un contenedor es overlayfs, que no se puede exportar. En un servidor normal, NFSv4 funciona con la misma configuración y solo usa el puerto 2049, más fácil de pasar por un firewall.

## Samba

Contabilidad, en Windows, necesita una carpeta compartida. Samba implementa SMB, el protocolo de las carpetas de red de Windows.

```bash Terminal
sudo apt install samba
sudo groupadd contabilidad
sudo useradd -M -s /usr/sbin/nologin -G contabilidad lucia
sudo mkdir -p /srv/samba/contabilidad
sudo chgrp contabilidad /srv/samba/contabilidad
sudo chmod 2770 /srv/samba/contabilidad
```

`2770` con setgid, como en [permisos](/blog/linux/permisos): todo lo que se cree adentro queda del grupo `contabilidad`.

```ini /etc/samba/smb.conf
[global]
   workgroup = EMPRESA
   server string = Archivos de la oficina
   server min protocol = SMB2_10
   map to guest = never
   interfaces = lo 192.168.10.0/24
   bind interfaces only = yes
   hosts allow = 127. 192.168.10.

[contabilidad]
   path = /srv/samba/contabilidad
   valid users = @contabilidad
   read only = no
   create mask = 0660
   directory mask = 2770
```

**`server min protocol = SMB2_10`** deja afuera SMB1, el protocolo que usó WannaCry. **`interfaces` y `hosts allow`** limitan Samba a la red de la oficina. **`valid users = @contabilidad`** da acceso al grupo, no a personas sueltas.

Samba tiene **sus propias contraseñas**, separadas de las del sistema:

```text Terminal
$ testparm -s
Load smb config files from /etc/samba/smb.conf
Loaded services file OK.
$ sudo smbpasswd -a lucia
Added user lucia.
$ sudo systemctl restart smbd
```

Desde otra máquina, con `smbclient`, como lo vería Windows:

```text Terminal
$ smbclient -L //192.168.10.2 -U lucia
	contabilidad    Disk
	IPC$            IPC       IPC Service (Archivos de la oficina)
$ smbclient //192.168.10.2/contabilidad -U lucia -c 'put balance-octubre.xlsx; ls'
putting file balance-octubre.xlsx as \balance-octubre.xlsx
  balance-octubre.xlsx                A        8  Mon Oct 19 21:59:32 2026
```

```text Terminal · En el servidor
-rw-rw---- 1 lucia contabilidad 8 Oct 19 21:59 balance-octubre.xlsx
```

`0660` y grupo `contabilidad`, como pedían `create mask` y el setgid. Alguien de afuera del grupo, o sin usuario:

```text Terminal
session setup failed: NT_STATUS_LOGON_FAILURE
tree connect failed: NT_STATUS_ACCESS_DENIED
```

En Windows, la carpeta se abre con `\\192.168.10.2\contabilidad`, o mejor `\\ns1.empresa.internal\contabilidad` con el [DNS interno](/blog/linux/dns).

Para una empresa con Active Directory, Samba se une al dominio y usa sus usuarios, y deja de hacer falta `smbpasswd`. Es otro tema, pero conviene saber que existe antes de crear cincuenta cuentas a mano.

## Firewall

| Servicio | Puertos |
|---|---|
| NFSv4 | TCP 2049 |
| NFSv3 | 2049 más `rpcbind` (111) y puertos dinámicos de `mountd`: más difícil de filtrar |
| Samba | TCP 445 |

Los dos, solo desde la red interna. **Nunca expongas NFS o Samba a Internet.**

> **Quedate con esto**
> NFS para servidores Linux, Samba para personas en Windows. En NFS, `root_squash` siempre, UID iguales en todas las máquinas, y en fstab `_netdev,nofail,x-systemd.automount` para que un servidor de archivos caído no trabe el arranque. En Samba, sin SMB1, limitado a la red interna, acceso por grupo, un directorio con setgid y contraseñas propias con `smbpasswd`. Los dos, solo hacia adentro.
