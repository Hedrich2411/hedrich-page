---
title: "Firewall con nftables, ufw y firewalld"
description: Cómo funciona netfilter, un ruleset de nftables escrito y probado, ufw y firewalld como capas encima, y dos trampas reales que te dejan sin DNS o con puertos abiertos sin saberlo.
date: 2026-10-19
topic: Infraestructura
tags: [linux, seguridad, nftables, firewall]
goal: Escribir un firewall de servidor con política de denegar todo, entendiendo lo que pasa por debajo de las herramientas.
course: linux-administracion
section: seguridad
order: 2
---

El firewall de Linux vive en el kernel y se llama **netfilter**. Todo lo demás, `iptables`, `nftables`, `ufw`, `firewalld`, son formas de escribirle reglas.

| Herramienta | Qué es | Dónde |
|---|---|---|
| `iptables` | La interfaz histórica | Todavía en todos lados, hoy traducida a nftables por debajo |
| `nftables` (`nft`) | La interfaz actual de netfilter | Ubuntu y Debian la traen |
| `ufw` | Una capa simple encima | Ubuntu |
| `firewalld` | Una capa con zonas encima | RHEL, Rocky |

Sea cual sea la herramienta, las ideas son las mismas: **cadenas** que se enganchan en distintos puntos del recorrido de un paquete, y **reglas** que se evalúan en orden hasta que una decide.

## El recorrido de un paquete

| Gancho | Pasan por acá los paquetes |
|---|---|
| `input` | Que van dirigidos al propio servidor |
| `output` | Que el servidor genera |
| `forward` | Que el servidor reenvía, como router o hacia contenedores |
| `prerouting`, `postrouting` | Antes y después de decidir la ruta; acá se hace NAT |

Para un servidor común, lo que importa es `input`.

## Un ruleset de nftables

```text /etc/nftables.conf
#!/usr/sbin/nft -f
table inet filtro
delete table inet filtro

table inet filtro {
    set admins {
        type ipv4_addr
        flags interval
        elements = { 192.168.10.0/24 }
    }

    chain entrada {
        type filter hook input priority filter; policy drop;

        ct state established,related accept
        ct state invalid drop
        iif "lo" accept
        meta l4proto { icmp, ipv6-icmp } accept

        tcp dport 22 ip saddr @admins ct state new limit rate 10/minute accept
        tcp dport { 80, 443 } accept

        limit rate 5/minute log prefix "nft descartado: " level info
    }

    chain reenvio {
        type filter hook forward priority filter; policy drop;
    }

    chain salida {
        type filter hook output priority filter; policy accept;
    }
}
```

Línea por línea:

- **`table inet`** sirve para IPv4 e IPv6 a la vez. Con un firewall que solo filtra IPv4, los servicios quedan abiertos por IPv6.
- **`policy drop`**: lo que no se acepta explícitamente, se descarta.
- **`ct state established,related accept`**, primera regla: las respuestas a conexiones que el servidor ya aceptó o inició pasan sin evaluar el resto. Sin ella, el servidor no recibiría las respuestas a sus propios `apt update`.
- **`iif "lo"`**: lo que viene de la propia máquina, como Nginx hablando con la API en `127.0.0.1`.
- **ICMP**: el ping y, sobre todo, los avisos que hacen funcionar bien la red. Bloquearlo rompe cosas de forma sutil.
- **SSH solo desde la red de administración**, con un límite de conexiones nuevas por minuto.
- **El `log` al final** registra lo que se descarta, limitado para no llenar el journal.

### Probarlo antes de cargarlo

```text Terminal
$ sudo nft -c -f /etc/nftables.conf && echo "sintaxis ok"
sintaxis ok
$ sudo nft -f /etc/nftables.conf
$ sudo systemctl enable nftables
```

`-c` valida sin aplicar. Y desde la laptop, en la red de administración, con un servicio escuchando en el 8080:

```text Terminal
Connection to 192.168.10.20 22 port [tcp/ssh] succeeded!
Connection to 192.168.10.20 80 port [tcp/http] succeeded!
nc: connect to 192.168.10.20 port 8080 (tcp) timed out: Operation now in progress
```

Y el mismo SSH, llegando por otra red que no está en `admins`:

```text Terminal
nc: connect to 172.20.0.2 port 22 (tcp) timed out: Operation now in progress
```

`drop` hace que el cliente espere hasta el *timeout*. La alternativa, `reject`, responde al instante que no; es más amable con los clientes legítimos que se equivocan de puerto, y le da al escáner la misma información. Para servidores públicos, `drop` es la costumbre.

### Trampa 1: `flush ruleset` borra lo que no es tuyo

El ejemplo clásico de nftables empieza con `flush ruleset`. Hacelo en un servidor con Docker, fail2ban o Kubernetes y **borrás sus reglas también**. En el laboratorio, ese `flush ruleset` se llevó las reglas NAT que Docker usa para su DNS interno, y el contenedor se quedó sin resolver nombres:

```text Terminal
E: Failed to fetch http://archive.ubuntu.com/ubuntu/...  Temporary failure resolving 'archive.ubuntu.com'
```

Por eso el ruleset de arriba empieza así:

```text /etc/nftables.conf
table inet filtro
delete table inet filtro
```

La primera línea crea la tabla si no existe, la segunda la borra, y el resto la vuelve a definir: recargar es idempotente y no toca ninguna otra tabla.

```text Terminal · nft list tables
table ip nat
table inet filtro
table inet f2b-table
```

`ip nat` es de Docker, `f2b-table` de fail2ban. Conviven.

### Agregar y ver

```bash Terminal
sudo nft add rule inet filtro entrada tcp dport 8443 accept
sudo nft -a list chain inet filtro entrada
```

`add` agrega **al final**, después del `log`; para ubicar una regla en un lugar, `insert` antes de un *handle* o, mejor, editar el archivo y recargar. Lo que agregás con `nft` a mano se pierde al reiniciar; lo que está en `/etc/nftables.conf`, no.

## ufw

En Ubuntu, `ufw` es la forma rápida:

```bash Terminal
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp comment 'SSH desde la red de admins'
sudo ufw allow 80,443/tcp comment 'web'
sudo ufw enable
```

```text Terminal · sudo ufw status verbose
Status: active
Default: deny (incoming), allow (outgoing), deny (routed)

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    192.168.10.0/24            # SSH desde la red de admins
80,443/tcp                 ALLOW IN    Anywhere                   # web
```

`ufw status numbered` y `ufw delete N` para quitar reglas. `ufw allow 'Nginx Full'` usa perfiles que traen los paquetes, pero solo existen si el paquete está instalado.

Y la misma advertencia que con `flush ruleset`: en el laboratorio, `ufw --force reset` también se llevó la tabla NAT de Docker. Las capas encima de netfilter no saben qué reglas son de otros.

### Trampa 2: `limit` abre lo que habías cerrado

Muchas guías recomiendan `ufw limit 22/tcp` contra fuerza bruta. En el laboratorio, después de restringir SSH a la red de administración:

```text Terminal · ufw status, después de ufw limit 22/tcp
22/tcp                     ALLOW       192.168.10.0/24            # SSH desde la red de admins
80,443/tcp                 ALLOW       Anywhere                   # web
22/tcp                     LIMIT       Anywhere
```

`limit 22/tcp` es una regla **desde cualquier origen**: SSH quedó abierto a todo Internet, con límite de velocidad. Para limitar sin abrir, `ufw limit from 192.168.10.0/24 to any port 22 proto tcp`.

## firewalld

En Rocky, firewalld organiza las reglas en **zonas**. La interfaz pública va en `public`:

```bash Terminal
sudo firewall-cmd --zone=public --add-service=http --add-service=https --permanent
sudo firewall-cmd --zone=public --add-rich-rule='rule family=ipv4 source address=192.168.10.0/24 service name=ssh accept' --permanent
sudo firewall-cmd --reload
sudo firewall-cmd --zone=public --list-all
```

`--permanent` escribe la configuración; sin él, el cambio se pierde al recargar. En Rocky 9 la zona `public` viene con `ssh`, `dhcpv6-client` y **`cockpit`** abiertos:

```text Terminal · firewall-cmd --zone=public --list-services
cockpit dhcpv6-client http https ssh
```

Cockpit es una consola web de administración en el puerto 9090. Si no la usás, `--remove-service=cockpit --permanent`.

## Docker y el firewall

Cuando Docker publica un puerto, `-p 8000:8000`, agrega sus propias reglas de NAT que desvían el tráfico **antes** de que llegue a las reglas de `input` de ufw o firewalld. El resultado es que **un puerto publicado por Docker queda abierto aunque ufw diga que está cerrado**. La documentación de Docker lo advierte.

Dos defensas:

- **Publicar solo en `127.0.0.1`**, `-p 127.0.0.1:8000:8000`, cuando hay un proxy delante. Es lo que hace el compose de la [lección de Docker](/blog/linux/docker).
- Filtrar en la cadena `DOCKER-USER`, que Docker evalúa antes que sus propias reglas.

## El firewall de la nube

En AWS, Azure o cualquier VPS hay además un firewall del proveedor: los *security groups* o las reglas de red. Usá los dos. El de la nube protege aunque el servidor esté mal configurado; el del servidor, aunque alguien abra de más el de la nube.

> **Quedate con esto**
> netfilter está en el kernel; nftables, ufw y firewalld son formas de escribirle reglas. Política `drop` en `input`, las conexiones establecidas primero, `lo` e ICMP aceptados, y solo los puertos necesarios en `table inet`. Validá con `nft -c` y no uses `flush ruleset` si convivís con Docker o fail2ban: borrá solo tu tabla. `ufw limit 22/tcp` abre SSH a todos. Y un puerto publicado por Docker se saltea ufw, así que publicá en `127.0.0.1`.
