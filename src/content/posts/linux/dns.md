---
title: "Un DNS interno con BIND"
description: Resolvedor con caché para la oficina, una zona primaria para empresa.internal, resolución inversa, un secundario con transferencia, y el serial que siempre alguien se olvida de subir.
date: 2026-10-19
topic: Infraestructura
tags: [linux, dns, bind]
goal: Montar un DNS interno con primario y secundario para que los servidores se encuentren por nombre.
course: linux-administracion
section: servicios
order: 1
---

En una oficina con varios servidores, recordar que la API está en `192.168.10.20` dura hasta que la IP cambia. Un DNS interno da nombres estables: `facturacion.empresa.internal`. Y si además cachea las consultas a Internet, la oficina navega un poco más rápido.

## La red de esta sección

| Máquina | IP | Rol |
|---|---|---|
| ns1 | 192.168.10.2 | DNS primario, DHCP, archivos compartidos |
| ns2 | 192.168.10.3 | DNS secundario |
| servidor | 192.168.10.20 | La API de facturación |

## ¿Qué dominio?

`.internal` está reservado por ICANN desde 2024 para uso privado: nunca va a existir en Internet. Es la elección correcta para una red interna. **No uses `.local`**, que es de mDNS y los clientes Mac y Linux lo resuelven de otra forma, ni un dominio inventado como `.empresa`, que algún día alguien puede registrar.

## Dos trabajos distintos

| | Resolvedor recursivo | Servidor autoritativo |
|---|---|---|
| Responde | Cualquier nombre, preguntando a otros y cacheando | Solo los nombres de sus zonas |
| Para quién | Los clientes de la oficina | Cualquiera que pregunte por la zona |

BIND puede hacer los dos, y en una red interna es lo habitual. En Internet, se separan.

## Opciones

```text /etc/bind/named.conf.options
acl oficina { 192.168.10.0/24; 127.0.0.1; };

options {
    directory "/var/cache/bind";
    listen-on { 127.0.0.1; 192.168.10.2; };
    listen-on-v6 { none; };

    recursion yes;
    allow-recursion { oficina; };
    allow-query { oficina; };
    allow-transfer { none; };
    forwarders { 1.1.1.1; 9.9.9.9; };
    dnssec-validation auto;
};
```

**`allow-recursion { oficina; }`** es lo más importante del archivo. Un DNS que resuelve para cualquiera es un *open resolver*, y se usa para ataques de amplificación contra terceros.

**`listen-on`** acota las interfaces. Por defecto BIND escucha en todas, y eso le impidió arrancar a la red virtual de libvirt en la [lección de KVM](/blog/linux/kvm): el puerto 53 ya estaba tomado.

**`forwarders`**: lo que no sabe, lo pregunta a esos resolvedores en lugar de recorrer Internet desde la raíz.

## La zona

```text /etc/bind/named.conf.local
zone "empresa.internal" {
    type primary;
    file "/etc/bind/zonas/db.empresa.internal";
    allow-transfer { 192.168.10.3; };
    also-notify { 192.168.10.3; };
};

zone "10.168.192.in-addr.arpa" {
    type primary;
    file "/etc/bind/zonas/db.192.168.10";
    allow-transfer { 192.168.10.3; };
    also-notify { 192.168.10.3; };
};
```

```text /etc/bind/zonas/db.empresa.internal
$TTL 3600
@   IN  SOA  ns1.empresa.internal. admin.empresa.internal. (
             2026101901 ; serial: AAAAMMDDnn
             3600       ; refresh
             900        ; retry
             1209600    ; expire
             300 )      ; TTL de respuestas negativas
    IN  NS   ns1.empresa.internal.
    IN  NS   ns2.empresa.internal.

ns1          IN  A      192.168.10.2
ns2          IN  A      192.168.10.3
servidor     IN  A      192.168.10.20
facturacion  IN  CNAME  servidor
```

| Registro | Es |
|---|---|
| `SOA` | Los datos de la zona: el primario, el correo del responsable (con `.` en lugar de `@`) y los tiempos |
| `NS` | Los servidores de la zona |
| `A` / `AAAA` | Nombre → IPv4 / IPv6 |
| `CNAME` | Un alias de otro nombre |
| `PTR` | IP → nombre, en la zona inversa |
| `MX` | El servidor de correo |
| `TXT` | Texto libre: verificaciones, SPF, DKIM |

Los nombres que terminan con `.` son completos; los que no, se completan con el nombre de la zona. Olvidarse el punto final en `ns1.empresa.internal` produce `ns1.empresa.internal.empresa.internal`, y es el error más común de un archivo de zona.

La zona inversa traduce IP a nombre; los registros son la última parte de la dirección:

```text /etc/bind/zonas/db.192.168.10
2    IN  PTR  ns1.empresa.internal.
3    IN  PTR  ns2.empresa.internal.
20   IN  PTR  servidor.empresa.internal.
```

## Validar

```text Terminal
$ sudo named-checkconf && echo "named-checkconf ok"
named-checkconf ok
$ sudo named-checkzone empresa.internal /etc/bind/zonas/db.empresa.internal
zone empresa.internal/IN: loaded serial 2026101901
OK
```

Con una IP mal escrita:

```text Terminal
dns_rdata_fromtext: /tmp/mala:13: near '192.168.10.300': bad dotted quad
zone empresa.internal/IN: loading from master file /tmp/mala failed: bad dotted quad
```

`sudo systemctl restart named` la primera vez; después, `sudo rndc reload`.

## El secundario

En ns2, la misma zona como secundaria:

```text /etc/bind/named.conf.local · En ns2
zone "empresa.internal" {
    type secondary;
    primaries { 192.168.10.2; };
    file "db.empresa.internal";
};
```

Al arrancar, pide la zona al primario:

```text Terminal · journalctl -u named, en ns2
transfer of 'empresa.internal/IN' from 192.168.10.2#53: Transfer status: success
transfer of 'empresa.internal/IN' from 192.168.10.2#53: Transfer completed: 1 messages, 8 records, 231 bytes, 0.001 secs (231000 bytes/sec) (serial 2026101901)
```

Y responde igual que el primario:

```text Terminal
$ dig @192.168.10.2 servidor.empresa.internal +short
192.168.10.20
$ dig @192.168.10.3 facturacion.empresa.internal +noall +answer
facturacion.empresa.internal. 3600 IN	CNAME	servidor.empresa.internal.
servidor.empresa.internal. 3600	IN	A	192.168.10.20
$ dig @192.168.10.2 -x 192.168.10.20 +short
servidor.empresa.internal.
$ dig @192.168.10.2 noexiste.empresa.internal | grep status
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 39586
```

Y a cualquier otro que pida la zona entera, se la niega:

```text Terminal · dig @192.168.10.2 empresa.internal AXFR
; Transfer failed.
```

## El serial

Se agrega un registro en el primario y se recarga, **sin cambiar el serial**:

```text Terminal
sin subir el serial -> ns1: 192.168.10.2 ns2:
```

El primario lo responde; el secundario no se entera. Compara seriales, y como el número no cambió, cree que tiene la última versión. Con el serial nuevo:

```text Terminal
$ named-checkzone empresa.internal /etc/bind/zonas/db.empresa.internal | head -1
zone empresa.internal/IN: loaded serial 2026101902
$ sudo rndc reload empresa.internal
con serial nuevo -> ns2: 192.168.10.2
```

```text Terminal · journalctl -u named, en ns2
zone empresa.internal/IN: notify from 192.168.10.2#36001: serial 2026101902
zone empresa.internal/IN: transferred serial 2026101902
```

El formato `AAAAMMDDnn` hace que el serial siempre suba: `2026101901`, `2026101902` el mismo día, `2026102001` al siguiente. **Cada cambio en la zona, un serial más alto.** Es el error número uno de los DNS administrados a mano, y una razón para generar las zonas con Ansible.

## La caché

```text Terminal
$ dig @192.168.10.2 example.com | grep 'Query time'
;; Query time: 28 msec
$ dig @192.168.10.2 example.com | grep 'Query time'
;; Query time: 0 msec
```

La segunda vez responde de la caché. Por cuánto tiempo, lo dice el TTL del registro.

## Que los clientes lo usen

En netplan, como en [configurar la red](/blog/linux/configurar-la-red): `nameservers: addresses: [192.168.10.2, 192.168.10.3]` y `search: [empresa.internal]`, que permite escribir `servidor` en lugar del nombre completo. En la oficina, se reparte con DHCP, que es la [lección siguiente](/blog/linux/dhcp).

> **Quedate con esto**
> `.internal` para redes privadas, nunca `.local`. Recursión solo para la red propia, o es un *open resolver*, y `listen-on` acotado. Los nombres completos terminan con punto. Validá con `named-checkconf` y `named-checkzone`, y recargá con `rndc reload`. Un secundario solo copia cambios si el serial sube: formato `AAAAMMDDnn` y subirlo en cada cambio. Y la transferencia de zona, solo hacia los secundarios.
