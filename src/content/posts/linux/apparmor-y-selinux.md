---
title: "AppArmor y SELinux"
description: Control de acceso obligatorio, por qué existe además de los permisos de siempre, y cómo diagnosticar y resolver el clásico «Nginx devuelve 502 y los permisos están bien».
date: 2026-10-19
topic: Infraestructura
tags: [linux, seguridad, selinux, apparmor]
goal: Entender qué bloquea el control de acceso obligatorio y resolverlo sin desactivarlo.
course: linux-administracion
section: seguridad
order: 3
---

Los permisos de [la lección anterior](/blog/linux/permisos) son **discrecionales**: el dueño de un archivo decide quién lo lee. Si alguien compromete a Nginx, que corre como `www-data`, puede leer todo lo que `www-data` puede leer.

El **control de acceso obligatorio** agrega una segunda capa que el dueño no controla: una política que dice qué puede hacer cada programa, sin importar el usuario. Nginx puede leer `/var/www` y escuchar en el 80 y el 443; aunque corriera como root, no podría leer `/etc/shadow`.

| | AppArmor | SELinux |
|---|---|---|
| Distribuciones | Ubuntu, Debian, SUSE | RHEL, Rocky, Alma, Fedora |
| Identifica los archivos por | Su **camino** | Una **etiqueta** guardada en el archivo |
| Política | Perfiles por programa | Una política para todo el sistema |
| Curva | Más simple | Más completa, más difícil |

En el laboratorio de este curso no había ninguno de los dos activo, porque los contenedores comparten el kernel de Docker Desktop. Los comandos de SELinux sobre la política se probaron en Rocky Linux 9 con la política instalada; los de diagnóstico, que necesitan el módulo activo, son los de la documentación de Red Hat y Ubuntu.

## AppArmor

```bash Terminal
sudo aa-status
```

Lista los perfiles cargados y en qué modo está cada uno:

| Modo | Hace |
|---|---|
| `enforce` | Bloquea y registra lo que la política no permite |
| `complain` | Solo registra; para escribir o ajustar un perfil |

Los perfiles están en `/etc/apparmor.d/`. Cuando AppArmor bloquea algo, queda en el log del kernel:

```bash Terminal
sudo journalctl -k | grep 'apparmor="DENIED"'
```

El mensaje dice qué programa (`profile=`), qué intentó (`operation=`, `requested_mask=`) y sobre qué (`name=`). Para un perfil que necesita un permiso más, se agrega en `/etc/apparmor.d/local/<perfil>`, que existe para eso y no lo pisan las actualizaciones, y se recarga:

```bash Terminal
sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
```

Para investigar, `sudo aa-complain /etc/apparmor.d/<perfil>` lo pasa a modo queja; `sudo aa-enforce` lo vuelve a activar. No dejes un perfil en `complain` en producción.

## SELinux

```bash Terminal
getenforce               # Enforcing, Permissive o Disabled
sestatus
```

En SELinux todo tiene una **etiqueta**, un contexto, y la política dice qué etiquetas de procesos pueden hacer qué con qué etiquetas de archivos y puertos:

```bash Terminal
ls -Z /var/www/html      # system_u:object_r:httpd_sys_content_t:s0
ps -eZ | grep nginx      # system_u:system_r:httpd_t:s0
```

Un proceso `httpd_t` puede leer archivos `httpd_sys_content_t`. No importa que el archivo tenga permisos `777`: si la etiqueta no corresponde, no.

### El 502 clásico

En Rocky, Nginx delante de la API en `127.0.0.1:8000`. Los permisos están bien, la API responde con `curl` local, y Nginx devuelve **502 Bad Gateway**. En el log de Nginx:

```text /var/log/nginx/error.log
connect() to 127.0.0.1:8000 failed (13: Permission denied) while connecting to upstream
```

*Permission denied* conectando a un puerto. No son permisos de archivos: es SELinux, que por defecto no deja a un servidor web abrir conexiones de red salientes.

```bash Terminal
sudo ausearch -m avc -ts recent       # los bloqueos recientes
sudo ausearch -m avc -ts recent | audit2why
```

`audit2why` traduce el bloqueo y sugiere la salida. En este caso, un **booleano**, un interruptor que la política ya trae para los casos comunes:

```text Terminal · semanage boolean -l | grep httpd_can_network
httpd_can_network_connect      (off  ,  off)  Allow httpd to can network connect
httpd_can_network_connect_db   (off  ,  off)  Allow httpd to can network connect db
```

```bash Terminal
sudo setsebool -P httpd_can_network_connect on
```

`-P` lo hace permanente. Sin `-P`, se pierde al reiniciar.

### Puertos

Si la API escuchara en un puerto que la política no conoce como «puerto web», el bloqueo sería otro: SELinux también etiqueta puertos.

```text Terminal · semanage port -l | grep ^http_port_t
http_port_t                    tcp      80, 81, 443, 488, 8008, 8009, 8443, 9000
```

Para darle esa etiqueta a otro puerto:

```text Terminal
$ sudo semanage port -a -t http_port_t -p tcp 8000
Port tcp/8000 already defined, modifying instead
```

El 8000 ya tenía otra etiqueta en la política de Rocky 9, así que `semanage` la cambió. Con un puerto sin etiqueta, la agrega sin ese aviso.

### Archivos fuera de su lugar

Servir un sitio desde `/srv/sitio` en lugar de `/var/www`: los archivos copiados ahí tienen una etiqueta genérica, y Nginx no los puede leer. Se registra la etiqueta correcta para ese camino y se aplica:

```bash Terminal
sudo semanage fcontext -a -t httpd_sys_content_t "/srv/sitio(/.*)?"
sudo restorecon -Rv /srv/sitio
```

`semanage fcontext` guarda la regla en la política; `restorecon` la aplica. Un `chcon` hace lo mismo de forma temporal, y se pierde con el próximo `restorecon`.

Y un detalle que confunde: **`mv` conserva la etiqueta de origen, `cp` toma la del destino.** Un archivo movido desde tu home a `/var/www` llega con la etiqueta de tu home.

## No lo desactives

La respuesta que aparece en todos los foros es `setenforce 0`. Funciona, y te deja sin la capa que justamente evita que una vulnerabilidad en Nginx se convierta en acceso a todo el servidor.

El procedimiento correcto:

1. Mirar el bloqueo: `ausearch -m avc` en SELinux, `journalctl -k | grep DENIED` en AppArmor.
2. Buscar si hay un booleano o una etiqueta pensada para ese caso, que casi siempre la hay.
3. Solo si no, `audit2allow -M mimodulo` genera un módulo de política a partir de los bloqueos; leelo antes de cargarlo, porque permite exactamente lo que se bloqueó, incluso si lo que se bloqueó era un ataque.

Si necesitás descartar que el problema sea SELinux, `setenforce 0` por cinco minutos, probar, y `setenforce 1`. Es un diagnóstico, no una solución.

> **Quedate con esto**
> El control de acceso obligatorio limita lo que puede hacer cada programa, aunque corra como root. AppArmor trabaja con caminos y perfiles; SELinux con etiquetas en archivos, procesos y puertos. Un *Permission denied* con permisos correctos es casi siempre uno de los dos. En SELinux, `ausearch` y `audit2why` dicen qué pasó, y la salida suele ser un booleano con `setsebool -P` o una etiqueta con `semanage` y `restorecon`. Desactivarlo es diagnóstico de cinco minutos, no una solución.
