---
title: "El sistema de archivos: dónde vive cada cosa"
description: Para qué es cada directorio, qué es un inodo, la diferencia real entre un enlace duro y uno simbólico, y cómo encontrar lo que buscás.
date: 2026-10-19
topic: Infraestructura
tags: [linux]
goal: Saber dónde buscar la configuración, los datos y los logs de cualquier programa.
course: linux-administracion
section: fundamentos
order: 4
---

En Linux hay un solo árbol que empieza en `/`. Los discos no tienen letras: se **montan** en un directorio del árbol, como vas a ver en [discos y sistemas de archivos](/blog/linux/discos-y-sistemas-de-archivos). Y la ubicación de cada cosa no es arbitraria: la define el *Filesystem Hierarchy Standard*.

## Los directorios que importan

| Directorio | Qué hay | En el servidor del curso |
|---|---|---|
| `/etc` | Configuración del sistema, en texto | `/etc/nginx/`, `/etc/ssh/sshd_config.d/`, `/etc/facturacion/` |
| `/var` | Datos que cambian | `/var/log/`, `/var/lib/postgresql/`, `/var/backups/` |
| `/usr` | Programas y bibliotecas de los paquetes | `/usr/bin/psql`, `/usr/lib/systemd/system/` |
| `/usr/local` | Lo que instalás a mano, fuera de los paquetes | `/usr/local/bin/uv`, `/usr/local/sbin/backup-facturacion` |
| `/opt` | Programas de terceros que traen todo en un directorio | Software comercial |
| `/srv` | Datos que el servidor sirve | `/srv/facturacion/` |
| `/home` | Directorios de los usuarios | `/home/ana/` |
| `/root` | El directorio de root | Claves y scripts de root |
| `/tmp` | Temporales, se borran al reiniciar | |
| `/boot` | Kernel y GRUB | |
| `/dev` | Dispositivos | `/dev/vda`, `/dev/null` |
| `/proc`, `/sys` | Ventanas al kernel, no ocupan disco | |
| `/run` | Estado de ejecución, en memoria | PIDs, sockets |

La regla práctica para tu propia aplicación: **código en `/srv` u `/opt`, configuración en `/etc`, datos y logs en `/var`**. Así un backup de `/etc` y `/var` tiene todo lo que importa, y reinstalar el código no toca nada.

En Ubuntu 24.04, `/bin`, `/sbin` y `/lib` son enlaces a sus equivalentes dentro de `/usr`. Es el *usr-merge*, y tiene una consecuencia práctica que aparece en la [lección de paquetes](/blog/linux/paquetes).

## `/proc` y `/sys`

No son archivos en el disco: el kernel los genera al leerlos.

```text Terminal
$ cat /proc/loadavg
0.34 0.26 0.10 1/558 370
$ ls /sys/class/net
eth0
lo
```

`/proc/loadavg` es la carga del sistema; `/proc/<PID>/` tiene todo sobre un proceso; `/proc/meminfo`, la memoria. Las herramientas como `free`, `ps` o `top` no hacen otra cosa que leer estos archivos y darles formato.

## Inodos

Un archivo en el disco tiene dos partes: los **datos** y un **inodo** con todo lo demás: dueño, permisos, fechas, tamaño y dónde están los bloques. El nombre no está en el inodo: está en el directorio, que es una lista de pares «nombre → número de inodo».

```text Terminal · stat /etc/passwd
  File: /etc/passwd
  Size: 1327      	Blocks: 8          IO Block: 4096   regular file
Device: 0,88	Inode: 66197       Links: 1
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
Modify: 2026-10-19 21:40:27.000000000 +0000
Change: 2026-10-19 21:41:06.071846528 +0000
```

`Modify` es cuándo cambió el contenido; `Change`, cuándo cambió el inodo, como un `chmod`. Y los inodos son finitos: un disco puede quedarse sin inodos teniendo gigas libres, como vas a ver en [disco lleno](/blog/linux/espacio-en-disco).

## Enlaces duros y simbólicos

```bash Terminal
echo "hola" > original.txt
ln original.txt duro.txt
ln -s original.txt blando.txt
```

```text Terminal · ls -li
115841 lrwxrwxrwx 1 root root 12 Oct 19 21:42 blando.txt -> original.txt
115840 -rw-r--r-- 2 root root  5 Oct 19 21:42 duro.txt
115840 -rw-r--r-- 2 root root  5 Oct 19 21:42 original.txt
```

El enlace duro tiene **el mismo inodo** (115840) que el original: son dos nombres para el mismo archivo, y el contador de enlaces subió a 2. El simbólico tiene su propio inodo y guarda un **camino**.

Al borrar el original:

```text Terminal
$ rm original.txt
$ cat duro.txt
hola
$ cat blando.txt
cat: blando.txt: No such file or directory
```

El duro sigue funcionando porque los datos se liberan recién cuando el contador de enlaces llega a cero. El simbólico quedó apuntando a un camino que no existe.

| | Duro | Simbólico |
|---|---|---|
| Entre discos distintos | No | Sí |
| A directorios | No | Sí |
| Si se borra el original | Sigue andando | Queda roto |
| Uso típico | Backups incrementales con `rsync --link-dest` | `sites-enabled` → `sites-available`, versiones de una app |

## Mirar y buscar

| Para | Comando |
|---|---|
| Leer un archivo largo | `less` (`/` busca, `G` va al final, `q` sale) |
| El final de un log, en vivo | `tail -f /var/log/nginx/access.log` |
| Qué tipo de archivo es | `file` |
| Buscar por nombre, fecha o tamaño | `find` |
| Cuánto ocupa un directorio | `du -sh` |
| Cuánto espacio queda | `df -h` y `df -i` para inodos |

`find` es el que más rinde:

```bash Terminal
find /var/log -type f -size +10k -mtime -1        # logs de más de 10 KB modificados hoy
find /etc -name '*.conf' -newer /etc/hostname     # configuración que cambió después de la instalación
find /srv -user facturacion -perm -o+w            # archivos de la app que cualquiera puede escribir
find /tmp -type f -mtime +7 -delete               # limpiar temporales viejos
```

Probá siempre sin `-delete` primero, mirá la lista, y recién después agregalo.

> **Quedate con esto**
> Configuración en `/etc`, datos y logs en `/var`, código en `/srv` u `/opt`, y lo instalado a mano en `/usr/local`. `/proc` y `/sys` son el kernel hablando. El nombre de un archivo está en el directorio y todo lo demás en el inodo: un enlace duro es otro nombre para el mismo inodo, uno simbólico es un camino que se puede romper. Y `find` sin `-delete` primero, siempre.
