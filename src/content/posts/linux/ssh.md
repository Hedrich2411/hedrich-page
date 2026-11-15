---
title: "SSH a fondo: claves, endurecimiento y túneles"
description: Claves ed25519, el archivo de configuración del cliente, un sshd sin contraseñas ni root, la trampa del orden de los drop-ins, el puerto en Ubuntu 24.04 y túneles para llegar a lo que no está expuesto.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ssh, seguridad]
goal: Entrar a los servidores solo con claves, con un sshd endurecido y verificado, y alcanzar servicios internos sin abrirlos.
course: linux-administracion
section: redes
order: 4
---

SSH es la puerta de entrada a todos tus servidores. Es la configuración que más vale tener bien, y la que más fácil te deja afuera si la tenés mal. En esta lección, la laptop de Ana se conecta al servidor de facturación.

## Claves

```bash Terminal · En la laptop
ssh-keygen -t ed25519 -C "ana@laptop"
```

```text Terminal
-rw------- 1 ana ana 399 Oct 19 21:48 id_ed25519
-rw-r--r-- 1 ana ana  92 Oct 19 21:48 id_ed25519.pub
```

La privada nunca sale de la laptop, y conviene que tenga frase de paso. La pública se copia a cada servidor:

```bash Terminal
ssh-copy-id ana@servidor
```

Que agrega la clave a `~/.ssh/authorized_keys` en el servidor, con los permisos correctos. Si lo hacés a mano, los permisos importan: sshd ignora un `authorized_keys` que otros pueden escribir, y lo hace en silencio.

```bash Terminal · En el servidor, a mano
install -d -m 700 ~/.ssh
echo "ssh-ed25519 AAAA... ana@laptop" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

ed25519 es más corta, más rápida y más segura que RSA. RSA solo para sistemas viejos que no soportan otra cosa, y con 4096 bits.

### La primera conexión

```text Terminal
Warning: Permanently added 'servidor' (ED25519) to the list of known hosts.
```

El cliente guarda la huella del servidor en `~/.ssh/known_hosts`. Si en una conexión futura la huella cambia, SSH se niega a conectar con un aviso enorme: o reinstalaron el servidor, o alguien está en el medio. **No lo ignores borrando la línea sin averiguar por qué cambió.**

## El cliente: ~/.ssh/config

```text ~/.ssh/config
Host prod
    HostName servidor
    User ana
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60

Host bastion
    HostName 203.0.113.10
    User ana

Host interno-*
    ProxyJump bastion
    User ana
```

```text Terminal
$ ssh -n prod 'echo "entré por el alias"'
entré por el alias
```

`ServerAliveInterval` evita que un firewall corte la sesión inactiva. `ProxyJump` es para servidores que no tienen IP pública: SSH entra al bastión y desde ahí salta al interno, en un solo comando: `ssh interno-db1`. El bastión nunca ve tu clave privada, a diferencia de copiarla ahí o de `ForwardAgent`, que se desaconseja.

## El servidor: sshd endurecido

Lo que viene por defecto en Ubuntu 24.04:

```text Terminal · sudo sshd -T | grep -E '^(passwordauth|permitroot|x11|maxauth)'
maxauthtries 6
permitrootlogin without-password
passwordauthentication yes
x11forwarding yes
```

`sshd -T` muestra la configuración **efectiva**, después de leer todos los archivos. Es la única fuente confiable. Un drop-in propio:

```text /etc/ssh/sshd_config.d/10-endurecer.conf
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowGroups ssh-usuarios
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
```

`AllowGroups` es la directiva más potente: solo los usuarios de ese grupo pueden entrar, aunque tengan clave. **Antes de activarla, agregate al grupo.**

```bash Terminal
sudo groupadd -f ssh-usuarios
sudo usermod -aG ssh-usuarios ana
sudo sshd -t && sudo systemctl reload ssh
```

Y verificado desde la laptop:

```text Terminal
$ ssh -o BatchMode=yes root@servidor true
root@servidor: Permission denied (publickey).
$ ssh -o BatchMode=yes -o PubkeyAuthentication=no ana@servidor true
ana@servidor: Permission denied (publickey).
```

`(publickey)` al final dice que el único método aceptado es la clave. Probalo **desde una segunda terminal**, con la primera sesión todavía abierta.

### La trampa del orden

sshd usa el **primer** valor que encuentra para cada opción, y los drop-ins se leen en orden alfabético antes que el archivo principal. Las imágenes cloud traen `/etc/ssh/sshd_config.d/50-cloud-init.conf`, que puede decir `PasswordAuthentication yes`:

```text Terminal
con 99-endurecer: passwordauthentication yes
con 10-endurecer: passwordauthentication no
```

El mismo archivo, con otro nombre, hace lo contrario. Tu drop-in tiene que llamarse con un número **menor** que 50. Y siempre, `sudo sshd -T` para comprobar.

### El puerto en Ubuntu 24.04

Cambiar el puerto no reduce ataques reales, pero sí el ruido en los logs, y hay quien lo pide. En Ubuntu 24.04, SSH arranca por *socket activation*: el puerto lo abre `ssh.socket`, no sshd. Por eso:

```text Terminal
solo restart ssh: :22
daemon-reload + restart ssh.socket: :2222
```

Con `Port 2222` en un drop-in, reiniciar `ssh` **no cambia nada**. Un generador lee el puerto de la configuración de sshd al hacer `daemon-reload`:

```bash Terminal
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket
```

Antes, abrí el puerto nuevo en el [firewall](/blog/linux/firewall), o te quedás afuera.

## Túneles

PostgreSQL escucha solo en `127.0.0.1` del servidor. Desde la laptop no se llega, y está bien. Para consultarla:

```bash Terminal · En la laptop
ssh -f -N -L 15432:127.0.0.1:5432 prod
```

`-L 15432:127.0.0.1:5432` abre el puerto 15432 **en la laptop** y lo conecta, a través de SSH, con `127.0.0.1:5432` **visto desde el servidor**. `-f -N` lo deja en el fondo sin abrir una shell.

```text Terminal
$ psql -h 127.0.0.1 -p 15432 -U facturacion -d facturacion -Atc "select serie, ultimo from series order by serie"
B001|0
BC01|0
F001|1
FC01|0
```

La base nunca se expuso, y el tráfico viaja cifrado. Es la respuesta a «necesito conectar mi cliente gráfico a la base de producción».

| Túnel | Hace |
|---|---|
| `-L local:destino:puerto` | Traer un servicio remoto a tu máquina |
| `-R remoto:destino:puerto` | Llevar un servicio de tu máquina al servidor |
| `-D 1080` | Un proxy SOCKS: navegar como si estuvieras en el servidor |

## Copiar archivos

```bash Terminal
scp backup.dump prod:/tmp/
rsync -az --delete ./sitio/ prod:/srv/sitio/
```

```text Terminal · rsync --stats
Number of files: 2 (reg: 1, dir: 1)
Number of regular files transferred: 1
Total transferred file size: 5 bytes
```

rsync transfiere solo lo que cambió, y vuelve a intentarlo donde quedó. La barra final de `./sitio/` importa: con barra copia el **contenido**; sin barra, copia el directorio adentro del destino.

## En scripts: ssh se come la entrada

```bash Mal · el bucle se corta después del primer servidor
while read -r servidor; do
    ssh "$servidor" uptime
done < servidores.txt
```

`ssh` lee de stdin, y stdin es el archivo: el primer `ssh` se come el resto de la lista. En el laboratorio, un script entero se cortó así. La solución es `ssh -n`, o `< /dev/null`, siempre que uses ssh dentro de un bucle o de un script que recibe datos por la entrada.

> **Quedate con esto**
> Claves ed25519 con frase de paso, `ssh-copy-id` y nunca ignorar un cambio de huella. Un `~/.ssh/config` con alias y `ProxyJump` para los servidores internos. sshd sin contraseñas, sin root y con `AllowGroups`, en un drop-in con número menor a 50, porque gana el primero que define cada opción; verificalo con `sshd -T` desde una segunda sesión. En Ubuntu 24.04 el puerto lo cambia `ssh.socket`. Para llegar a una base que escucha en `127.0.0.1`, un túnel `-L`. Y `ssh -n` en los scripts.
