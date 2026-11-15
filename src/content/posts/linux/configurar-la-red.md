---
title: "Configurar la red: ip, netplan y NetworkManager"
description: Cambios temporales con ip, configuración permanente con netplan en Ubuntu y nmcli en Rocky, nombre de host y resolución de nombres con systemd-resolved.
date: 2026-10-19
topic: Infraestructura
tags: [linux, redes, netplan]
goal: Darle a un servidor una IP fija y una configuración de DNS que sobreviva a los reinicios, sin quedarte afuera en el intento.
course: linux-administracion
section: redes
order: 2
---

En la nube, la red la configura cloud-init con DHCP y casi nunca la tocás. En una oficina o un datacenter, el servidor de facturación necesita una **IP fija**: los demás lo buscan ahí, y el DNS interno apunta a esa dirección.

## ip: cambios que no sobreviven

`ip` reemplazó a `ifconfig` y `route`. Lo que hace es inmediato y **se pierde al reiniciar**:

```bash Terminal
ip -brief addr                                 # direcciones
ip -brief link                                 # interfaces y su estado
ip route                                       # rutas
sudo ip addr add 192.168.10.21/24 dev eth1     # una IP más, temporal
sudo ip link set eth1 down                     # bajar una interfaz
```

Sirve para probar y para diagnosticar. Para que quede, se escribe en la configuración de la distribución.

## netplan, en Ubuntu

Ubuntu describe la red en YAML en `/etc/netplan/`, y netplan la traduce a la configuración de `systemd-networkd` o NetworkManager. Una IP fija:

```yaml /etc/netplan/60-servidor.yaml
network:
  version: 2
  ethernets:
    lan0:
      match:
        macaddress: "52:54:00:12:34:56"
      set-name: lan0
      addresses:
        - 192.168.10.20/24
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses: [192.168.10.2, 192.168.10.3]
        search: [empresa.internal]
```

`match` por dirección MAC y `set-name` le dan a la interfaz un nombre estable, como los UUID de los discos. Los permisos importan: netplan se queja si el archivo es legible por otros, porque puede contener claves de WiFi.

```bash Terminal
sudo chmod 600 /etc/netplan/60-servidor.yaml
sudo netplan generate
```

`generate` valida y produce lo que va a aplicar:

```ini /run/systemd/network/10-netplan-lan0.network
[Match]
PermanentMACAddress=52:54:00:12:34:56
Name=lan0

[Network]
LinkLocalAddressing=ipv6
Address=192.168.10.20/24
DNS=192.168.10.2
DNS=192.168.10.3
Domains=empresa.internal

[Route]
Destination=0.0.0.0/0
Gateway=192.168.10.1
```

### netplan try

Cambiar la red de un servidor remoto es la forma más rápida de quedarte afuera. netplan tiene un comando para eso:

```bash Terminal
sudo netplan try
```

Aplica la configuración y espera 120 segundos a que confirmes con Enter. Si perdiste la conexión y no podés confirmar, **vuelve sola a la configuración anterior**. Usalo siempre en un servidor al que entrás por la red. `sudo netplan apply` aplica sin red de seguridad.

Las imágenes cloud traen `/etc/netplan/50-cloud-init.yaml`, generado por cloud-init. No lo edites: lo regenera. Si necesitás cambiar algo, un archivo con número mayor, o desactivá la red de cloud-init con `network: {config: disabled}` en `/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`.

## NetworkManager, en Rocky

La familia Red Hat usa NetworkManager, y se maneja con `nmcli`:

```bash Terminal
nmcli connection show
sudo nmcli connection modify "System eth0" \
  ipv4.method manual \
  ipv4.addresses 192.168.10.20/24 \
  ipv4.gateway 192.168.10.1 \
  ipv4.dns "192.168.10.2 192.168.10.3" \
  ipv4.dns-search empresa.internal
sudo nmcli connection up "System eth0"
```

Guarda la configuración en `/etc/NetworkManager/system-connections/`. No tiene un equivalente directo de `netplan try`; si lo hacés por SSH, programá un `nmcli connection up` con la configuración anterior antes de aplicar, por las dudas.

## El nombre de la máquina

```bash Terminal
sudo hostnamectl set-hostname facturacion-01
hostnamectl
```

Y en `/etc/hosts`, el nombre apuntando a sí mismo, para que los programas que buscan su propio nombre no dependan del DNS:

```text /etc/hosts
127.0.0.1      localhost
127.0.1.1      facturacion-01.empresa.internal facturacion-01
```

## Resolución de nombres

Cuando un programa busca `servidor`, el orden lo decide `/etc/nsswitch.conf`:

```text Terminal · grep ^hosts /etc/nsswitch.conf
hosts:          files dns
```

Primero `/etc/hosts`, después el DNS. `getent hosts nombre` resuelve como lo haría cualquier programa, pasando por ese orden; `dig`, que vas a ver en la [lección siguiente](/blog/linux/diagnostico-de-red), pregunta directo al DNS y se saltea `/etc/hosts`.

En Ubuntu, el DNS lo maneja `systemd-resolved`. `/etc/resolv.conf` es un enlace a un archivo que apunta a `127.0.0.53`, un resolvedor local que reenvía a los servidores configurados en netplan:

```bash Terminal
resolvectl status          # qué servidores DNS usa cada interfaz
resolvectl query servidor.empresa.internal
resolvectl flush-caches
```

No edites `/etc/resolv.conf` a mano en Ubuntu: lo pisa resolved. Los servidores DNS se configuran en netplan.

En el laboratorio, que corre en contenedores, `/etc/resolv.conf` apunta a `127.0.0.11`, el DNS interno de Docker; en un servidor de verdad vas a ver `127.0.0.53`.

> **Quedate con esto**
> `ip` para mirar y probar, pero se pierde al reiniciar. En Ubuntu la red se escribe en netplan, archivos con permisos `600`, y se aplica con `netplan try`, que vuelve atrás sola si te quedás afuera. En Rocky, `nmcli`. No edites lo que genera cloud-init ni `/etc/resolv.conf` en Ubuntu. Y `getent hosts` resuelve como los programas; `dig` solo pregunta al DNS.
