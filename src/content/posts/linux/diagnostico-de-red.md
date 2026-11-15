---
title: "Diagnosticar la red: DNS, rutas y paquetes"
description: Un procedimiento ordenado para «no conecta», con dig, ping, mtr, nc, curl -v y tcpdump, y cómo distinguir un firewall de un servicio caído.
date: 2026-10-19
topic: Infraestructura
tags: [linux, redes, diagnostico]
goal: Encontrar en minutos en qué capa está una falla de red.
course: linux-administracion
section: redes
order: 3
---

«La API no responde» puede ser el DNS, una ruta, un firewall, el servicio caído o el servicio lento. Cada herramienta mira una capa, y el orden ahorra tiempo.

## El orden

| Pregunta | Herramienta | Si falla |
|---|---|---|
| 1. ¿El nombre resuelve a la IP correcta? | `dig`, `getent hosts` | DNS |
| 2. ¿Llego a la máquina? | `ping`, `mtr` | Ruta o red |
| 3. ¿El puerto está abierto? | `nc -zv` | Firewall o servicio no escuchando |
| 4. ¿El servicio responde bien? | `curl -v` | La aplicación |
| 5. ¿Qué pasa en el cable? | `tcpdump` | Cuando todo lo anterior «está bien» |

## 1. DNS

```text Terminal · dig example.com A +noall +answer +stats
example.com.		199	IN	A	172.66.147.243
example.com.		199	IN	A	104.20.23.154
;; Query time: 0 msec
```

El `199` es el TTL: cuántos segundos más se puede guardar esa respuesta en caché. Después de cambiar un registro DNS, el cambio no se ve en todos lados hasta que vence el TTL anterior.

| Variante | Para |
|---|---|
| `dig +short nombre` | Solo la respuesta |
| `dig @1.1.1.1 nombre` | Preguntar a un servidor específico, saltando el configurado |
| `dig -x 192.168.10.20` | Resolución inversa: de IP a nombre |
| `dig nombre MX`, `TXT`, `NS` | Otros tipos de registro |

Si `dig @1.1.1.1` responde bien y `dig` a secas no, el problema es tu DNS configurado, no el registro. `dig` se saltea `/etc/hosts`; para resolver como lo hace un programa, `getent hosts nombre`.

## 2. Llegar a la máquina

`ping` usa ICMP. Que no responda no prueba nada, porque muchas nubes y firewalls lo bloquean; que responda sí prueba que hay ruta.

`mtr` combina `ping` y `traceroute`: muestra cada salto hasta el destino con su pérdida y su latencia, y es lo que pide cualquier proveedor cuando reportás un problema de red:

```bash Terminal
mtr --report --report-cycles 10 api.empresa.pe
```

Una pérdida en un salto intermedio que no continúa en los siguientes suele ser ese router limitando ICMP, no un problema real. Lo que importa es la pérdida en el destino.

## 3. ¿El puerto está abierto?

```text Terminal
$ nc -zv 127.0.0.1 5432
Connection to 127.0.0.1 5432 port [tcp/postgresql] succeeded!
$ nc -zv -w 2 127.0.0.1 5433
nc: connect to 127.0.0.1 port 5433 (tcp) failed: Connection refused
```

**La forma en que falla dice quién falló:**

| Resultado | Significa |
|---|---|
| `succeeded` | Hay algo escuchando y el firewall lo deja pasar |
| `Connection refused`, al instante | La máquina respondió que **no hay nada** en ese puerto, o un firewall que rechaza |
| `timed out`, después de unos segundos | Nadie respondió: un firewall que **descarta** el paquete, o la máquina no existe |

Desde el cliente del laboratorio contra el servidor con firewall:

```text Terminal
Connection to servidor (172.20.0.2) 22 port [tcp/ssh] succeeded!
Connection to servidor (172.20.0.2) 80 port [tcp/http] succeeded!
nc: connect to servidor (172.20.0.2) port 8080 (tcp) timed out: Operation now in progress
```

Había un servicio escuchando en el 8080, pero el firewall descarta el tráfico: *timeout*. Si en el servidor `ss -tlnp` muestra el puerto escuchando y desde afuera da *timeout*, es el firewall, el del servidor o el de la nube.

## 4. ¿Qué responde el servicio?

```text Terminal · curl -sv -o /dev/null 'http://127.0.0.1:8000/comprobantes?desde=2026-01-01&hasta=2030-12-31'
*   Trying 127.0.0.1:8000...
* Connected to 127.0.0.1 (127.0.0.1) port 8000
> GET /comprobantes?desde=2026-01-01&hasta=2030-12-31 HTTP/1.1
> Host: 127.0.0.1:8000
> User-Agent: curl/8.5.0
>
< HTTP/1.1 200 OK
```

`*` es lo que hace curl, `>` lo que manda, `<` lo que recibe. Probar **desde el propio servidor contra `127.0.0.1`** y después desde afuera contra la IP pública separa dos mundos: si adentro anda y afuera no, el problema está entre medio, en Nginx, el firewall o el DNS.

Para medir dónde se va el tiempo:

```bash Terminal
curl -o /dev/null -s -w 'dns %{time_namelookup}  conexión %{time_connect}  tls %{time_appconnect}  primer byte %{time_starttransfer}  total %{time_total}\n' https://api.empresa.pe/salud
```

Si el primer byte tarda y lo demás no, es la aplicación; si tarda el DNS, es el DNS.

## 5. tcpdump

Cuando todo lo anterior dice que está bien y algo igual falla, se mira el tráfico:

```text Terminal · sudo tcpdump -i lo -nn -c 6 'tcp port 8000'
21:48:05.273085 IP 127.0.0.1.55624 > 127.0.0.1.8000: Flags [S], seq 4236815521, win 65495, length 0
21:48:05.273096 IP 127.0.0.1.8000 > 127.0.0.1.55624: Flags [S.], seq 2497513933, ack 4236815522, length 0
21:48:05.273103 IP 127.0.0.1.55624 > 127.0.0.1.8000: Flags [.], ack 1, win 64, length 0
21:48:05.273154 IP 127.0.0.1.55624 > 127.0.0.1.8000: Flags [P.], seq 1:82, ack 1, length 81
21:48:05.273158 IP 127.0.0.1.8000 > 127.0.0.1.55624: Flags [.], ack 82, length 0
21:48:05.273916 IP 127.0.0.1.8000 > 127.0.0.1.55624: Flags [P.], seq 1:164, ack 82, length 163
```

Las tres primeras líneas son el saludo de TCP: `S` (el cliente pide conexión), `S.` (el servidor acepta), `.` (el cliente confirma). Después, `P.` son datos: 81 bytes de pedido, 163 de respuesta.

Lo que tcpdump revela que nada más muestra:

- **Solo `S` repetidos sin respuesta:** el paquete llega y nadie contesta, o no llega. Firewall.
- **`S` seguido de `R` (reset):** no hay nada escuchando.
- **La conexión se abre y se corta enseguida:** TLS mal configurado, o el servicio rechaza al cliente.

`-w captura.pcap` guarda los paquetes para abrirlos en Wireshark en tu máquina, y `-nn` evita que intente resolver nombres, que en un servidor con DNS roto haría que tcpdump mismo se cuelgue.

> **Quedate con esto**
> Subí por capas: DNS con `dig`, ruta con `ping` y `mtr`, puerto con `nc -zv`, aplicación con `curl -v`. Cómo falla `nc` dice quién falló: *refused* es nada escuchando, *timeout* es un firewall que descarta. Probá primero desde el propio servidor contra `127.0.0.1` y después desde afuera. Y cuando todo «anda» pero no anda, `tcpdump -nn`.
