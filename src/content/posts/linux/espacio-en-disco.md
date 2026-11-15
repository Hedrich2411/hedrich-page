---
title: "Disco lleno: inodos, archivos borrados y swap"
description: Tres situaciones reales en las que df y du no coinciden con lo que esperás, y cómo resolver cada una. Más cuándo un servidor necesita swap.
date: 2026-10-19
topic: Infraestructura
tags: [linux, almacenamiento, diagnostico]
goal: Encontrar qué está ocupando el disco, incluso cuando las herramientas parecen contradecirse.
course: linux-administracion
section: almacenamiento
order: 4
---

«No space left on device» es de los errores más comunes en producción, y no siempre significa lo que parece. PostgreSQL deja de aceptar escrituras, la API empieza a devolver 500 y el journal no puede guardar nada, así que tampoco te enterás bien de por qué.

## Primero, dónde

```bash Terminal
df -h                              # qué sistema de archivos está lleno
sudo du -xh --max-depth=1 / | sort -h | tail
sudo du -xh --max-depth=1 /var | sort -h | tail
```

`-x` no cruza a otros sistemas de archivos, así `du /` no cuenta `/proc` ni discos montados. Bajando de a un nivel se encuentra el culpable en un par de minutos. Los sospechosos de siempre:

| Dónde | Qué suele ser |
|---|---|
| `/var/log` | Logs sin rotar, o un servicio en bucle escribiendo errores |
| `/var/log/journal` | El journal sin límite; `journalctl --vacuum-size=500M` |
| `/var/lib/docker` | Imágenes viejas y logs de contenedores; `docker system df` |
| `/var/backups`, `/srv/backups` | Backups que nadie rota |
| `/var/cache/apt` | `sudo apt clean` |
| `/tmp` | Temporales que un programa no borra |

Hay dos casos donde este procedimiento no encuentra nada, y son los que vale la pena conocer.

## Caso 1: lleno con espacio libre

```text Terminal
$ touch /mnt/chico/uno-mas
touch: cannot touch '/mnt/chico/uno-mas': No space left on device
$ df -h /mnt/chico
/dev/loop5       60M   24K   56M   1% /mnt/chico
```

56 MB libres y no se puede crear un archivo de cero bytes. El problema no es el espacio:

```text Terminal · df -i /mnt/chico
/dev/loop5        128   128     0  100% /mnt/chico
```

Se acabaron los **inodos**. Cada archivo necesita uno, y ext4 fija cuántos hay al formatear. Un directorio de sesiones de PHP, una caché que crea un archivo por pedido o una cola de mail atascada pueden llenarlos con millones de archivos chiquitos.

Para encontrar dónde están:

```bash Terminal
sudo find / -xdev -type f | cut -d/ -f2-3 | sort | uniq -c | sort -n | tail
```

La solución es borrar los archivos que sobran. Si el uso es legítimo, un sistema de archivos formateado con más inodos (`mkfs.ext4 -N`, o `-i` para menos bytes por inodo) o XFS, que los asigna dinámicamente.

## Caso 2: df y du no coinciden

```text Terminal
$ df -h /mnt/g
/dev/loop5       56M   41M   12M  78% /mnt/g
$ du -sh /mnt/g
20K	/mnt/g
```

`df` dice 41 MB usados; `du` encuentra 20 KB. Lo que pasó: alguien borró un log gigante con `rm` mientras un proceso todavía lo tenía abierto. El nombre desapareció del directorio, así que `du` no lo ve, pero **el espacio se libera recién cuando el último proceso lo cierra**, como en los [enlaces duros](/blog/linux/sistema-de-archivos): el contador de referencias no llegó a cero.

```text Terminal · sudo lsof +L1
COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NLINK NODE NAME
tail    2734 root    3r   REG    7,2 41943040     0   12 /mnt/g/log-gigante (deleted)
```

`+L1` lista archivos abiertos con menos de un enlace, es decir, borrados: `NLINK` en 0. Ahí está: `tail`, PID 2734, descriptor 3, 40 MB.

Tres salidas, de mejor a peor:

1. **Reiniciar el servicio** que lo tiene abierto, o `systemctl reload` si con eso reabre sus logs. Es lo limpio.
2. **Vaciarlo sin matar el proceso**, a través de su descriptor en `/proc`:

```bash Terminal
sudo truncate -s 0 /proc/2734/fd/3
```

```text Terminal
$ df -h /mnt/g
/dev/loop5       56M   24K   52M   1% /mnt/g
```

3. Matar el proceso, si no hay otra.

Y la lección para la próxima: **un log en uso no se borra, se vacía**. `: > /var/log/app.log` o `truncate -s 0` liberan el espacio al instante, con el archivo abierto o no. Mejor todavía, que lo maneje [logrotate](/blog/linux/timers-y-logs).

## Reservado para root

`df` muestra algo de espacio «usado» que nadie encuentra en un disco recién formateado. ext4 reserva un 5 % para root, para que el sistema pueda seguir funcionando cuando un usuario llena el disco. En un disco de datos de 1 TB eso son 50 GB:

```bash Terminal
sudo tune2fs -m 1 /dev/datos/postgres     # bajar la reserva al 1 %
```

En el disco del sistema, dejala como está.

## Swap

Swap es disco usado como memoria de reserva. Mucho más lento que la RAM, pero le da al kernel dónde poner memoria que no se usa seguido, en lugar de matar procesos.

| Servidor | Swap |
|---|---|
| VPS chico, de 1 a 2 GB | Sí, 1 o 2 GB: evita que un pico mate a PostgreSQL |
| Servidor con RAM de sobra | Un poco, como red de seguridad |
| Nodo de Kubernetes | Históricamente desactivada; hoy se puede habilitar, pero no es lo habitual |

Las imágenes cloud no traen swap. Un archivo de swap se crea en un minuto:

```bash Terminal
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```text Terminal · mkswap
Setting up swapspace version 1, size = 2 GiB (2147479552 bytes)
```

Y para que el kernel la use solo cuando de verdad hace falta:

```bash Terminal
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swap.conf
sudo sysctl --system
```

Un servidor que usa swap todo el tiempo no tiene un problema de swap: le falta RAM o tiene un proceso que pierde memoria. `free -h` y `vmstat` lo muestran, y está en [diagnosticar un servidor](/blog/linux/diagnostico).

> **Quedate con esto**
> `df -h` para saber qué disco, `du -xh --max-depth=1 | sort -h` para bajar hasta el culpable. Si dice lleno con espacio libre, mirá `df -i`: se acabaron los inodos. Si `df` y `du` no coinciden, un proceso tiene abierto un archivo borrado: `lsof +L1` lo encuentra, y un reinicio del servicio o `truncate` sobre `/proc/PID/fd/N` lo libera. Los logs en uso se vacían, no se borran. Y en un servidor chico, un archivo de swap con `swappiness` bajo.
