---
title: "Arrancar, parar y ver qué está pasando"
description: Los comandos del día a día y cómo leer los logs cuando algo va mal.
date: 2026-10-11
topic: ERP
tags: [odoo, docker, logs]
goal: Operar el stack sin adivinar.
course: odoo-produccion
section: despliegue
order: 3
---

El stack ya está. Esta lección es sobre operarlo: los comandos que vas a escribir cien veces y, sobre todo, qué mirar cuando algo no responde.

## Los comandos

```bash Terminal
docker compose up -d              # levantar todo
docker compose ps                 # qué está corriendo y su salud
docker compose logs -f odoo       # seguir los logs
docker compose restart odoo       # reiniciar solo Odoo
docker compose down               # bajar, conservando los volúmenes
docker compose pull && docker compose up -d   # actualizar imágenes
```

Y el que conviene mirar dos veces antes de escribir:

```bash Terminal · esto BORRA la base y el filestore
docker compose down -v
```

En desarrollo era cómodo. Acá es el final de la empresa.

Una costumbre que vale la pena: **en el servidor de producción, borrá ese comando de tu historial de shell**. `history -d` después de usarlo por accidente en otro contexto, o directamente no lo escribas nunca ahí.

## `ps` dice más de lo que parece

```bash Terminal
docker compose ps
```

```text
NAME        IMAGE           STATUS                   PORTS
taller-db   postgres:16.4   Up 3 days (healthy)      5432/tcp
taller-odoo odoo:19.0       Up 3 days                127.0.0.1:8069->8069/tcp
```

Lo que hay que leer:

- **`(healthy)`** — el healthcheck pasa. Si dice `(unhealthy)`, la base no acepta conexiones.
- **`Up 3 days`** — si dice `Up 2 minutes` y vos no lo tocaste, **se reinició solo**. Eso es una pista grande: casi siempre es `limit_memory_hard` matando un worker, o el proceso cayéndose.
- **`Restarting`** — está en un bucle de arranque y muerte. Los logs te dicen por qué.

## Leer los logs de Odoo

```bash Terminal
docker compose logs -f --tail=100 odoo
```

El formato es siempre el mismo:

```text
2026-10-11 09:14:22,331 7 INFO taller odoo.modules.loading: Modules loaded.
      fecha         pid nivel  base      módulo          mensaje
```

Los que vas a buscar:

```bash Terminal · solo los errores
docker compose logs odoo | grep -E "ERROR|CRITICAL"

# las peticiones lentas, con su tiempo
docker compose logs odoo | grep -E "werkzeug" | awk '$NF > 2'

# qué pasó alrededor de una hora concreta
docker compose logs --since 2026-10-11T09:00 --until 2026-10-11T09:30 odoo
```

### Las líneas que importan

**Una petición normal** se ve así:

```text
INFO taller werkzeug: 172.18.0.1 - - "POST /web/dataset/call_kw HTTP/1.1" 200 - 14 0.012 0.089
```

Los dos últimos números son **el tiempo de SQL y el tiempo de Python**, en segundos. Y el `14` son **las consultas** que hizo.

Eso es oro para diagnosticar: 200 consultas en una petición es un N+1; medio segundo de SQL con tres consultas es un índice que falta. Lo retomamos en la sección de rendimiento.

**Un worker que murió:**

```text
WARNING odoo.service.server: Worker (123) memory limit (2147483648) reached.
```

Odoo lo mata y arranca otro. Si aparece seguido, o el límite está bajo o algo consume de más.

```text
WARNING odoo.service.server: Worker (124) CPU time limit (60) reached.
```

Una petición pasó de `limit_time_cpu`. Suele ser un informe pesado o una operación masiva.

## Los logs de PostgreSQL

```bash Terminal
docker compose logs db | grep -iE "error|fatal|slow"
```

Las dos que importan:

```text
FATAL: sorry, too many clients already
```

Llegaste a `max_connections`. Tiene su lección en la sección de workers.

```text
LOG: duration: 3421.556 ms  statement: SELECT ...
```

Una consulta lenta. Para que aparezcan hay que pedirlo:

```ini postgresql.conf
log_min_duration_statement = 1000
```

Registra toda consulta que pase del segundo. **Activalo**: el coste es despreciable y es la forma más directa de encontrar el índice que falta.

## Que los logs no te llenen el disco

Con `logfile = None`, Odoo escribe al contenedor y Docker los guarda. **Por defecto, sin límite.**

Un Odoo con tráfico genera cientos de megabytes por día. En algún momento el disco se llena y todo se cae a la vez, de una forma que no parece tener nada que ver con los logs.

```yaml compose.yaml
services:
  odoo:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

250 MB como máximo. Es una de esas cuatro líneas que separan un servidor que sobrevive un año de uno que no.

## Entrar

```bash Terminal
docker compose exec odoo bash                     # una shell en el contenedor
docker compose exec db psql -U odoo -d taller     # psql
docker compose exec odoo odoo shell -d taller     # el shell de Odoo
```

El tercero es el del curso de backend, con el ORM cargado. En producción es la forma de inspeccionar datos sin tocar la interfaz.

**Y acordate de que en producción el shell sí commitea si vos se lo decís.** Un `env.cr.commit()` ahí es una escritura real sobre datos de clientes. Mirá dos veces.

## Cuando no responde

El orden que conviene seguir:

**1. ¿Está corriendo?**

```bash
docker compose ps
```

**2. ¿Responde Odoo directo, salteando Nginx?**

```bash
curl -I http://127.0.0.1:8069/web/login
```

Si esto responde y por el dominio no, **el problema es Nginx**, no Odoo. Acabás de partir el problema en dos.

**3. ¿Qué dicen los últimos logs?**

```bash
docker compose logs --tail=200 odoo
```

**4. ¿Hay disco?**

```bash
df -h
```

Esta es la que más sorprende. Un disco lleno produce síntomas rarísimos: PostgreSQL deja de escribir, Odoo no puede guardar adjuntos, los logs no se escriben. Y nada menciona el disco.

**5. ¿Hay memoria?**

```bash
free -h
docker stats --no-stream
```

**6. ¿Cuántas conexiones hay abiertas?**

```bash
docker compose exec db psql -U odoo -d taller -c "select count(*), state from pg_stat_activity group by state;"
```

Muchas en `idle in transaction` es una transacción que quedó abierta y está bloqueando al resto.

## Un reinicio no es un diagnóstico

Reiniciar arregla el síntoma y borra la evidencia. Antes de hacerlo:

```bash Terminal
docker compose logs --tail=500 odoo > /tmp/incidente-$(date +%F-%H%M).log
```

Treinta segundos que te dan la posibilidad de entender qué pasó. Sin eso, la próxima vez vas a estar igual de perdido.

> **Quedate con esto**
> `docker compose ps` te dice si algo se reinició solo, que casi siempre es el límite de memoria. Los dos últimos números de una línea de petición son el tiempo de SQL y el de Python, y el anterior es la cantidad de consultas — ahí se ven los N+1. Ponele límite a los logs o te llenan el disco. Y antes de reiniciar, guardá los logs.
