---
title: "Contenedores por dentro: namespaces y cgroups"
description: Un contenedor no es una máquina virtual. Es un proceso con una vista limitada del sistema y un límite de recursos, y se puede armar a mano con unshare.
date: 2026-10-19
topic: Infraestructura
tags: [linux, contenedores, docker]
goal: Entender qué es un contenedor a nivel del kernel para diagnosticar y asegurar los que corrés.
course: linux-administracion
section: virtualizacion
order: 3
---

Una VM tiene su propio kernel. Un contenedor **no**: es un proceso común del host al que el kernel le muestra una versión recortada del sistema y le pone límites. Todo lo que Docker, Podman o Kubernetes hacen se apoya en dos mecanismos del kernel.

| | Máquina virtual | Contenedor |
|---|---|---|
| Kernel | El suyo | El del host |
| Arranca en | Decenas de segundos | Milisegundos |
| Aislamiento | Fuerte: hardware virtual | El del kernel: una vulnerabilidad del kernel lo cruza |
| Puede correr otro sistema operativo | Sí, Windows sobre Linux | No: solo Linux sobre Linux |
| Overhead | Un sistema operativo entero | Casi nada |

## Namespaces: qué ve el proceso

Un *namespace* le da a un proceso su propia versión de un recurso del sistema:

| Namespace | Aísla |
|---|---|
| `pid` | Los procesos: adentro, el primero es el PID 1 |
| `mnt` | Los montajes: su propio árbol de archivos |
| `net` | La red: sus interfaces, IPs y puertos |
| `uts` | El nombre de host |
| `ipc` | La memoria compartida |
| `user` | Los usuarios: root adentro puede ser nadie afuera |
| `cgroup` | La vista de los cgroups |

Se pueden crear a mano con `unshare`. Afuera:

```text Terminal
procesos visibles: 51, hostname: servidor
```

Con namespaces de procesos, de montajes y de hostname nuevos:

```text Terminal · sudo unshare --pid --fork --mount-proc --uts bash -c 'hostname caja; ...'
procesos visibles: 4, hostname: caja
    PID COMMAND
      1 ps
```

El proceso ve cuatro procesos en lugar de cincuenta y uno, el suyo es el PID 1, y cambió el hostname sin afectar al servidor. Eso, con un sistema de archivos propio, es un contenedor.

Con un namespace de red nuevo, el proceso no tiene red:

```text Terminal · sudo unshare --net ip -brief link
lo               DOWN           00:00:00:00:00:00 <LOOPBACK>
```

Docker crea ese namespace y le conecta un par de interfaces virtuales hacia un puente en el host; así tiene red cada contenedor.

`lsns` lista los namespaces que existen:

```text Terminal · lsns -t pid -t mnt
        NS TYPE NPROCS   PID USER           COMMAND
4026532383 mnt      48     1 root           /sbin/init
4026532386 pid      50     1 root           /sbin/init
4026532387 mnt       1   269 facturacion    |-/srv/facturacion/app/.venv/bin/python .../uvicorn facturacion.web:app ...
4026532388 mnt       1    73 root           `-/usr/lib/systemd/systemd-udevd
```

La API de facturación tiene **su propio namespace de montajes**, sin ser un contenedor. Es el endurecimiento de [la unidad de systemd](/blog/linux/servicios-systemd): `ProtectSystem=strict` y `PrivateTmp=yes` se implementan así. Los mismos mecanismos, otra herramienta.

## cgroups: cuánto puede usar

Los *control groups* agrupan procesos y les ponen límites de CPU, memoria, disco y cantidad de procesos. systemd pone cada servicio en el suyo:

```text Terminal · cat /proc/$(systemctl show -p MainPID --value facturacion)/cgroup
0::/system.slice/facturacion.service
```

Y un límite es escribir en un archivo de ese grupo, que systemd hace por vos:

```bash Terminal
sudo systemctl set-property --runtime facturacion MemoryMax=300M CPUQuota=50%
```

```text Terminal · Los archivos del cgroup
memory.max=314572800 cpu.max=50000 100000 memory.current=79044608
```

`memory.max` en bytes; `cpu.max` es «50 000 microsegundos de cada 100 000»: medio núcleo. `--runtime` aplica hasta el próximo reinicio; sin él, queda en un drop-in.

Es exactamente lo que hacen `docker run --memory 300m --cpus 0.5` y los `resources.limits` de Kubernetes. Y cuando un contenedor supera su `memory.max`, actúa el mismo OOM killer de [diagnóstico](/blog/linux/diagnostico), solo dentro de ese grupo.

## Lo que falta para un contenedor

Namespaces y cgroups son el aislamiento. Lo que agrega un motor de contenedores:

| Pieza | Hace |
|---|---|
| **Imagen** | El sistema de archivos del contenedor, en capas de solo lectura |
| **overlayfs** | Junta las capas y agrega una de escritura arriba, que se pierde al borrar el contenedor |
| **Capabilities** | Le quita a root adentro casi todos sus poderes |
| **seccomp** | Bloquea llamadas al sistema peligrosas |
| **AppArmor o SELinux** | Un perfil por contenedor |

## Consecuencias prácticas

**Root adentro es root afuera**, salvo que se usen *user namespaces*. Si un proceso escapa del contenedor por una vulnerabilidad, es root en el host. Por eso las imágenes corren con un usuario sin privilegios, como la de la [lección siguiente](/blog/linux/docker).

**Un contenedor privilegiado no está aislado.** `--privileged` le devuelve todas las capabilities y acceso a los dispositivos del host. El laboratorio de este curso usa contenedores privilegiados para poder simular discos y firewalls; en producción, nunca, salvo herramientas de infraestructura que lo necesitan de verdad.

**Los contenedores comparten el kernel.** Por eso el laboratorio no pudo probar snapshots de LVM, ni AppArmor, ni servidores NFSv4 completos: dependen de módulos del kernel del host. Una VM sí hubiera podido.

**El reloj, los módulos y los parámetros del kernel son del host.** Un `sysctl` dentro de un contenedor, cuando se permite, puede cambiarlo para todos.

> **Quedate con esto**
> Un contenedor es un proceso del host con namespaces, que limitan lo que ve, y cgroups, que limitan lo que usa. `unshare` arma uno a mano; `lsns` y `/proc/PID/cgroup` muestran los de cualquier proceso. El endurecimiento de systemd usa los mismos mecanismos. Comparten el kernel, así que root adentro es root afuera si escapa: imágenes sin root y nunca `--privileged` en producción.
