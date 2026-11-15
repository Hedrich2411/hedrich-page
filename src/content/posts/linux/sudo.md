---
title: "sudo con el mínimo privilegio"
description: Reglas por comando en drop-ins validados con visudo, cuándo NOPASSWD tiene sentido y por qué sudo su es un mal hábito.
date: 2026-10-19
topic: Infraestructura
tags: [linux, sudo, seguridad]
goal: Dar a cada persona exactamente los privilegios que necesita, con registro de lo que hace.
course: linux-administracion
section: usuarios
order: 2
---

Nadie trabaja como root. Se trabaja con un usuario propio y se eleva con `sudo` cuando hace falta, por tres razones:

- **Queda registro** de quién hizo qué, con el comando completo.
- **Un error de tipeo no es catastrófico por defecto.** `rm -rf /srv/facturacion /` como tu usuario falla en lo que no te pertenece.
- **Se puede dar menos que todo.** El que despliega la API no necesita poder formatear discos.

## Dónde se configura

`/etc/sudoers` es el archivo principal, y **no se edita**. Las reglas propias van en `/etc/sudoers.d/`, un archivo por propósito.

Un error de sintaxis en sudoers deja el sistema sin `sudo`, y en un servidor sin contraseña de root eso significa quedarte sin forma de administrarlo. Por eso todo se valida con `visudo`:

```text Terminal
$ sudo visudo -cf /tmp/deploy.sudoers
/tmp/deploy.sudoers: parsed OK
```

Y cuando falla, dice dónde:

```text Terminal
$ sudo visudo -cf /tmp/roto.sudoers
/tmp/roto.sudoers:1:40: syntax error
%deploy ALL=(root) NOPASSWD /usr/bin/ls
                                       ^
```

Faltaban los dos puntos después de `NOPASSWD`. El procedimiento seguro es escribir el archivo en un temporal, validarlo, e instalarlo con los permisos que sudo exige:

```bash Terminal
sudo visudo -cf /tmp/deploy.sudoers && \
  sudo install -m 0440 /tmp/deploy.sudoers /etc/sudoers.d/deploy
```

Para editar uno existente, `sudo visudo -f /etc/sudoers.d/deploy` hace lo mismo: abre un temporal y valida antes de guardar.

## La forma de una regla

```text Formato
quién   dónde=(como quién)   etiquetas: qué comandos
```

| Regla | Significa |
|---|---|
| `ana ALL=(ALL:ALL) ALL` | Ana puede todo, pidiendo su contraseña |
| `%sudo ALL=(ALL:ALL) ALL` | Cualquiera del grupo `sudo` puede todo |
| `%deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart facturacion` | El grupo `deploy` puede reiniciar la API, sin contraseña |

`%` indica grupo. El segundo campo, `ALL`, es en qué máquinas vale la regla; tiene sentido cuando el mismo archivo se distribuye a muchas.

## Mínimo privilegio, de verdad

El equipo que despliega la API necesita reiniciarla y ver su estado. Nada más:

```text /etc/sudoers.d/deploy
%deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart facturacion, /usr/bin/systemctl status facturacion
```

```text Terminal · sudo -l -U ana
User ana may run the following commands on servidor:
    (root) NOPASSWD: /usr/bin/systemctl restart facturacion, /usr/bin/systemctl status facturacion
```

`sudo -l -U usuario` es la forma de auditar qué puede hacer alguien sin preguntarle.

Tres cuidados al escribir reglas por comando:

**Caminos absolutos.** Una regla con `systemctl` sin camino no se acepta; con camino, no se puede engañar poniendo otro `systemctl` antes en el `PATH`.

**Argumentos fijos.** `/usr/bin/systemctl restart facturacion` permite exactamente eso. `/usr/bin/systemctl` a secas permite `systemctl edit` sobre cualquier unidad, y eso es root completo.

**Nada que abra una shell.** Dar `sudo vim`, `sudo less`, `sudo find` o `sudo python3` es dar root: todos permiten ejecutar comandos desde adentro. Para editar un archivo, `sudoedit /etc/nginx/sites-available/facturacion` en la regla.

## NOPASSWD

Pedir contraseña para `sudo` protege contra una sesión que quedó abierta o una clave SSH robada. Pero si la cuenta no tiene contraseña, porque solo entra por clave, `sudo` con contraseña simplemente no funciona.

| Situación | Razonable |
|---|---|
| Comandos puntuales como reiniciar un servicio | `NOPASSWD` |
| Administración completa, cuentas con contraseña | Con contraseña |
| Administración completa, solo claves SSH y llave en un dispositivo seguro | `NOPASSWD`, como hacen las imágenes cloud con el usuario `ubuntu` |
| Una cuenta usada por Ansible | `NOPASSWD`, en un archivo propio |

Las imágenes cloud de Ubuntu dejan `/etc/sudoers.d/90-cloud-init-users` con `ubuntu ALL=(ALL) NOPASSWD:ALL`. Una vez que creaste tus propias cuentas, ese usuario conviene bloquearlo.

## Malos hábitos

**`sudo su` o `sudo -i` para «trabajar más cómodo».** Todo lo que sigue queda registrado como un único `su`, sin los comandos. Si necesitás varios comandos como root, `sudo` delante de cada uno.

**`sudo` con redirecciones.** `sudo echo x > /etc/archivo` falla porque la redirección la hace tu shell. La forma es `echo x | sudo tee /etc/archivo`, como viste en [la shell](/blog/linux/la-shell).

## El registro

Cada uso de sudo queda en el journal:

```bash Terminal
journalctl _COMM=sudo --since today
```

Con quién lo ejecutó, desde qué terminal, en qué directorio y el comando completo. Es la primera fuente en cualquier incidente.

> **Quedate con esto**
> Las reglas van en `/etc/sudoers.d/`, validadas con `visudo -cf` antes de instalarlas con modo `0440`. Reglas con caminos absolutos y argumentos fijos, y nunca un programa que abra una shell. `NOPASSWD` es razonable para comandos puntuales y cuentas sin contraseña. Y nada de `sudo su`: se pierde el registro de lo que hiciste.
