---
title: "DHCP con Kea"
description: Por qué ya no se usa isc-dhcp-server, una configuración de Kea con reservas por MAC, cómo validarla y un intercambio DHCP real visto desde el cliente.
date: 2026-10-19
topic: Infraestructura
tags: [linux, dhcp, redes]
goal: Repartir direcciones, DNS y gateway en una red de oficina con un servidor DHCP mantenido.
course: linux-administracion
section: servicios
order: 2
---

En una red de oficina, cada laptop, impresora y teléfono necesita una IP, la puerta de enlace y los DNS. DHCP los reparte. Los servidores, en cambio, van con IP fija, como en [configurar la red](/blog/linux/configurar-la-red).

## Kea, no isc-dhcp-server

Durante veinte años el servidor DHCP de Linux fue `isc-dhcp-server`. ISC, su desarrollador, terminó su mantenimiento en 2022 y lo reemplazó por **Kea**. Ubuntu 24.04 todavía empaqueta el viejo:

```text Terminal · apt-cache show isc-dhcp-server
Version: 4.4.3-P1-4ubuntu2
Section: universe/net
```

pero está en `universe`, con soporte comunitario. Una instalación nueva, con Kea:

```text Terminal
$ sudo apt install kea-dhcp4-server
$ kea-dhcp4 -v
2.4.1
```

## La configuración

Kea se configura en JSON:

```json /etc/kea/kea-dhcp4.conf
{
  "Dhcp4": {
    "interfaces-config": { "interfaces": ["eth1"] },
    "lease-database": { "type": "memfile", "persist": true, "name": "/var/lib/kea/kea-leases4.csv" },
    "valid-lifetime": 86400,
    "renew-timer": 43200,
    "rebind-timer": 75600,
    "option-data": [
      { "name": "domain-name-servers", "data": "192.168.10.2, 192.168.10.3" },
      { "name": "domain-search", "data": "empresa.internal" }
    ],
    "subnet4": [
      {
        "id": 1,
        "subnet": "192.168.10.0/24",
        "pools": [ { "pool": "192.168.10.100 - 192.168.10.199" } ],
        "option-data": [ { "name": "routers", "data": "192.168.10.1" } ],
        "reservations": [
          { "hw-address": "3c:52:82:aa:bb:cc", "ip-address": "192.168.10.50", "hostname": "impresora-contabilidad" }
        ]
      }
    ]
  }
}
```

| Parte | Hace |
|---|---|
| `interfaces` | En qué interfaz atiende. Nunca en la que da a Internet |
| `valid-lifetime` | Cuánto dura una concesión: 24 horas |
| `renew-timer` | A la mitad, el cliente intenta renovar |
| `option-data` global | DNS y dominio de búsqueda para todas las subredes |
| `pools` | El rango que reparte: de .100 a .199 |
| `routers` | La puerta de enlace de esa subred |
| `reservations` | Una IP fija para una MAC: la impresora siempre en .50 |

El plan de direcciones vale la pena escribirlo: `.1` el router, `.2` a `.49` servidores con IP fija, `.50` a `.99` reservas, `.100` a `.199` el pool. Una reserva **fuera** del pool evita que Kea se la dé a otro mientras la impresora está apagada.

## Validar

```text Terminal · sudo kea-dhcp4 -t /etc/kea/kea-dhcp4.conf
INFO  [kea-dhcp4.dhcpsrv/1218.126234918791616] DHCPSRV_CFGMGR_ADD_IFACE listening on interface eth1
INFO  [kea-dhcp4.dhcpsrv/1218.126234918791616] DHCPSRV_CFGMGR_SOCKET_TYPE_DEFAULT "dhcp-socket-type" not specified , using default socket type raw
```

Con un pool que no pertenece a la subred:

```text Terminal
ERROR [kea-dhcp4.dhcp4/1225.131861725366720] DHCP4_PARSER_FAIL failed to create or run parser for configuration element subnet4: subnet configuration failed: a pool ...
```

`sudo systemctl restart kea-dhcp4-server` para aplicarla.

## Un intercambio real

Desde una máquina de la misma red, pidiendo una dirección sin aplicarla, con `dhclient` del paquete `isc-dhcp-client`:

```text Terminal · sudo dhclient -v -1 -sf /bin/true eth1
DHCPDISCOVER on eth1 to 255.255.255.255 port 67 interval 3 (xid=0xee1bad43)
DHCPOFFER of 192.168.10.100 from 192.168.10.2
DHCPREQUEST for 192.168.10.100 on eth1 to 255.255.255.255 port 67 (xid=0x43ad1bee)
DHCPACK of 192.168.10.100 from 192.168.10.2 (xid=0xee1bad43)
bound to 192.168.10.100 -- renewal in 40234 seconds.
```

Las cuatro fases de DHCP, que se recuerdan como **DORA**:

| Paso | Quién | Qué |
|---|---|---|
| **D**iscover | Cliente, a toda la red | «¿Hay algún servidor DHCP?» |
| **O**ffer | Servidor | «Te ofrezco la .100» |
| **R**equest | Cliente, a toda la red | «Acepto la .100 de este servidor» |
| **A**ck | Servidor | «Es tuya por 24 horas» |

El cliente pregunta por *broadcast* porque todavía no tiene IP. Por eso DHCP no cruza routers sin ayuda: para servir varias subredes desde un solo Kea, el router necesita un *DHCP relay*.

La concesión queda registrada en el servidor:

```text Terminal · tail -1 /var/lib/kea/kea-leases4.csv
192.168.10.100,46:06:84:79:c5:b5,,86400,laptop
```

IP, MAC, duración y el nombre que mandó el cliente.

## Dos servidores DHCP en la misma red

Es el problema clásico: alguien conecta un router hogareño en la oficina, ese router trae DHCP, y la mitad de las máquinas empieza a recibir IPs de otra red y deja de funcionar. Se diagnostica mirando el `DHCPOFFER`: `from` dice quién respondió. La defensa en la red es *DHCP snooping* en los switches administrables.

Para alta disponibilidad, Kea tiene su propio mecanismo con dos servidores que se reparten o se respaldan, el *High Availability hook*; dos servidores independientes con pools que se pisan son el problema, no la solución.

## En la nube

En AWS, Azure o cualquier VPS no se monta DHCP: la red del proveedor lo hace. Esta lección es para oficinas, laboratorios y datacenters propios.

> **Quedate con esto**
> isc-dhcp-server dejó de mantenerse en 2022; una instalación nueva va con Kea. Se configura en JSON con pool, opciones y reservas, y se valida con `kea-dhcp4 -t`. Las reservas fuera del pool, y un plan de direcciones escrito. DHCP es DORA por broadcast, así que no cruza routers sin relay. Y un DHCP no autorizado en la red se descubre mirando de quién viene el `OFFER`.
