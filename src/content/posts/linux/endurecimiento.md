---
title: "Endurecer un servidor nuevo"
description: La lista de lo que se hace en la primera hora de un servidor expuesto a Internet, con fail2ban probado y la superficie de ataque medida.
date: 2026-10-19
topic: Infraestructura
tags: [linux, seguridad, fail2ban]
goal: Dejar un servidor recién creado con la superficie de ataque mínima antes de instalar la aplicación.
course: linux-administracion
section: seguridad
order: 1
---

Un servidor con IP pública recibe intentos de acceso por SSH a los pocos minutos de existir. No es nada personal: hay bots que recorren todas las direcciones de Internet todo el tiempo. Lo que sigue es lo que se hace en la primera hora, antes de instalar la aplicación.

## Superficie de ataque

Todo lo que escucha en la red es una puerta. La primera tarea es saber cuáles hay:

```bash Terminal
sudo ss -tlnup
```

Y para cada una, una de tres decisiones:

| Decisión | Ejemplo |
|---|---|
| Lo necesito y lo expongo | SSH, Nginx en 80 y 443 |
| Lo necesito solo adentro | PostgreSQL y la API en `127.0.0.1` |
| No lo necesito | Desinstalarlo, no solo pararlo |

`systemctl list-unit-files --state=enabled` muestra lo que arranca solo. En una imagen mínima hay poco; en una instalación con «todos los extras», bastante.

## La lista

| # | Qué | Dónde se ve |
|---|---|---|
| 1 | Actualizar todo y activar las actualizaciones automáticas de seguridad | [Actualizaciones](/blog/linux/actualizaciones) |
| 2 | Tu usuario con clave SSH y sudo; bloquear el usuario que vino con la imagen | [Usuarios](/blog/linux/usuarios-y-grupos) |
| 3 | SSH sin contraseña, sin root, con `AllowGroups` | [SSH](/blog/linux/ssh) |
| 4 | Firewall con política «denegar todo» y solo los puertos necesarios | [Firewall](/blog/linux/firewall) |
| 5 | fail2ban para cortar fuerza bruta | Esta lección |
| 6 | Servicios internos escuchando en `127.0.0.1` | [TCP/IP](/blog/linux/tcp-ip) |
| 7 | Servicios propios con usuario propio y endurecimiento de systemd | [Servicios de systemd](/blog/linux/servicios-systemd) |
| 8 | Hora correcta | Esta lección |
| 9 | Backups funcionando y probados | [Backups](/blog/linux/backups) |
| 10 | Logs fuera del servidor | [Diagnóstico](/blog/linux/diagnostico) |

Los puntos 2 a 4, en ese orden, y probando cada uno desde una segunda sesión. La mitad de los «me quedé afuera de mi servidor» son el punto 4 antes que el 3.

Todo esto se puede hacer en el primer arranque con [cloud-init](/blog/linux/cloud-init), o con un [playbook de Ansible](/blog/linux/ansible) que es la forma de no olvidarse ninguno en el servidor número diez.

## fail2ban

Lee los logs, cuenta los fallos de autenticación por IP y, al pasar un umbral, bloquea esa IP en el firewall por un tiempo.

```text /etc/fail2ban/jail.d/sshd.local
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
banaction = nftables-multiport
```

`backend = systemd` lee el journal en lugar de un archivo de log, que en Ubuntu 24.04 es lo correcto. `banaction` le dice qué firewall usar.

```text Terminal
$ sudo fail2ban-client -t
OK: configuration test is successful
```

Desde el cliente del laboratorio, siete intentos con un usuario que no existe:

```text Terminal · sudo fail2ban-client status sshd
|  |- Currently failed:	1
|  |- Total failed:	6
   `- Banned IP list:	172.20.0.3
```

```text Terminal · En el cliente
nc: connect to servidor (172.20.0.2) port 22 (tcp) failed: Connection refused
```

fail2ban creó su propia tabla en nftables, `inet f2b-table`, con la IP adentro. Si te bloqueás a vos mismo:

```bash Terminal
sudo fail2ban-client set sshd unbanip 172.20.0.3
```

Y para que nunca te bloquee, `ignoreip = 127.0.0.1/8 192.168.10.0/24` en la sección `[DEFAULT]`.

Con SSH solo por clave, la fuerza bruta no puede funcionar: fail2ban no protege la puerta, protege los logs y la CPU del ruido. Donde de verdad suma es delante de aplicaciones con login por contraseña, como un panel web, con su propio filtro.

## La hora

Los certificados TLS, los tokens, los logs de varias máquinas y la fecha de emisión de un comprobante dependen de la hora. Ubuntu sincroniza con `systemd-timesyncd`:

```bash Terminal
timedatectl
timedatectl timesync-status
```

`System clock synchronized: yes` es lo que tiene que decir. La zona horaria de un servidor conviene dejarla en **UTC**, y que cada aplicación convierta a la hora local cuando la muestra: así los logs de servidores en distintas regiones se pueden comparar. La API de facturación ya calcula «hoy en Lima» por su cuenta.

## Auditar

Para una revisión más completa, `lynis` recorre cientos de controles y devuelve sugerencias priorizadas:

```bash Terminal
sudo apt install lynis
sudo lynis audit system --quick
```

No todo lo que sugiere aplica a tu caso; leelo como una lista de preguntas, no de órdenes.

## Lo que no es endurecer

- **Cambiar el puerto de SSH** reduce ruido, no ataques.
- **Desactivar IPv6** porque sí. Si no lo usás, alcanza con que el firewall lo filtre igual que IPv4, como hace `table inet`.
- **Un antivirus en un servidor Linux** que no recibe archivos de usuarios. Si recibe, como un servidor de correo o de archivos compartidos, sí: ClamAV.

> **Quedate con esto**
> Lo que escucha es lo que se ataca: `ss -tlnup` y para cada puerto decidir si se expone, se cierra a `127.0.0.1` o se desinstala. La primera hora es actualizar, tu usuario con clave, SSH endurecido y después el firewall, en ese orden y probando desde otra sesión. fail2ban con `backend = systemd` corta la fuerza bruta. Servidor en UTC y con la hora sincronizada. Y todo esto en cloud-init o Ansible, para no olvidarse ningún paso.
