---
title: "Diagnosticar un servidor lento o caído"
description: Un método para no adivinar, la carga del sistema bien leída, memoria y swap, disco, el OOM killer en acción y las herramientas para hardware.
date: 2026-10-19
topic: Infraestructura
tags: [linux, diagnostico, rendimiento]
goal: Encontrar con método por qué un servidor está lento, sin cambiar cosas al azar.
course: linux-administracion
section: recuperacion
order: 3
---

«La API está lenta» tiene cientos de causas posibles. Probarlas al azar, reiniciando servicios y cambiando parámetros, borra justo la evidencia que necesitás. Primero se mira, después se toca.

## El método USE

Para cada recurso, tres preguntas:

| | CPU | Memoria | Disco | Red |
|---|---|---|---|---|
| **U**so: ¿qué tan ocupado está? | `top`, `vmstat` | `free` | `iostat` | `ip -s link` |
| **S**aturación: ¿hay cola esperando? | carga, `r` en vmstat | swap, `si/so` | `aqu-sz`, `wa` | descartes |
| **E**rrores: ¿hay fallas? | — | OOM killer | `dmesg`, SMART | errores en la interfaz |

Recorrer la tabla toma cinco minutos y casi siempre señala al culpable.

## Los primeros sesenta segundos

```bash Terminal
uptime
dmesg -T | tail
vmstat 1 5
free -h
iostat -xz 1 3
top
journalctl -p err -b
```

Uno por uno, con lo que muestran en el laboratorio.

## La carga

```text Terminal · uptime
 21:54:30 up 15 min,  0 user,  load average: 0.48, 0.27, 0.15
```

Los tres números son el promedio de procesos **corriendo o esperando** en el último minuto, cinco y quince. Se leen contra la cantidad de núcleos, `nproc`:

| Carga en una máquina de 4 núcleos | Significa |
|---|---|
| 1 | Holgada |
| 4 | Ocupada al límite |
| 12 | Tres procesos esperando por cada núcleo |

Comparar los tres dice la tendencia: `8.0, 4.0, 1.0` es algo que empezó hace un rato y está subiendo.

Una trampa de Linux: la carga cuenta también los procesos en estado `D`, esperando disco o red. Una carga de 30 con la CPU ociosa no es falta de CPU: es un disco o un montaje NFS colgado. `ps -eo stat,pid,comm | awk '$1 ~ /^D/'` los encuentra.

## vmstat

```text Terminal · vmstat 1 3
procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu
 1  0      0 13899292  16184 1086956    0    0  1685  4682 4590    3  1  1 99  0  0  0
 0  0      0 13899256  16184 1087048    0    0     0     0  866  665  0  0 100  0  0  0
```

La primera línea es el promedio desde el arranque; las que importan son las siguientes.

| Columna | Si es alta |
|---|---|
| `r` | Procesos esperando CPU. Más que núcleos: falta CPU |
| `b` | Procesos bloqueados en disco |
| `si`, `so` | Memoria entrando y saliendo de swap. Si no es cero de forma sostenida, falta RAM |
| `wa` | CPU esperando disco |
| `st` | Tiempo que el hipervisor le da a otras VMs. En una nube barata, tu VM compite |

## Memoria

```text Terminal · free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       1.5Gi        13Gi        62Mi       1.1Gi        14Gi
Swap:          4.0Gi          0B       4.0Gi
```

La columna que importa es **`available`**: lo que se puede usar sin hacer swap. `free` es engañosa porque Linux usa la RAM libre como caché de disco (`buff/cache`) y la devuelve cuando alguien la pide. «Tengo poca memoria libre» casi nunca es un problema; «tengo poca *available*», sí.

## Presión

Los kernels modernos miden directamente cuánto tiempo los procesos esperaron por un recurso:

```text Terminal · cat /proc/pressure/memory /proc/pressure/cpu
some avg10=0.00 avg60=0.00 avg300=0.00 total=0
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
some avg10=0.00 avg60=0.01 avg300=0.00 total=1105711
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
```

`some avg10=25.00` en memoria significa que en los últimos diez segundos algún proceso pasó el 25 % del tiempo esperando memoria. Es la métrica más directa de «está sufriendo», y la usan systemd-oomd y Kubernetes.

## El OOM killer

Cuando la memoria se acaba de verdad, el kernel elige un proceso y lo mata para salvar el resto. En el laboratorio, un servicio limitado a 64 MB que pide memoria sin parar:

```bash Terminal
sudo systemd-run --unit=come-memoria -p MemoryMax=64M -p MemorySwapMax=0 \
  python3 -c 'b = []
while True: b.append(bytearray(10_000_000))'
```

```text Terminal · systemctl status come-memoria
× come-memoria.service - /usr/bin/python3 -c ...
     Active: failed (Result: oom-kill) since Mon 2026-10-19 21:54:33 UTC; 3s ago
```

```text Terminal · journalctl -u come-memoria
come-memoria.service: A process of this unit has been killed by the OOM killer.
come-memoria.service: Main process exited, code=killed, status=9/KILL
come-memoria.service: Failed with result 'oom-kill'.
```

```text Terminal · dmesg
Memory cgroup out of memory: Killed process 20422 (python3) total-vm:83600kB, anon-rss:65280kB, file-rss:6612kB, shmem-rss:0kB, UID:0
```

Es la explicación de muchos «el servicio se reinició solo»: `status=9/KILL` y nadie lo mató a mano. `journalctl -k | grep -i 'out of memory'` lo confirma.

Limitar la memoria de cada servicio con `MemoryMax=` en su unidad hace que, si uno pierde memoria, lo mate a él y no a PostgreSQL. Para que el kernel prefiera no matar a la base, `OOMScoreAdjust=-500` en la unidad de PostgreSQL.

## Disco

`iostat -xz 1 3`, del paquete `sysstat`, muestra una línea por disco con muchas columnas. Las que importan:

| Columna | Si es alta |
|---|---|
| `r_await`, `w_await` | Milisegundos por operación. En SSD, más de 10 ya es lento |
| `aqu-sz` | Cola de operaciones esperando |
| `%util` | Ocupado. En discos que atienden muchas operaciones en paralelo, como NVMe o los de la nube, 100 % no significa saturado |

Para saber **qué proceso** está usando el disco, `sudo iotop -o`. Y si el problema es espacio y no velocidad, [disco lleno](/blog/linux/espacio-en-disco).

## Lo que dijo el kernel

```text Terminal · journalctl -b -p err
servidor kernel: I/O error, dev loop2, sector 2048 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 2
servidor kernel: Buffer I/O error on dev loop2p1, logical block 0, async page read
servidor kernel: Memory cgroup out of memory: Killed process 20422 (python3) total-vm:83600kB
```

`-p err` desde el arranque actual: errores de disco, OOM, servicios que fallaron. En el laboratorio aparecen los errores de los discos de prueba de la [sección de almacenamiento](/blog/linux/discos-y-sistemas-de-archivos) y el OOM de recién. En un servidor real, `I/O error` sobre un disco de verdad es la señal de ir a buscar el backup.

## Hardware

| Para | Comando |
|---|---|
| Qué hardware hay | `sudo lshw -short`, `lscpu`, `lsblk` |
| Salud de un disco | `sudo smartctl -a /dev/sda`, del paquete `smartmontools` |
| Temperaturas | `sensors`, de `lm-sensors` |
| Memoria con errores | Los mensajes `EDAC` en `dmesg` |

En la nube no ves el hardware: un disco que falla se manifiesta como latencias altas y errores de I/O, y la respuesta es reemplazarlo desde la consola del proveedor.

## Logs fuera del servidor

Si el servidor muere, sus logs se van con él. Mandarlos a otro lugar es parte del diagnóstico futuro:

- **journald remoto**, con `systemd-journal-remote` y `systemd-journal-upload`.
- **Un agente** como Promtail, Vector o el del proveedor de nube, que lee el journal y lo manda a Loki, CloudWatch o similares.

Con eso, la pregunta «¿qué pasó a las 3:12?» tiene respuesta aunque el servidor ya no exista.

> **Quedate con esto**
> Primero mirar, después tocar: uso, saturación y errores de cada recurso. La carga se lee contra los núcleos y cuenta también procesos esperando disco. De la memoria, importa `available`, no `free`. Swap entrando y saliendo es falta de RAM. Un servicio que «se reinició solo» con `status=9/KILL` es casi siempre el OOM killer, y `MemoryMax=` por servicio elige a quién le toca. Y los logs fuera del servidor.
