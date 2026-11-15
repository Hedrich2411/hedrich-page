---
title: "TCP/IP para administradores"
description: Direcciones, máscaras, rangos privados, puertos y sockets. Lo justo de redes para saber qué escucha tu servidor y desde dónde se puede llegar.
date: 2026-10-19
topic: Infraestructura
tags: [linux, redes]
goal: Leer la configuración de red de un servidor y saber exactamente qué servicios están expuestos.
course: linux-administracion
section: redes
order: 1
---

No hace falta saber de redes como un ingeniero de telecomunicaciones para administrar un servidor. Hace falta poder responder tres preguntas: **qué dirección tiene, por dónde sale, y qué está escuchando**.

## Las capas, en la práctica

El modelo OSI tiene siete capas; el que usa Internet, TCP/IP, tiene cuatro, y son las que aparecen en los problemas de todos los días:

| Capa | Qué resuelve | Herramienta | Falla típica |
|---|---|---|---|
| Enlace | La placa y el cable, o la red virtual | `ip link` | Interfaz caída |
| Red, IP | Direcciones y rutas | `ip addr`, `ip route`, `ping` | Sin ruta, IP equivocada |
| Transporte, TCP y UDP | Puertos y conexiones | `ss`, `nc` | Nada escuchando, firewall |
| Aplicación | HTTP, DNS, SSH, PostgreSQL | `curl`, `dig`, `ssh` | El servicio responde mal |

Diagnosticar es subir capa por capa: si `ping` no responde, no tiene sentido mirar los logs de Nginx.

## Direcciones y máscaras

```text Terminal · ip -brief addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0@if12        UP             172.20.0.2/16
eth1@if32        UP             192.168.10.20/24
```

`192.168.10.20/24` es la dirección y la máscara en notación CIDR. El `/24` dice que los primeros 24 bits son la **red** y el resto el **host**: todas las direcciones de `192.168.10.0` a `192.168.10.255` están en la misma red y se hablan directo, sin router.

| CIDR | Direcciones | Uso típico |
|---|---|---|
| `/32` | 1 | Una sola máquina, en una regla de firewall |
| `/24` | 256 | Una red de oficina |
| `/16` | 65 536 | Una VPC en la nube |
| `/0` | Todas | «Cualquier origen» |

### Rangos privados

Estas direcciones no se enrutan en Internet; son para redes internas:

| Rango | Dónde lo vas a ver |
|---|---|
| `10.0.0.0/8` | Nubes, empresas grandes |
| `172.16.0.0/12` | Redes de Docker, como la `172.20.0.0/16` del laboratorio |
| `192.168.0.0/16` | Oficinas y casas |
| `127.0.0.0/8` | La propia máquina, *loopback* |

Un servidor en la nube suele tener una IP privada en su interfaz y una pública que el proveedor traduce por NAT. Si `ip addr` no muestra la pública, es normal.

## Rutas

```text Terminal · ip route
default via 172.20.0.1 dev eth0
172.20.0.0/16 dev eth0 proto kernel scope link src 172.20.0.2
```

Para cada paquete, el kernel busca la ruta más específica que coincida con el destino. Lo que es de `172.20.0.0/16` sale directo por `eth0`; todo lo demás va a la **ruta por defecto**, el *gateway* `172.20.0.1`. Sin ruta por defecto, el servidor habla con su red local y con nadie más.

`ip route get 1.1.1.1` dice qué ruta usaría para un destino puntual, y es la forma rápida de responder «¿por qué interfaz sale esto?».

## Puertos

La IP identifica la máquina; el **puerto**, el servicio dentro de ella.

| Puerto | Servicio |
|---|---|
| 22 | SSH |
| 53 | DNS, UDP y TCP |
| 80 / 443 | HTTP / HTTPS |
| 5432 | PostgreSQL |
| 8000 | La API de facturación, en este curso |

TCP establece una conexión y garantiza que los datos llegan en orden; UDP manda paquetes sueltos sin garantías, y por eso es más liviano. HTTP, SSH y PostgreSQL usan TCP; DNS usa UDP para consultas chicas y TCP para las grandes.

## Qué está escuchando

La pregunta más importante de esta lección:

```text Terminal · sudo ss -tlnp
State  Local Address:Port  Process
LISTEN       0.0.0.0:22    "systemd"
LISTEN     127.0.0.1:53    "named"
LISTEN     127.0.0.1:8000  "uvicorn"
LISTEN     127.0.0.1:5432  "postgres"
LISTEN          [::]:22    "systemd"
LISTEN         [::1]:5432  "postgres"
```

`-t` TCP, `-l` solo los que escuchan, `-n` números en lugar de nombres, `-p` el proceso. `-u` agrega UDP.

La columna que importa es la dirección:

| Escucha en | Accesible desde |
|---|---|
| `127.0.0.1` o `[::1]` | Solo la propia máquina |
| Una IP concreta, como `192.168.10.20` | Quien llegue a esa red |
| `0.0.0.0` o `[::]` | **Cualquier interfaz**, incluida la pública |

En el servidor del curso, PostgreSQL y la API escuchan solo en `127.0.0.1`: no se pueden alcanzar desde afuera aunque el firewall falle. SSH escucha en todas, y está bien, porque es la puerta de entrada. Esta tabla es la primera capa de seguridad; el [firewall](/blog/linux/firewall) es la segunda.

El `"systemd"` en el puerto 22 no es un error: en Ubuntu 24.04 el puerto lo abre systemd y le pasa las conexiones a sshd. Tiene consecuencias cuando cambiás el puerto, y están en [SSH](/blog/linux/ssh).

### La configuración por defecto suele ser segura, hasta que no

PostgreSQL en Ubuntu escucha en `localhost` por defecto. El día que alguien necesita conectarse desde su laptop, cambia `listen_addresses = '*'` en `postgresql.conf` y abre la base a Internet. La forma correcta de llegar a un servicio que escucha en `127.0.0.1` es un [túnel SSH](/blog/linux/ssh), sin tocar la configuración.

## Sockets

Un *socket* es la combinación de IP y puerto en cada punta: `127.0.0.1:59870 → 127.0.0.1:8000`. Una conexión está identificada por los dos extremos, y por eso un servidor puede atender miles de conexiones en el mismo puerto.

```bash Terminal
ss -tn state established '( dport = :5432 or sport = :5432 )'
```

Lista las conexiones abiertas con PostgreSQL. Cuando una base se queda sin conexiones disponibles, contar esto por origen dice quién las está acaparando.

> **Quedate con esto**
> Diagnosticar redes es subir capas: enlace, IP, puerto, aplicación. `/24` son 256 direcciones de la misma red; los rangos `10.`, `172.16-31.` y `192.168.` son privados. Sin ruta por defecto el servidor solo ve su red local. Y `ss -tlnp` responde lo más importante: lo que escucha en `127.0.0.1` no es alcanzable desde afuera, lo que escucha en `0.0.0.0` sí.
