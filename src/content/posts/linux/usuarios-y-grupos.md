---
title: "Usuarios y grupos: personas y servicios"
description: Dónde viven las cuentas, la diferencia entre un usuario humano y uno de servicio, la trampa de usermod sin -a y cómo bloquear una cuenta de verdad.
date: 2026-10-19
topic: Infraestructura
tags: [linux, usuarios]
goal: Crear y mantener cuentas para personas y para servicios con el mínimo acceso necesario.
course: linux-administracion
section: usuarios
order: 1
---

En un servidor hay dos tipos de cuentas y se crean distinto. Las **personas** entran por SSH, tienen un directorio y una shell. Los **servicios**, como la API de facturación, PostgreSQL o Nginx, corren con su propio usuario para que, si alguien los compromete, solo tenga acceso a lo de ese servicio.

## Dónde viven

```text Terminal · /etc/passwd
root:x:0:0:root:/root:/bin/bash
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
```

Siete campos separados por `:`: nombre, `x` (la contraseña está en otro lado), UID, GID del grupo principal, comentario, directorio y shell.

```text Terminal
-rw-r--r-- 1 root root    682 Oct 19 21:40 /etc/group
-rw-r--r-- 1 root root   1327 Oct 19 21:40 /etc/passwd
-rw-r----- 1 root shadow  678 Oct 19 21:40 /etc/shadow
```

`/etc/passwd` lo lee cualquiera porque los programas necesitan traducir UID a nombre. Los hashes de las contraseñas están en `/etc/shadow`, que solo lee root y el grupo `shadow`.

Para consultar, mejor `getent` que leer el archivo: también encuentra usuarios de LDAP o de un directorio activo si el servidor está unido a uno.

| UID | Quién |
|---|---|
| 0 | root |
| 1 a 999 | Usuarios del sistema y de servicios |
| 1000 en adelante | Personas |

## Un usuario de servicio

```bash Terminal
sudo useradd --system --home-dir /srv/facturacion --create-home \
  --shell /usr/sbin/nologin facturacion
```

```text Terminal
$ getent passwd facturacion
facturacion:x:999:992::/srv/facturacion:/usr/sbin/nologin
$ id facturacion
uid=999(facturacion) gid=992(facturacion) groups=992(facturacion)
```

`--system` le da un UID bajo y no le crea fecha de vencimiento de contraseña. `nologin` hace que no pueda entrar:

```text Terminal
$ sudo su - facturacion -c 'echo hola'
This account is currently not available.
```

Cuando sí necesitás ejecutar algo como ese usuario, por ejemplo para instalar dependencias, indicás la shell vos o usás `sudo -u`:

```bash Terminal
sudo -u facturacion uv sync --frozen
```

## Un usuario humano

```bash Terminal
sudo useradd --create-home --shell /bin/bash --comment "Ana Quispe" ana
```

En Ubuntu también existe `adduser ana`, que es interactivo y pregunta todo. Para scripts y Ansible, `useradd` con opciones explícitas.

```text Terminal
$ id ana
uid=1001(ana) gid=1001(ana) groups=1001(ana)
```

Cada usuario tiene un **grupo principal**, con su mismo nombre, y puede estar en otros **suplementarios**. Los permisos que vas a ver en [permisos](/blog/linux/permisos) se dan a grupos, no a personas: «el equipo de despliegue puede escribir en `/srv/releases`», no «Ana puede».

## La trampa de usermod

```text Terminal
$ sudo usermod -aG deploy ana; id ana
uid=1001(ana) gid=1001(ana) groups=1001(ana),1002(deploy)
$ sudo usermod -G auditores ana; id ana
uid=1001(ana) gid=1001(ana) groups=1001(ana),1003(auditores)
```

Sin `-a`, `-G` **reemplaza** la lista de grupos: Ana salió de `deploy`. Si en lugar de `deploy` hubiera sido `sudo`, acabás de quitarle la administración del servidor a alguien. Siempre `-aG`.

Los grupos nuevos se aplican **al iniciar sesión**. Si Ana ya estaba conectada, tiene que salir y volver a entrar, o usar `newgrp deploy` en esa terminal.

## Contraseñas y vencimientos

```bash Terminal
sudo chage --maxdays 90 --warndays 7 ana
sudo chage -l ana
```

```text Terminal
Maximum number of days between password change		: 90
Number of days of warning before password expires	: 7
```

En un servidor donde se entra solo con [claves SSH](/blog/linux/ssh), vencer contraseñas tiene poco sentido; sirve para las cuentas que usan contraseña para `sudo`.

## Bloquear una cuenta de verdad

Alguien se va de la empresa. El reflejo es `passwd -l`:

```text Terminal
$ sudo passwd -l ana
$ sudo passwd -S ana
ana L 2026-10-19 0 90 7 -1
```

La `L` dice que la contraseña está bloqueada. Pero **eso no bloquea SSH con clave**: la autenticación por clave no usa la contraseña. Ana sigue entrando.

Lo que corta todo es vencer la cuenta:

```text Terminal
$ sudo usermod --expiredate 1 ana
$ sudo chage -l ana | grep 'Account expires'
Account expires						: Jan 02, 1970
```

Una cuenta vencida no puede iniciar sesión por ningún método. El procedimiento completo de una baja:

1. `sudo usermod --expiredate 1 ana`
2. Quitar sus claves de `~ana/.ssh/authorized_keys`.
3. Revisar si tenía tareas programadas: `sudo crontab -l -u ana` y `systemctl list-timers --all`.
4. Buscar procesos suyos todavía vivos: `pgrep -u ana -a`.
5. Recién después de un tiempo, `sudo userdel -r ana` para borrar la cuenta y su directorio.

No borres la cuenta el primer día: sus archivos y logs tienen su UID, y si borrás el usuario, `ls -l` empieza a mostrar números en lugar de nombres justo cuando necesitás auditar qué hizo.

## Quién está y quién estuvo

```bash Terminal
who                       # conectados ahora
last -n 10                # últimos inicios de sesión
lastlog | grep -v Never   # último acceso de cada cuenta
```

> **Quedate con esto**
> Servicios con `useradd --system` y shell `nologin`; personas con `useradd --create-home` y permisos por grupo. `usermod -G` sin `-a` reemplaza los grupos, así que siempre `-aG`. Y `passwd -l` no bloquea el acceso por clave SSH: para dar de baja a alguien, `usermod --expiredate 1` y sacar sus claves.
