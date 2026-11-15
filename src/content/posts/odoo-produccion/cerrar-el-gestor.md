---
title: "Cerrar el gestor de bases de datos"
description: Las tres líneas que separan una instancia expuesta de una cerrada.
date: 2026-10-11
topic: ERP
tags: [odoo, seguridad, produccion]
goal: Que nadie pueda listar, crear ni borrar bases desde internet.
course: odoo-produccion
section: hardening
order: 1
---

Hay una cantidad incómoda de instancias de Odoo en internet con el gestor de bases de datos abierto. Entrás a `/web/database/manager`, te muestra la lista de bases, y lo único entre un desconocido y borrarlas todas es una contraseña maestra que muchas veces es `admin`.

Esta lección son tres líneas de configuración y un bloque de Nginx.

## `list_db = False`

```ini config/odoo.conf
list_db = False
```

Deja de exponer la lista de bases de datos.

Eso significa: el selector de base en el login desaparece, `/web/database/selector` no devuelve nada, y el gestor deja de listar.

**No es cosmético.** Saber cómo se llama la base es el primer paso de cualquier ataque, y muchas veces el nombre revela el cliente.

Para que el login siga funcionando con una sola base, va con el siguiente.

## `dbfilter`

```ini config/odoo.conf
dbfilter = ^taller$
```

Limita qué bases puede servir esta instancia, con una expresión regular.

**El `^` y el `$` no son opcionales.** Sin ellos la expresión busca coincidencia parcial, y `taller` también haría match con `taller_backup` o `taller_viejo` — justo las que no querés exponer.

Con `list_db = False` y un `dbfilter` que resuelve a una sola base, Odoo entra directo sin preguntar.

Si servís varios clientes por dominio:

```ini
dbfilter = ^%d$
```

`%d` es el subdominio de la petición. Para que funcione hace falta la cabecera `Host` de la lección de Nginx — si falta, Odoo ve `127.0.0.1` y el filtro no resuelve nada.

## `admin_passwd`

```ini config/odoo.conf
admin_passwd = $pbkdf2-sha512$600000$...
```

La contraseña maestra. **No es la del usuario admin**, y conviene que sea larga y distinta de todo lo demás.

Como vimos en la lección de secretos, Odoo la acepta hasheada y así es como debe quedar.

Y si usás la interfaz para cambiarla, acordate de que el archivo está montado como `:ro`: Odoo no va a poder reescribirlo. Para rotarla, generá el hash y editá el archivo.

## El bloque de Nginx

Las tres líneas anteriores son la defensa principal. Esta es la segunda capa, por si alguna falla o alguien reinicia con una configuración vieja:

```nginx /etc/nginx/sites-available/taller
location ~ ^/web/database/(manager|selector|create|duplicate|drop|backup|restore|change_password) {
    deny all;
    return 404;
}
```

Devuelve 404 a todas las rutas de gestión de bases. Con `return 404` en vez de `403`, ni siquiera confirmás que existen.

**Si vos necesitás entrar alguna vez**, la forma correcta no es abrirlo: es un túnel SSH.

```bash Terminal · desde tu máquina
ssh -L 8069:127.0.0.1:8069 usuario@servidor
```

Y entrás por `http://127.0.0.1:8069` en tu navegador, saltando Nginx. Acceso puntual, autenticado por SSH, sin exponer nada.

## Comprobarlo

Desde **fuera** del servidor, no desde dentro:

```bash Terminal
curl -s -o /dev/null -w "%{http_code}\n" https://taller.ejemplo.com/web/database/manager
curl -s -o /dev/null -w "%{http_code}\n" https://taller.ejemplo.com/web/database/selector
```

Las dos tienen que dar **404**.

```bash Terminal · ¿se filtra la lista por otro lado?
curl -s https://taller.ejemplo.com/web/login | grep -i "db\|database"
```

No debería aparecer ningún nombre de base.

**Y la prueba que de verdad importa**: pedile a alguien de afuera de tu red que lo intente. Probarlo desde el servidor da falsos negativos, porque desde ahí muchas cosas se ven distinto.

## El resto de la lista

Mientras estás en esto, otras cosas que conviene cerrar:

**El puerto de PostgreSQL.** No debería estar publicado en absoluto. Ya lo resolvimos en el compose: la base solo habla con Odoo por la red interna.

**El modo desarrollador.** Un usuario interno puede activarlo y ver los Ajustes técnicos. Eso no se cierra con configuración: se cierra **no dando permisos de administrador a quien no los necesita**, que es la lección de grupos del curso de backend.

**El usuario `admin`.** Cambiale la contraseña por una fuerte el primer día. Y si podés, creá un administrador con nombre propio y desactivá el genérico: cuando alguien hace algo, querés saber quién.

**Las versiones expuestas.** Nginx anuncia la suya en las respuestas:

```nginx
server_tokens off;
```

## Una lista para el día del despliegue

| | |
|---|---|
| `list_db = False` | ☐ |
| `dbfilter` con `^` y `$` | ☐ |
| `admin_passwd` larga y hasheada | ☐ |
| Rutas de base bloqueadas en Nginx | ☐ |
| Puerto 8069 atado a `127.0.0.1` | ☐ |
| Puerto de PostgreSQL no publicado | ☐ |
| Contraseña de `admin` cambiada | ☐ |
| HTTPS con renovación automática probada | ☐ |
| Comprobado **desde fuera** | ☐ |

Son quince minutos el día uno. Es la diferencia entre un despliegue profesional y uno que aparece en una búsqueda de Shodan.

> **Quedate con esto**
> `list_db = False` más un `dbfilter` anclado con `^` y `$` — sin los anclajes, `taller` también matchea `taller_backup`. El bloque de Nginx es la segunda capa por si la configuración se revierte, y `return 404` no confirma que las rutas existan. Si necesitás entrar al gestor, un túnel SSH, nunca abrirlo. Y comprobalo desde fuera de tu red.
