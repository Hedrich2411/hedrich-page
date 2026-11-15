---
title: "Procesos: qué corre, quién lo lanzó y cuánto consume"
description: PID, padre, estado y consumo. Leer ps, pstree y top, qué es un zombi y por qué nohup no es forma de correr un servicio.
date: 2026-10-19
topic: Infraestructura
tags: [linux, procesos]
goal: Inspeccionar los procesos de un servidor y entender lo que cada columna dice.
course: linux-administracion
section: procesos
order: 1
---

Un proceso es un programa en ejecución. Tiene un número (PID), un padre que lo lanzó (PPID), un usuario con cuyos permisos corre, memoria, archivos abiertos y un estado. Todo eso está en `/proc/<PID>/`, y las herramientas solo lo leen y lo ordenan.

## El primero

```text Terminal
$ ps -p 1 -o pid,comm,args
    PID COMMAND         COMMAND
      1 systemd         /sbin/init
```

El PID 1 es systemd, el padre de todo. Si un proceso queda huérfano porque su padre murió, systemd lo adopta.

## ps

`ps aux` es la forma clásica de ver todo. Con `-eo` elegís las columnas, y con `--sort` el orden:

```text Terminal · ps -eo pid,ppid,user,stat,ni,pcpu,pmem,rss,comm --sort=-rss | head -6
    PID    PPID USER     STAT  NI %CPU %MEM   RSS COMMAND
    228       1 bind     Ssl    0  0.0  0.2 42648 named
    231       1 root     Ss     0  0.0  0.1 20128 unattended-upgr
     50       1 root     S<s   -1  0.0  0.0 12844 systemd-journal
      1       0 root     Ss     0  0.1  0.0 12712 systemd
     87       1 root     Ss     0  0.0  0.0  6080 systemd-udevd
```

| Columna | Qué es |
|---|---|
| `RSS` | Memoria física que usa de verdad, en KB |
| `%MEM` | RSS sobre el total |
| `NI` | *Niceness*: de −20 (más prioridad) a 19 (menos) |
| `STAT` | Estado, la primera letra, más modificadores |

Los estados que importan:

| Letra | Estado | Si ves muchos |
|---|---|---|
| `R` | Corriendo o listo para correr | Falta CPU |
| `S` | Durmiendo, esperando algo | Normal |
| `D` | Esperando disco o red, sin poder interrumpirse | El almacenamiento está lento o colgado |
| `Z` | Zombi | Un padre que no hace su trabajo |
| `T` | Detenido | Alguien le mandó `SIGSTOP` o `Ctrl+Z` |

Los modificadores: `s` es líder de sesión, `l` tiene varios hilos, `<` alta prioridad.

## pstree

Quién lanzó a quién:

```text Terminal · pstree -p | head -5
systemd(1)-+-blkmapd(146)
           |-cron(183)
           |-dbus-daemon(184)
           |-named(228)-+-{named}(234)
           |            |-{named}(235)
```

Los que están entre llaves son hilos. Cuando una aplicación lanza procesos hijos, como los *workers* de un servidor web, `pstree -p` muestra la familia completa de un vistazo.

## top

`top` es ps en vivo. Dentro: `M` ordena por memoria, `P` por CPU, `1` muestra cada núcleo, `k` mata un proceso, `q` sale. `htop` es lo mismo más legible, y no viene instalado en todos lados.

La cabecera es la parte más útil:

```text Terminal · top -b -n 1
top - 21:54:33 up 15 min,  0 user,  load average: 0.44, 0.27, 0.15
Tasks:  50 total,   1 running,  49 sleeping,   0 stopped,   0 zombie
%Cpu(s):  0.0 us,  0.0 sy,  0.0 ni, 99.5 id,  0.0 wa,  0.0 hi,  0.5 si,  0.0 st
MiB Mem :  15904.7 total,  13573.5 free,   1559.3 used,   1077.6 buff/cache
```

`wa` es el tiempo esperando disco y `st` el que te «roba» el hipervisor en una VM compartida. Cómo leerlos cuando algo anda lento está en [diagnosticar un servidor](/blog/linux/diagnostico).

## Lo que dice /proc

```text Terminal · /proc/1/status
Name:	systemd
State:	S (sleeping)
PPid:	0
Uid:	0	0	0	0
VmRSS:	   12712 kB
Threads:	1
```

Y `/proc/<PID>/` tiene más: `cmdline` con los argumentos exactos, `environ` con las variables de entorno, `fd/` con los archivos abiertos, `cwd` con el directorio de trabajo. Cuando un proceso hace algo raro, mirar ahí suele ser más rápido que leer su documentación.

## Zombis

Cuando un proceso termina, queda como zombi hasta que su padre lee su código de salida. No consume CPU ni memoria, solo una entrada en la tabla de procesos:

```text Terminal
    PID    PPID STAT COMMAND
   1091    1089 Z    python3
```

Un zombi no se mata, porque ya está muerto. Se arregla con el padre: o lee el estado de sus hijos, o se termina y systemd adopta y limpia a los zombis. Unos pocos son inofensivos; miles acumulándose son un bug en el programa padre.

## Prioridad

```text Terminal
$ nice -n 10 sleep 30 &
$ ps -o pid,ni,comm -p $!
    PID  NI COMMAND
   1094  10 sleep
$ renice -n 15 -p 1094
1094 (process ID) old priority 10, new priority 15
```

Útil para un backup o una compresión pesada que no debería competir con la API: `nice -n 19 pg_dump ...`. Para disco existe lo mismo: `ionice -c3` lo deja usar el disco solo cuando nadie más lo pide.

## Trabajos en la terminal

`comando &` lo manda al fondo, `Ctrl+Z` pausa lo que está corriendo, `bg` lo continúa en el fondo, `fg` lo trae de vuelta y `jobs` los lista.

Y cuando cerrás la sesión SSH, la shell le manda `SIGHUP` a sus trabajos y mueren. `nohup comando &` lo evita, pero **no es forma de correr un servicio**: si se cae, no vuelve a arrancar; si el servidor se reinicia, no arranca; sus logs van a un `nohup.out` que nadie rota. Para eso está [systemd](/blog/linux/servicios-systemd). Para una tarea larga y única, como una migración, `tmux` o `screen` mantienen la sesión viva aunque se corte la conexión.

> **Quedate con esto**
> Todo proceso tiene PID, padre, usuario y estado, y todo está en `/proc/<PID>/`. `ps -eo ... --sort` para elegir columnas, `pstree -p` para la familia, `top` para el vivo. Muchos procesos en `D` señalan disco lento; los zombis se arreglan con el padre. `nice` e `ionice` para tareas pesadas. Y un servicio no se corre con `nohup`.
