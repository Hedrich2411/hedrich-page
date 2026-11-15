---
title: "Señales y comunicación entre procesos"
description: SIGTERM, SIGKILL y SIGHUP, cómo un script limpia antes de salir, por qué pkill -f muerde, y las formas en que dos procesos se pasan datos.
date: 2026-10-19
topic: Infraestructura
tags: [linux, procesos, bash]
goal: Terminar procesos de forma ordenada y entender los mecanismos con los que los procesos se comunican.
course: linux-administracion
section: procesos
order: 2
---

Una señal es un aviso que el kernel le entrega a un proceso. La mayoría significa «terminá», pero de formas distintas, y la diferencia es si el proceso puede limpiar antes de irse.

## Las que importan

| Señal | Número | Se puede atrapar | Para qué |
|---|---|---|---|
| `SIGTERM` | 15 | Sí | «Terminá, por favor». La que manda `kill` por defecto |
| `SIGINT` | 2 | Sí | `Ctrl+C` |
| `SIGHUP` | 1 | Sí | Se cortó la terminal; muchos servicios la usan para releer la configuración |
| `SIGKILL` | 9 | No | El kernel lo elimina, sin aviso |
| `SIGSTOP` / `SIGCONT` | 19 / 18 | No / sí | Pausar y continuar |
| `SIGUSR1` / `SIGUSR2` | 10 / 12 | Sí | Lo que el programa decida |

```text Terminal · kill -l | head -3
 1) SIGHUP	 2) SIGINT	 3) SIGQUIT	 4) SIGILL	 5) SIGTRAP
 6) SIGABRT	 7) SIGBUS	 8) SIGFPE	 9) SIGKILL	10) SIGUSR1
11) SIGSEGV	12) SIGUSR2	13) SIGPIPE	14) SIGALRM	15) SIGTERM
```

## TERM antes que KILL

Un script que deja un archivo de bloqueo mientras trabaja:

```bash /tmp/trabajo.sh
#!/usr/bin/env bash
limpiar() { echo "recibí $1, limpio y salgo"; rm -f /tmp/trabajo.lock; exit 0; }
trap 'limpiar TERM' TERM
trap 'limpiar INT' INT
touch /tmp/trabajo.lock
while true; do sleep 1; done
```

Con `SIGTERM`, el `trap` corre y limpia:

```text Terminal
$ /tmp/trabajo.sh & sleep 1; kill -TERM $!
recibí TERM, limpio y salgo
$ ls /tmp/trabajo.lock
ls: cannot access '/tmp/trabajo.lock': No such file or directory
```

Con `SIGKILL`, el proceso desaparece y el bloqueo queda:

```text Terminal
$ /tmp/trabajo.sh & sleep 1; kill -KILL $!
Killed                  /tmp/trabajo.sh
$ echo $?
137
$ ls /tmp/trabajo.lock
/tmp/trabajo.lock
```

El código de salida es 128 más el número de la señal: 137 es `SIGKILL`, 143 es `SIGTERM`. Cuando un servicio aparece en los logs con `status=9/KILL` o una salida 137, alguien o algo lo mató, muchas veces el [OOM killer](/blog/linux/diagnostico).

Con una base de datos, la diferencia es más seria: `SIGTERM` le da tiempo a terminar las transacciones y escribir a disco; `SIGKILL` la obliga a recuperarse del log al arrancar. **Siempre `SIGTERM` primero, esperar, y recién después `SIGKILL`**. Es exactamente lo que hace `systemctl stop`: manda `SIGTERM`, espera 90 segundos por defecto y, si el proceso sigue vivo, manda `SIGKILL`.

## Recargar sin reiniciar

Muchos servicios atrapan `SIGHUP` para releer la configuración sin cortar conexiones. Nginx, por ejemplo. No hace falta acordarse de la señal: `systemctl reload nginx` hace lo correcto para cada servicio, porque la unidad lo define.

## Encontrar a quién mandar la señal

`pgrep` busca por nombre y `pkill` manda la señal. Con `-f`, buscan en la línea de comandos completa, y ahí hay que tener cuidado:

```text Terminal
$ sleep 300 & sleep 301 &
$ pgrep -af 'sleep 30'
1113 sleep 300
1114 sleep 301
```

El patrón es una expresión regular que se busca **en cualquier parte** de la línea. `pkill -f 'sleep 30'` habría matado a los dos. Un `pkill -f python` en un servidor con varias aplicaciones Python es un incidente.

| Más seguro | Por qué |
|---|---|
| `pkill -x sleep` | Nombre exacto del proceso |
| `pgrep -af patrón` primero, `pkill` después | Mirás antes de disparar |
| `systemctl kill facturacion` | Solo los procesos de ese servicio |
| `kill $(cat /run/app.pid)` | El PID que el propio programa registró |

## Comunicación entre procesos

Las señales solo avisan. Para pasar datos, los procesos tienen otros mecanismos.

**Tuberías anónimas.** El `|` de la shell: la salida de uno es la entrada del siguiente, y solo entre procesos emparentados.

**Tuberías con nombre.** Un archivo especial que conecta procesos que no se conocen:

```bash Terminal
mkfifo /tmp/canal
( read -r linea < /tmp/canal; echo "el lector recibió: $linea" ) &
echo "hola por el pipe" > /tmp/canal
```

```text Terminal
el lector recibió: hola por el pipe
```

El escritor se bloquea hasta que hay un lector, y viceversa. Sirve para conectar un proceso que escribe un log con otro que lo procesa, sin archivos intermedios.

**Sockets Unix.** Como una conexión de red, pero dentro de la máquina y sin pasar por la pila TCP. Es como habla `psql` con PostgreSQL local, o Nginx con PHP-FPM:

```text Terminal · ss -xlp | head -3
Netid State  Local Address:Port
u_str LISTEN /run/dbus/system_bus_socket
u_str LISTEN /run/systemd/private
```

Tienen permisos de archivo, así que se controla quién se conecta con `chmod` y `chown`.

**Memoria compartida.** Lo más rápido: dos procesos ven la misma memoria. PostgreSQL la usa entre sus procesos. En Linux aparece en `/dev/shm`, que es un tmpfs, y a veces se usa como disco en RAM para archivos temporales muy usados.

**Sockets TCP.** Cuando los procesos están en máquinas distintas, o cuando querés que lo parezcan: la API escuchando en `127.0.0.1:8000` y Nginx conectándose. Es lo que vas a ver en [redes](/blog/linux/tcp-ip).

> **Quedate con esto**
> `SIGTERM` deja limpiar, `SIGKILL` no; primero uno, después el otro, que es lo que hace `systemctl stop`. Un código de salida 137 significa que lo mataron con `SIGKILL`. `pkill -f` busca en toda la línea de comandos, así que primero `pgrep -af` para ver a quién le vas a disparar. Y para pasar datos: tuberías, sockets Unix dentro de la máquina, TCP entre máquinas.
