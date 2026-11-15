---
title: "Permisos, ACL y capabilities"
description: rwx y su notación octal, umask, setgid para directorios compartidos, ACL cuando los grupos no alcanzan, y capabilities para no correr como root.
date: 2026-10-19
topic: Infraestructura
tags: [linux, permisos, seguridad]
goal: Dar acceso exacto a archivos y directorios, y abrir puertos bajos sin ejecutar como root.
course: linux-administracion
section: usuarios
order: 3
---

Cada archivo tiene un dueño, un grupo y tres juegos de permisos: para el dueño, para el grupo y para todos los demás.

## rwx

```text Terminal
-rw-r----- 1 root facturacion 255 Oct 19 21:45 /etc/facturacion/entorno
```

| Posición | `-` | `rw-` | `r--` | `---` |
|---|---|---|---|---|
| Significa | Tipo: archivo (`d` es directorio, `l` enlace) | Dueño: leer y escribir | Grupo: leer | Otros: nada |

El archivo de entorno de la API tiene la contraseña de la base: root lo escribe, el grupo `facturacion` lo lee y nadie más lo ve.

En un directorio, los permisos significan otra cosa:

| | Archivo | Directorio |
|---|---|---|
| `r` | Leer el contenido | Listar los nombres |
| `w` | Modificar | Crear, borrar y renombrar archivos adentro |
| `x` | Ejecutar | Entrar y acceder a lo que hay adentro |

Una consecuencia que sorprende: **borrar un archivo depende del directorio, no del archivo**. Si podés escribir en el directorio, podés borrar archivos de otros aunque no puedas leerlos.

## Octal

Cada permiso vale un número, `r=4`, `w=2`, `x=1`, y se suman por juego:

| Octal | Permisos | Uso típico |
|---|---|---|
| `600` | `rw-------` | Claves privadas, `authorized_keys` |
| `640` | `rw-r-----` | Configuración con secretos, legible por un grupo |
| `644` | `rw-r--r--` | Configuración pública |
| `750` | `rwxr-x---` | Directorio de un servicio |
| `755` | `rwxr-xr-x` | Programas, directorios públicos |

```bash Terminal
chmod 640 archivo                  # octal
chmod u=rwx,g=rx,o= archivo        # simbólico: 750
chmod g+w archivo                  # sumar escritura al grupo
sudo chown facturacion:facturacion /srv/facturacion
```

## umask

Los archivos nuevos no nacen con `777` menos nada: nacen con `666` para archivos y `777` para directorios, **menos la umask**.

```text Terminal
$ umask
0022
```

Con `022`, un archivo nace `644` y un directorio `755`. Los usuarios comunes en Ubuntu tienen `0002`, porque su grupo principal es solo de ellos:

```text Terminal · Como ana
-rw-rw-r-- 1 ana ana    0 Oct 19 21:42 /tmp/de-ana.txt
drwxrwxr-x 2 ana ana 4096 Oct 19 21:42 /tmp/dir-de-ana
```

En un script que crea archivos con secretos, como un backup de la base, `umask 077` al principio hace que todo nazca `600`. En la [lección de scripts](/blog/linux/scripts-de-administracion) vas a ver por qué hizo falta.

## Los bits especiales

**Sticky en directorios.** `/tmp` es escribible por todos, pero nadie puede borrar archivos ajenos:

```text Terminal
drwxrwxrwt 1 root root 4096 Oct 19 21:42 /tmp
```

La `t` al final es el sticky bit.

**setgid en directorios compartidos.** Es el que más vas a usar. Los archivos creados adentro heredan el grupo del directorio, no el grupo principal de quien los crea:

```bash Terminal
sudo mkdir -p /srv/releases
sudo chgrp deploy /srv/releases
sudo chmod 2775 /srv/releases
```

```text Terminal
$ ls -ld /srv/releases
drwxrwsr-x 2 root deploy 4096 Oct 19 21:42 /srv/releases
$ sudo -u ana touch /srv/releases/v1.txt; ls -l /srv/releases/v1.txt
-rw-rw-r-- 1 ana deploy 0 Oct 19 21:42 /srv/releases/v1.txt
```

El `2` de `2775` es el setgid, la `s` en el lugar de la `x` del grupo. El archivo de Ana quedó del grupo `deploy`, así que el resto del equipo lo puede modificar.

**setuid en programas.** El programa corre con los permisos de su dueño, no de quien lo ejecuta. Así `passwd` puede escribir en `/etc/shadow`:

```text Terminal
-rwsr-xr-x 1 root root  64152 May 30  2024 /usr/bin/passwd
```

Un programa setuid de root con un bug es una escalada de privilegios. Conviene saber cuáles hay, y que no aparezcan nuevos:

```bash Terminal
find / -xdev -perm -4000 -type f 2>/dev/null
```

## ACL: cuando los grupos no alcanzan

El directorio de releases es del grupo `deploy`, y la API, que corre como `facturacion`, necesita leerlo. Agregar `facturacion` al grupo `deploy` le daría escritura. Una ACL da exactamente lo necesario:

```bash Terminal
sudo setfacl -m u:facturacion:rx /srv/releases
```

```text Terminal · getfacl /srv/releases
# owner: root
# group: deploy
# flags: -s-
user::rwx
user:facturacion:r-x
group::rwx
mask::rwx
other::r-x
```

`ls -l` marca con un `+` que hay ACL: `drwxrwsr-x+`. Si no lo mirás, la ACL es invisible, y por eso conviene usarlas solo cuando los grupos de verdad no alcanzan.

Una ACL **por defecto** se hereda a lo que se cree adentro:

```bash Terminal
sudo setfacl -d -m g:auditores:r /srv/releases
```

## Capabilities: el puerto 80 sin root

Los puertos menores a 1024 solo los puede abrir root. Pero ejecutar un servicio como root para abrir el 80 le da todo lo demás también.

Las *capabilities* parten los poderes de root en piezas. `CAP_NET_BIND_SERVICE` es solo «abrir puertos bajos»:

```text Terminal · Como el usuario facturacion
$ python3 -m http.server 80
PermissionError: [Errno 13] Permission denied
```

```bash Terminal
sudo cp /usr/bin/python3.12 /usr/local/bin/python-web
sudo setcap cap_net_bind_service=+ep /usr/local/bin/python-web
getcap /usr/local/bin/python-web
```

```text Terminal
/usr/local/bin/python-web cap_net_bind_service=ep
```

Con esa copia, el usuario `facturacion` puede escuchar en el 80. Se copia el binario porque la capability queda en el archivo: ponérsela al `python3` del sistema se la daría a todos los scripts de Python.

En la práctica, para un servicio es más limpio pedírsela a systemd con `AmbientCapabilities=CAP_NET_BIND_SERVICE` en la unidad, que vas a ver en [servicios de systemd](/blog/linux/servicios-systemd). Y lo más común es no necesitarla: Nginx escucha en el 80 y le pasa el tráfico a la API en el 8000.

Un detalle si probás esto en Docker: los contenedores bajan `net.ipv4.ip_unprivileged_port_start` a `0`, así que cualquier usuario abre puertos bajos y la prueba no muestra el error. En un servidor normal vale `1024`.

> **Quedate con esto**
> Dueño, grupo y otros, cada uno con `rwx`; en un directorio, `w` permite borrar archivos ajenos. Los secretos van en `640` o `600`, y un script que los crea, con `umask 077`. Para directorios compartidos, setgid (`2775`) para que todo herede el grupo. ACL solo cuando los grupos no alcanzan, porque no se ven a simple vista. Y para un puerto bajo, una capability o un proxy delante, nunca root.
