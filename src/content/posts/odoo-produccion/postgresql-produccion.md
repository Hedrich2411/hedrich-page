---
title: "PostgreSQL: los parámetros que importan"
description: Los parámetros que mueven la aguja y cómo elegir sus valores.
date: 2026-10-11
topic: ERP
tags: [postgresql, produccion, performance]
goal: Una base afinada para la carga real, no para el default.
course: odoo-produccion
section: workers
order: 2
---

PostgreSQL viene configurado para arrancar en cualquier máquina, no para rendir en la tuya. Los defaults son deliberadamente conservadores.

De las decenas de parámetros que tiene, **cinco explican casi toda la diferencia**.

## `shared_buffers`

```ini
shared_buffers = 2GB        # 25% de la RAM
```

Es la memoria que PostgreSQL usa para cachear páginas de datos. El default son 128 MB, que es ridículo para un servidor.

**El 25% de la RAM total** es la recomendación estándar y funciona bien. Subirlo mucho más no ayuda, porque el sistema operativo también cachea por su cuenta y estarías duplicando.

Para 8 GB de RAM: 2 GB.

## `effective_cache_size`

```ini
effective_cache_size = 6GB      # 75% de la RAM
```

Este no reserva nada: **le dice al planificador cuánta caché puede esperar** entre PostgreSQL y el sistema operativo.

Con un valor bajo, el planificador asume que leer del disco es caro y evita usar índices, prefiriendo recorrer tablas enteras. Con un valor realista, usa los índices.

Es el parámetro con mejor relación entre coste y beneficio: **no gasta memoria y cambia las decisiones del planificador**.

## `work_mem`

```ini
work_mem = 16MB
```

Memoria para ordenamientos y uniones, **por operación**. Y ahí está el peligro.

No es por conexión ni por consulta: **es por operación dentro de una consulta**. Una consulta con tres ordenamientos puede usar `3 × work_mem`. Con 50 conexiones haciendo algo parecido:

```text
50 conexiones × 3 operaciones × 16 MB = 2.4 GB
```

Por eso subirlo mucho es peligroso: parece inofensivo hasta el día de carga alta, cuando la memoria se acaba de golpe.

Entre 8 y 32 MB es un rango sano. Si una consulta puntual necesita más, se le sube solo a ella:

```sql
SET LOCAL work_mem = '256MB';
```

## `max_connections`

```ini
max_connections = 100
```

Acá la intuición engaña: **más conexiones no es mejor**. Cada una consume memoria y, pasado cierto punto, PostgreSQL pasa más tiempo coordinando que trabajando.

La cuenta de cuántas necesitás:

```text
workers HTTP + workers de cron + el de gevent + margen
8 + 2 + 1 + margen  ≈  30-50
```

Odoo **ya agrupa conexiones** por worker, así que no necesita una por usuario. Con 100 vas sobrado para la mayoría de los despliegues.

Si ves esto en el log:

```text
FATAL: sorry, too many clients already
```

Antes de subir el número, mirá si no hay conexiones colgadas:

```sql
select count(*), state from pg_stat_activity group by state;
```

Muchas en **`idle in transaction`** es una transacción que quedó abierta — casi siempre un script externo que no cerró. Eso no se arregla subiendo `max_connections`.

## Los checkpoints

```ini
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB
```

Un checkpoint vuelca a disco todo lo que estaba en memoria. Si ocurren muy seguido o muy de golpe, producen **picos de latencia**: todo va bien y de pronto todo tarda.

`checkpoint_completion_target = 0.9` reparte esa escritura a lo largo del intervalo en vez de hacerla de una. Es casi gratis y suaviza mucho el perfil de respuesta.

`max_wal_size` más grande significa checkpoints menos frecuentes, a cambio de un arranque más lento tras una caída.

## Encontrar las consultas lentas

Más importante que cualquier parámetro:

```ini
log_min_duration_statement = 1000
```

Registra toda consulta que pase del segundo. **Activalo siempre.** El coste es despreciable y es la forma más directa de encontrar un índice que falta.

Y si podés instalar una extensión:

```sql
CREATE EXTENSION pg_stat_statements;
```

```sql
select calls, round(mean_exec_time::numeric, 1) as ms_prom,
       round(total_exec_time::numeric) as ms_total, left(query, 70) as consulta
from pg_stat_statements
order by total_exec_time desc
limit 15;
```

Esa consulta te da **las quince que más tiempo consumen en total**, que no son las mismas que las más lentas. Una consulta de 50 ms que corre diez mil veces por hora cuesta más que una de 3 segundos que corre una vez al día.

Casi siempre, la primera de esa lista explica la mitad del problema.

## En Docker

```yaml compose.yaml
services:
  db:
    image: postgres:16.4
    command:
      - "postgres"
      - "-c" 
      - "shared_buffers=2GB"
      - "-c"
      - "effective_cache_size=6GB"
      - "-c"
      - "work_mem=16MB"
      - "-c"
      - "max_connections=100"
      - "-c"
      - "checkpoint_completion_target=0.9"
      - "-c"
      - "log_min_duration_statement=1000"
```

O montando un `postgresql.conf` propio, que se lee mejor cuando son muchos parámetros.

## El orden correcto

**Medí antes de tocar.** Un servidor que va lento por un N+1 en el código no mejora con ningún parámetro de PostgreSQL. Lo arreglás afinando la base y el problema sigue, solo que ahora además tocaste cosas.

El orden que funciona:

1. `log_min_duration_statement` para ver qué tarda.
2. Si hay consultas lentas concretas, **índices** — el tema de la próxima lección.
3. Si no, `shared_buffers` y `effective_cache_size`.
4. El resto, solo si medís que hace falta.

> **Quedate con esto**
> `effective_cache_size` no reserva memoria pero cambia las decisiones del planificador: es el de mejor relación coste/beneficio. `work_mem` es **por operación**, no por conexión, y por eso subirlo es más peligroso de lo que parece. Más `max_connections` no es mejor, y un `too many clients` suele ser una transacción colgada. Y antes que cualquier parámetro, activá `log_min_duration_statement`.
