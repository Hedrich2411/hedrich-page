---
title: "Roles, plantillas y secretos con Vault"
description: El rol que despliega la API completa, plantillas Jinja2 validadas antes de instalarse, handlers que reinician solo cuando hace falta, secretos cifrados con Vault, y --check --diff sobre un cambio real.
date: 2026-10-19
topic: Infraestructura
tags: [linux, ansible, automatizacion]
goal: Organizar la automatización en roles reutilizables, con secretos cifrados y cambios revisables antes de aplicarlos.
course: linux-administracion
section: automatizacion
order: 2
---

Un playbook con cincuenta tareas en un archivo se vuelve inmanejable. Los **roles** agrupan lo que va junto: el rol `base` endurece cualquier servidor, el rol `facturacion` instala la API. Un servidor de base de datos usaría `base` y otro rol.

## La estructura de un rol

```text roles/facturacion/
roles/facturacion/
├── defaults/main.yml      # variables con valor por defecto
├── tasks/main.yml         # las tareas
├── handlers/main.yml      # acciones que se disparan con notify
├── templates/             # plantillas Jinja2
│   ├── entorno.j2
│   ├── facturacion.service.j2
│   ├── enviar-pendientes.service.j2
│   └── enviar-pendientes.timer.j2
└── files/
    └── facturacion.tar.gz # el código de la versión
```

Ansible encuentra cada pieza por convención: un `template: src: entorno.j2` busca en `templates/` del rol. `ansible-galaxy role init nombre` crea la estructura vacía.

## Variables

```yaml roles/facturacion/defaults/main.yml
facturacion_version: "1.0"
facturacion_dir: /srv/facturacion
facturacion_series: [F001, B001, FC01, BC01]
facturacion_pse_url: https://pse.example.pe/api
facturacion_smtp_host: smtp.example.pe
facturacion_smtp_usuario: avisos@example.pe
facturacion_avisos_a: contabilidad@example.pe
```

`defaults` tiene la prioridad más baja: todo se puede pisar desde `group_vars`, `host_vars` o la línea de comandos. El prefijo con el nombre del rol evita choques entre roles.

```yaml group_vars/all.yml
admins:
  - nombre: ana
    clave_publica: "{{ lookup('file', '~/.ssh/id_ed25519.pub') }}"

red_de_admins: 192.168.10.0/24
puertos_publicos: [80, 443]
```

`group_vars/all.yml` vale para todos; `group_vars/facturacion/` solo para ese grupo.

## Plantillas

Una plantilla Jinja2 es un archivo de configuración con huecos. El firewall de cada servidor:

```text roles/base/templates/nftables.conf.j2
#!/usr/sbin/nft -f
# {{ ansible_managed }}
table inet filtro
delete table inet filtro

table inet filtro {
    chain entrada {
        type filter hook input priority filter; policy drop;

        ct state established,related accept
        ct state invalid drop
        iif "lo" accept
        meta l4proto { icmp, ipv6-icmp } accept

        tcp dport 22 ip saddr {{ red_de_admins }} accept
{% if puertos_publicos %}
        tcp dport { {{ puertos_publicos | join(', ') }} } accept
{% endif %}
    }

    chain reenvio {
        type filter hook forward priority filter; policy drop;
    }
}
```

`{{ }}` inserta un valor, `{% %}` es lógica, `| join` es un filtro. `{{ ansible_managed }}` deja un comentario avisando que el archivo lo administra Ansible, para que nadie lo edite a mano. Y la tabla se borra y recrea sin tocar las de Docker o fail2ban, por lo que viste en [firewall](/blog/linux/firewall).

```yaml roles/base/tasks/main.yml · La tarea
- name: Firewall
  ansible.builtin.template:
    src: nftables.conf.j2
    dest: /etc/nftables.conf
    mode: "0755"
    validate: /usr/sbin/nft -c -f %s
  notify: Recargar nftables
```

**`validate`** es lo que hace seguro gestionar configuración con Ansible: el archivo generado se verifica con `nft -c` **antes** de reemplazar el actual. Si una variable mal puesta genera un ruleset inválido, la tarea falla y el servidor sigue con el firewall que tenía. Lo mismo para sshd con `sshd -t -f %s`, para sudoers con `visudo -cf %s`.

## Handlers

```yaml roles/base/handlers/main.yml
- name: Recargar ssh
  ansible.builtin.systemd_service:
    name: ssh
    state: reloaded

- name: Recargar nftables
  ansible.builtin.systemd_service:
    name: nftables
    state: reloaded
```

Un handler corre **solo si alguna tarea que lo notifica cambió algo**, y una sola vez al final, aunque lo notifiquen varias. Si el firewall no cambió, no se recarga. En la primera corrida de un servidor nuevo corrieron los tres; en la segunda, ninguno.

## El rol de la API

Las tareas siguen el mismo orden que la instalación manual de [servicios de systemd](/blog/linux/servicios-systemd):

```yaml roles/facturacion/tasks/main.yml · Extracto
- name: Rol de la base
  community.postgresql.postgresql_user:
    name: facturacion
    password: "{{ facturacion_db_clave }}"
  become_user: postgres
  no_log: true

- name: Código de la versión {{ facturacion_version }}
  ansible.builtin.unarchive:
    src: facturacion.tar.gz
    dest: "{{ facturacion_dir }}/app"
    owner: facturacion
    group: facturacion
  register: codigo
  notify: Reiniciar facturacion

- name: Dependencias
  ansible.builtin.command:
    cmd: uv sync --no-dev --frozen
    chdir: "{{ facturacion_dir }}/app"
  become_user: facturacion
  environment:
    UV_CACHE_DIR: "{{ facturacion_dir }}/.cache/uv"
  when: codigo.changed

- name: Series habilitadas
  community.postgresql.postgresql_query:
    db: facturacion
    query: INSERT INTO series (serie, ultimo) VALUES (%s, 0) ON CONFLICT DO NOTHING
    positional_args: ["{{ item }}"]
  become_user: postgres
  loop: "{{ facturacion_series }}"
  register: series
  changed_when: series.rowcount == 1

- name: Variables de entorno
  ansible.builtin.template:
    src: entorno.j2
    dest: /etc/facturacion/entorno
    owner: root
    group: facturacion
    mode: "0640"
  no_log: true
  notify: Reiniciar facturacion
```

**`register` y `when: codigo.changed`**: las dependencias se reinstalan solo si llegó código nuevo. Sin eso, `uv sync` correría en cada pasada y la tarea diría `CHANGED` siempre.

**`changed_when`** le dice a Ansible cuándo un comando cambió algo de verdad. `ON CONFLICT DO NOTHING` hace la consulta idempotente; `rowcount == 1` la marca como cambio solo cuando insertó.

**`become_user: postgres`** ejecuta como ese usuario, que entra a PostgreSQL sin contraseña. Para que Ansible pueda pasarle archivos temporales a un usuario sin privilegios necesita el paquete `acl` en el servidor, y por eso está en el rol `base`.

**`no_log: true`** en todo lo que maneja contraseñas: sin él, Ansible las muestra en la salida si la tarea falla.

## Vault

La contraseña de la base, el token del PSE y la clave del correo no pueden estar en texto plano en el repositorio. **Ansible Vault** los cifra:

```yaml group_vars/facturacion/vars.yml
facturacion_db_clave: "{{ vault_facturacion_db_clave }}"
facturacion_pse_token: "{{ vault_facturacion_pse_token }}"
facturacion_smtp_clave: "{{ vault_facturacion_smtp_clave }}"
```

```bash Terminal
umask 077; head -c 24 /dev/urandom | base64 > ~/.ansible-vault-clave
ansible-vault encrypt group_vars/facturacion/vault.yml
```

```text Terminal · head -2 group_vars/facturacion/vault.yml
$ANSIBLE_VAULT;1.1;AES256
33376438356530393036363632366262323337336563373461326465386264393062353534313137
```

El patrón de dos archivos, `vars.yml` que apunta a `vault.yml`, permite buscar con `grep` qué variables existen sin descifrar nada. `ansible-vault view` y `ansible-vault edit` para leerlo y cambiarlo.

La clave de Vault va en `~/.ansible-vault-clave`, fuera del repositorio, y en el gestor de contraseñas del equipo. Ansible la toma de `vault_password_file` en `ansible.cfg` y descifra al vuelo.

## --check --diff sobre un cambio real

Abrir el puerto 8443 en todos los servidores de facturación es cambiar una variable:

```yaml group_vars/all.yml
puertos_publicos: [80, 443, 8443]
```

Antes de aplicar:

```text Terminal · ansible-playbook sitio.yml --check --diff --limit web1
TASK [base : Firewall] *********************************************************
--- before: /etc/nftables.conf
+++ after: /home/ana/.ansible/tmp/ansible-local-30495s0aqwh3/tmpa4fz9afi/nftables.conf.j2
@@ -13,7 +13,7 @@
         meta l4proto { icmp, ipv6-icmp } accept

         tcp dport 22 ip saddr 192.168.10.0/24 accept
-        tcp dport { 80, 443 } accept
+        tcp dport { 80, 443, 8443 } accept
     }

     chain reenvio {

changed: [web1]
```

Exactamente lo que va a cambiar, línea por línea, sin haber tocado el servidor. En un equipo, esa salida va en el pedido de revisión del cambio, al lado del diff del repositorio. `--limit web1` aplica primero en uno; si sale bien, al resto.

## Que no se degrade

- **`ansible-lint`** revisa el proyecto contra las buenas prácticas: módulos con su nombre completo, `no_log` donde hace falta, permisos explícitos.
- **El repositorio es la fuente de verdad.** Un cambio hecho a mano en un servidor se pierde en la próxima corrida, o peor, queda y nadie sabe que existe. Correr el playbook periódicamente, con `--check`, muestra qué servidores se apartaron de lo declarado.
- **Molecule** prueba roles en contenedores antes de llevarlos a servidores reales, cuando los roles empiezan a ser muchos.

Con esto, el servidor del curso deja de ser algo que se configuró una vez y se convierte en un archivo que cualquiera del equipo puede leer, revisar y aplicar: el [plan de recuperación](/blog/linux/plan-de-recuperacion) pasa de «cuando vuelva quien sabe» a 47 segundos.

> **Quedate con esto**
> Un rol agrupa tareas, plantillas, handlers y variables con valores por defecto que se pisan desde `group_vars`. Las plantillas Jinja2 se instalan con `validate`, para que un error no reemplace una configuración buena. Los handlers reinician solo si algo cambió. `register`, `when` y `changed_when` mantienen la idempotencia de los comandos. Los secretos, con Vault, en un archivo aparte, con la clave fuera del repositorio. Y `--check --diff --limit` antes de aplicar un cambio a todos.
