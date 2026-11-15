---
title: "Editar configuración sin romper nada"
description: Lo mínimo de vim para sobrevivir en cualquier servidor, nano para lo rápido, y la disciplina que evita que un cambio de configuración te deje afuera.
date: 2026-10-19
topic: Infraestructura
tags: [linux, vim]
goal: Cambiar archivos de configuración en un servidor con un procedimiento que siempre se pueda deshacer.
course: linux-administracion
section: fundamentos
order: 5
---

Administrar Linux es, en buena parte, editar archivos de texto en `/etc`. El editor importa menos que el procedimiento: **copiá, editá, validá, aplicá, comprobá**.

## vim, lo justo

vim está en todos lados, incluso en la imagen más mínima, aunque sea como `vi`. No hace falta dominarlo; hace falta poder salir.

vim tiene **modos**. Arranca en modo normal, donde las teclas son comandos y no letras:

| Tecla | Hace |
|---|---|
| `i` | Pasa a modo inserción: ahora escribís texto |
| `Esc` | Vuelve al modo normal |
| `:w` | Guarda |
| `:q` | Sale |
| `:wq` o `ZZ` | Guarda y sale |
| `:q!` | Sale sin guardar |
| `/texto` | Busca; `n` va a la siguiente |
| `dd` | Borra la línea |
| `u` | Deshace |
| `:%s/viejo/nuevo/g` | Reemplaza en todo el archivo |
| `:set number` | Muestra los números de línea |

Si te perdiste: `Esc` dos veces y `:q!`. Volvés a la shell sin haber cambiado nada.

## nano, para lo rápido

nano muestra los atajos abajo de la pantalla: `Ctrl+O` guarda, `Ctrl+X` sale, `Ctrl+W` busca. Para un cambio de una línea es más rápido que vim y nadie te va a juzgar.

El editor por defecto lo eligen `sudoedit`, `crontab -e` y `git` mirando la variable `EDITOR`:

```bash ~/.bashrc
export EDITOR=vim
```

## No edites como root

```bash Terminal
sudoedit /etc/nginx/sites-available/facturacion
```

`sudoedit`, o `sudo -e`, copia el archivo a un temporal, abre **tu** editor como **tu** usuario, y al guardar copia el resultado de vuelta con permisos de root. El editor no corre como root, así que un plugin o un `:!comando` no tienen privilegios, y tu configuración de vim sigue funcionando.

## El procedimiento

**1. Copiá antes de tocar.**

```bash Terminal
sudo cp -a /etc/ssh/sshd_config.d/10-endurecer.conf{,.bak}
```

`{,.bak}` se expande a `archivo archivo.bak`, y `-a` conserva dueño, permisos y fechas.

**2. Mirá qué cambiaste.**

```bash Terminal
diff /etc/ssh/sshd_config.d/10-endurecer.conf{.bak,}
```

```text Terminal
5c5
< MaxAuthTries 3
---
> MaxAuthTries 4
```

**3. Validá con la herramienta del propio programa.** Casi todos los servicios importantes traen una:

| Programa | Validar | Aplicar |
|---|---|---|
| sshd | `sudo sshd -t` | `sudo systemctl reload ssh` |
| Nginx | `sudo nginx -t` | `sudo systemctl reload nginx` |
| sudo | `sudo visudo -c` | Inmediato |
| nftables | `sudo nft -c -f /etc/nftables.conf` | `sudo systemctl reload nftables` |
| BIND | `named-checkconf`, `named-checkzone` | `sudo rndc reload` |
| systemd | `systemd-analyze verify unidad.service` | `sudo systemctl daemon-reload` |
| fstab | `sudo findmnt --verify` | `sudo mount -a` |
| Samba | `testparm` | `sudo systemctl reload smbd` |

Un `sshd -t` que falla te avisa antes de que el servicio se niegue a arrancar:

```text Terminal
/etc/ssh/sshd_config.d/20-prueba.conf: line 1: Bad configuration option: PasswordAutentication
/etc/ssh/sshd_config.d/20-prueba.conf: terminating, 1 bad configuration options
```

**4. Aplicá con `reload` cuando se pueda.** `reload` le pide al servicio que relea la configuración sin cortar lo que está atendiendo; `restart` lo baja y lo sube. Con sshd, un `reload` no corta tu sesión actual.

**5. Comprobá desde afuera, sin cerrar la sesión.** Después de tocar SSH o el firewall, abrí **una segunda terminal** y conectate de nuevo. Si entra, cerrá la primera. Si no, todavía tenés la primera abierta para deshacer.

## Configuración en drop-ins

Muchos programas leen un directorio además del archivo principal: `/etc/ssh/sshd_config.d/`, `/etc/sudoers.d/`, `/etc/sysctl.d/`, `/etc/apt/apt.conf.d/`, `/etc/systemd/system/<unidad>.d/`.

Poné tus cambios ahí, en un archivo propio, y **no toques el principal**. Cuando una actualización trae una versión nueva del archivo principal, el gestor de paquetes no te pregunta qué hacer con tus cambios porque no hay cambios: están en tu archivo.

Una advertencia que vuelve en la [lección de SSH](/blog/linux/ssh): los drop-ins se leen en orden alfabético, y según el programa gana el primero o el último que define algo. En sshd gana el **primero**.

## Versionar `/etc`

Para un servidor que administra más de una persona, `etckeeper` convierte `/etc` en un repositorio git y hace un commit automático en cada instalación de paquetes. Responde la pregunta de cada incidente: «¿qué cambió y cuándo?».

```bash Terminal
sudo apt install etckeeper
sudo etckeeper vcs log --oneline | head
```

Cuando los servidores son varios, el paso siguiente es no editar a mano en absoluto, y eso es [Ansible](/blog/linux/ansible).

> **Quedate con esto**
> En vim, `Esc` y `:q!` te sacan de cualquier lío. Editá con `sudoedit`, no con el editor como root. El procedimiento es siempre el mismo: copiar, editar, validar con la herramienta del programa, aplicar con `reload` y comprobar desde una segunda sesión. Tus cambios van en drop-ins, no en el archivo principal.
