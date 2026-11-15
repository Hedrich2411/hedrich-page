---
title: "Ansible: inventario, módulos y playbooks"
description: Configurar servidores describiendo cómo tienen que quedar, en lugar de escribir comandos. Inventario, comandos ad hoc, idempotencia y un primer playbook que endurece dos servidores nuevos.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ansible, automatizacion]
goal: Dejar de configurar servidores a mano y describirlos en un playbook que se puede aplicar mil veces.
course: linux-administracion
section: automatizacion
order: 1
---

Todo este curso se hizo a mano en un servidor. Para el segundo, se repite. Para el décimo, alguien se olvida un paso, y el servidor número siete tiene SSH con contraseña y nadie lo sabe. Ansible describe **cómo tiene que quedar** cada servidor, y lo aplica a todos igual.

## Cómo funciona

| Pieza | Qué es |
|---|---|
| **Nodo de control** | Donde instalás Ansible y desde donde lo corrés: tu laptop, o un servidor de administración |
| **Nodos administrados** | Los servidores. No necesitan nada instalado, solo SSH y Python |
| **Inventario** | La lista de servidores, agrupados |
| **Módulo** | Una unidad de trabajo: instalar un paquete, crear un usuario, copiar un archivo |
| **Playbook** | Un archivo YAML que dice qué módulos aplicar a qué servidores |

**Sin agente**: Ansible entra por SSH, copia un pequeño programa de Python, lo ejecuta y lo borra. Es la diferencia con Puppet o Chef, que necesitan un agente en cada servidor.

## El laboratorio

La laptop de Ana es el nodo de control. Los nodos son dos servidores recién creados, como los entrega cualquier proveedor cloud: el usuario `ubuntu` con sudo sin contraseña y la clave de Ana en su `authorized_keys`, puesta por [cloud-init](/blog/linux/cloud-init). Nada más.

```bash Terminal
sudo apt install ansible
```

Ubuntu 24.04 trae `ansible-core` 2.16 con las colecciones más usadas incluidas:

```text Terminal
ansible [core 2.16.3]
ansible.posix                            1.5.4
community.general                        8.3.0
community.postgresql                     3.3.0
```

## El proyecto

```text infra/
infra/
├── ansible.cfg
├── inventario.yml
├── sitio.yml
├── group_vars/
│   ├── all.yml
│   └── facturacion/
│       ├── vars.yml
│       └── vault.yml
└── roles/
    ├── base/
    └── facturacion/
```

```ini ansible.cfg
[defaults]
inventory = inventario.yml
remote_user = ubuntu
host_key_checking = True
interpreter_python = auto_silent
callback_result_format = yaml
vault_password_file = ~/.ansible-vault-clave

[ssh_connection]
pipelining = True
```

`host_key_checking = True` mantiene la verificación de la huella de cada servidor; desactivarla, como sugieren muchos tutoriales, abre la puerta a conectarte a un servidor impostor. Las huellas se cargan una vez con `ssh-keyscan`. `pipelining` reduce las conexiones por tarea y acelera bastante.

## El inventario

```yaml inventario.yml
all:
  children:
    facturacion:
      hosts:
        web1:
          ansible_host: 192.168.10.4
        web2:
          ansible_host: 192.168.10.5
```

```text Terminal · ansible-inventory --graph
@all:
  |--@ungrouped:
  |--@facturacion:
  |  |--web1
  |  |--web2
```

Los grupos permiten apuntar: `facturacion`, `bases`, `produccion`. Un servidor puede estar en varios.

## Comandos ad hoc

Para preguntas o arreglos puntuales en todos los servidores a la vez:

```text Terminal
$ ansible all -m ping -o
web2 | SUCCESS => {"ansible_facts": {"discovered_interpreter_python": "/usr/bin/python3"},"changed": false,"ping": "pong"}
web1 | SUCCESS => {"ansible_facts": {"discovered_interpreter_python": "/usr/bin/python3"},"changed": false,"ping": "pong"}
$ ansible all -a "uptime" -o
web1 | CHANGED | rc=0 | (stdout)  22:02:14 up 23 min,  0 user,  load average: 0.10, 0.23, 0.17
web2 | CHANGED | rc=0 | (stdout)  22:02:14 up 23 min,  0 user,  load average: 0.10, 0.23, 0.17
```

`ping` no es un ping de red: comprueba que Ansible puede entrar y ejecutar Python. `-a "uptime"` usa el módulo `command`.

```bash Terminal
ansible facturacion -m ansible.builtin.apt -a "name=htop state=present update_cache=true" -b
```

`-b` es *become*: ejecutar con sudo.

## Idempotencia

Fijate en la salida de arriba: `uptime` aparece como `CHANGED` y `ping` como `SUCCESS` sin cambios. Los módulos de Ansible describen **un estado**, no una acción: `apt: name=htop state=present` significa «htop instalado». Si ya lo está, no hace nada y lo informa como `ok`.

Eso es **idempotencia**: aplicar el mismo playbook diez veces deja el servidor igual que aplicarlo una. Es lo que permite correrlo sin miedo sobre servidores que ya están en producción.

`command` y `shell` no saben si cambiaron algo, así que siempre dicen `CHANGED`. Usalos solo cuando no hay un módulo, y decile a Ansible cuándo hay cambio con `changed_when` o `creates`.

## Un playbook

```yaml sitio.yml
- name: Servidores de facturación
  hosts: facturacion
  become: true
  roles:
    - base
    - facturacion
```

Las tareas del rol `base`, la [lista de endurecimiento](/blog/linux/endurecimiento) convertida en código:

```yaml roles/base/tasks/main.yml · Extracto
- name: Paquetes base
  ansible.builtin.apt:
    name: [nftables, fail2ban, unattended-upgrades, acl]
    state: present
    update_cache: true
    cache_valid_time: 3600

- name: Administradores
  ansible.builtin.user:
    name: "{{ item.nombre }}"
    shell: /bin/bash
    groups: [sudo, ssh-usuarios]
    append: true
  loop: "{{ admins }}"
  loop_control:
    label: "{{ item.nombre }}"

- name: Claves de los administradores
  ansible.posix.authorized_key:
    user: "{{ item.nombre }}"
    key: "{{ item.clave_publica }}"
    exclusive: true
  loop: "{{ admins }}"
  loop_control:
    label: "{{ item.nombre }}"

- name: Sudo sin contraseña para administradores con clave
  ansible.builtin.copy:
    dest: /etc/sudoers.d/admins
    content: "%sudo ALL=(ALL:ALL) NOPASSWD: ALL\n"
    mode: "0440"
    validate: /usr/sbin/visudo -cf %s

- name: El usuario inicial también entra por SSH
  ansible.builtin.user:
    name: "{{ ansible_user }}"
    groups: [ssh-usuarios]
    append: true
```

**`append: true`** es el `-a` de `usermod -aG`: sin él, Ansible reemplaza los grupos, la misma trampa de [usuarios y grupos](/blog/linux/usuarios-y-grupos).

**`exclusive: true`** deja en `authorized_keys` **solo** las claves del inventario. Si alguien agregó una a mano, el próximo playbook la saca: así se da de baja un acceso en todos los servidores a la vez.

**`validate`** corre `visudo -cf` sobre el archivo antes de instalarlo. Si falla, Ansible no lo copia. Es el mismo procedimiento de [sudo](/blog/linux/sudo), pero automático y en cada corrida.

**El orden importa.** El usuario `ubuntu` entra al grupo `ssh-usuarios` **antes** de la tarea que pone `AllowGroups ssh-usuarios` en sshd. Al revés, Ansible se queda afuera de los servidores a mitad del playbook.

La tarea de sudoers apareció al probar: Ana estaba en `sudo` pero no tenía contraseña, así que no podía usarlo. `sudo: a password is required` en la primera prueba.

## Aplicar

```bash Terminal
ansible-playbook sitio.yml --syntax-check
ansible-playbook sitio.yml
```

Un servidor nuevo, desde cero hasta la API corriendo:

```text Terminal · ansible-playbook sitio.yml --limit web3
RUNNING HANDLER [base : Recargar ssh] ******************************************
RUNNING HANDLER [base : Recargar nftables] *************************************
RUNNING HANDLER [facturacion : Reiniciar facturacion] **************************
web3                       : ok=30   changed=28   unreachable=0    failed=0    skipped=0    rescued=0    ignored=0

real	0m47.389s
```

47 segundos. La segunda vez, sobre los tres:

```text Terminal
web1                       : ok=24   changed=0    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
web2                       : ok=24   changed=0    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
web3                       : ok=24   changed=0    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
```

`changed=0`: todo ya estaba como el playbook dice. Esa línea es la prueba de que el playbook es idempotente, y vale la pena exigirla: un playbook que siempre informa cambios no te deja ver cuándo algo cambió de verdad.

## Ver antes de cambiar

```bash Terminal
ansible-playbook sitio.yml --check --diff --limit web1
```

`--check` simula y `--diff` muestra qué cambiaría en cada archivo. Sobre servidores que ya existen, es la forma de revisar un cambio antes de aplicarlo, y está en la [lección siguiente](/blog/linux/ansible-roles).

Sobre un servidor **vacío**, `--check` no es confiable:

```text Terminal
TASK [base : Claves de los administradores] ************************************
failed: [web1] (item=ana) =>
    msg: Either user must exist or you must provide full path to key file in check mode
```

En modo simulación el usuario no se crea, y la tarea siguiente, que necesita que exista, falla. Las tareas que dependen de otras no se pueden simular.

> **Quedate con esto**
> Ansible entra por SSH, sin agente, y aplica módulos que describen estados, no acciones: eso los hace idempotentes. El inventario agrupa servidores, los comandos ad hoc sirven para preguntas puntuales, y el playbook dice cómo tiene que quedar cada grupo. `append: true` en los grupos, `exclusive: true` en las claves, `validate` en lo que puede romper, y cuidado con el orden cuando endurecés SSH. La segunda corrida tiene que dar `changed=0`.
