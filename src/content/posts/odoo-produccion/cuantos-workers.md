---
title: "Cuántos workers y por qué"
description: La fórmula, de dónde sale, y los límites de memoria y tiempo que van con ella.
date: 2026-10-11
topic: ERP
tags: [odoo, produccion, performance]
goal: Un número calculado, no copiado de un blog.
course: odoo-produccion
section: workers
order: 1
---

El default de Odoo es `workers = 0`, y con eso el servidor atiende **una petición por vez**. Para desarrollar está bien. Para cuatro personas trabajando a la vez, no.

## Qué es un worker

Un worker es **un proceso de Python** que atiende peticiones. Con cinco workers, Odoo puede atender cinco peticiones simultáneas.

Son procesos, no hilos, y eso tiene dos consecuencias:

**Cada uno ocupa su propia memoria.** Unos cientos de megabytes, según los módulos instalados.

**No comparten estado en memoria.** Por eso el caché del ORM que vimos en el curso de backend se coordina a través de la base, y por eso un `breakpoint()` en producción es inútil: no sabés qué proceso atendió.

## El número

```text
workers = (CPU × 2) + 1
```

De dónde sale: una petición de Odoo pasa buena parte del tiempo **esperando a PostgreSQL**, sin usar CPU. Mientras un worker espera, otro puede calcular. Por eso tiene sentido tener más workers que núcleos.

Para 4 núcleos: `(4 × 2) + 1 = 9`.

Pero hay un segundo límite, y es el que manda:

```text
workers ≤ RAM disponible / memoria por worker
```

Con 8 GB de RAM, dejando 2 para PostgreSQL y el sistema, quedan 6 GB. A unos 700 MB por worker:

```text
6000 / 700 ≈ 8 workers
```

**Tomá el menor de los dos.** Un worker que no entra en RAM no te da capacidad: te da swap, y el swap destruye el rendimiento más de lo que lo arregla un worker de más.

Para un servidor de 4 núcleos y 8 GB: **8 workers**. Para uno de 2 y 4 GB: **4**.

## Los otros dos procesos

```ini
workers = 8
max_cron_threads = 2
```

Además de tus 8 workers HTTP, Odoo arranca:

**Los workers de cron.** `max_cron_threads = 2` es un buen default. **Con 0, los trabajos programados no corren**, y eso incluye el envío de correos encolados y las reglas de automatización por tiempo. Es una forma silenciosa de que la mitad del módulo deje de funcionar.

**El worker de gevent**, el del puerto 8072 de la lección anterior. Arranca solo cuando `workers > 0`.

O sea que `workers = 8` son en realidad **11 procesos**. Tenelo en cuenta al calcular la RAM.

## Los límites de memoria

```ini
limit_memory_soft = 2147483648      ; 2 GB
limit_memory_hard = 2684354560      ; 2.5 GB
```

Son los valores por defecto de Odoo 19, y la diferencia entre los dos importa:

**`limit_memory_soft`** — cuando un worker lo supera, Odoo lo deja **terminar la petición en curso** y después lo recicla. El usuario no se entera.

**`limit_memory_hard`** — lo mata en el acto. El usuario ve un error.

Esos valores son por worker, y sirven para dos cosas: **contener una fuga de memoria** y **evitar que una operación descomunal se lleve el servidor puesto**.

Si en el log ves esto seguido:

```text
WARNING odoo.service.server: Worker (123) memory limit (2147483648) reached.
```

No subas el límite de entrada. Primero averiguá **qué** consume tanto: casi siempre es una importación masiva o un informe que trae demasiado, y eso se arregla en el código. Subir el límite esconde el problema hasta que se come toda la RAM.

## Los límites de tiempo

```ini
limit_time_cpu  = 60     ; segundos de CPU
limit_time_real = 120    ; segundos de reloj
```

**`limit_time_cpu`** cuenta solo el tiempo de procesador. **`limit_time_real`** cuenta el tiempo total, incluyendo la espera de la base.

Que el segundo sea el doble del primero es deliberado: una petición puede pasar la mitad del tiempo esperando a PostgreSQL legítimamente.

Y acá va una relación que conviene no romper, conectando con la lección de Nginx:

```text
limit_time_real (120s)  <  proxy_read_timeout (720s)
```

**Odoo tiene que cortar antes que el proxy.** Si Nginx corta primero, el usuario ve un 504 y la operación **sigue corriendo del lado del servidor** — puede terminar y guardar, o morir a la mitad, y nadie sabe cuál.

Con Odoo cortando primero, el error es controlado y la transacción revierte.

Para operaciones legítimamente largas hay un límite aparte:

```ini
limit_time_real_cron = -1
```

Con `-1`, los trabajos programados no tienen límite de tiempo. Tiene sentido: un cron nocturno de facturación puede tardar media hora y nadie está esperando del otro lado.

## `limit_request`

```ini
limit_request = 65536
```

Cuántas peticiones atiende un worker antes de reciclarse. Es una red de contención contra fugas lentas: cada tantas miles de peticiones, el proceso se renueva y la memoria vuelve a cero.

El default está bien. No es un parámetro para tocar.

## Verificar que el número sirve

```bash Terminal · cuántos procesos hay
docker compose exec odoo ps aux | grep -c odoo
```

```bash Terminal · cuánta memoria usa cada uno
docker stats --no-stream
```

```bash Terminal · ¿hay swap en uso?
free -h
```

**Si hay swap en uso, tenés demasiados workers.** Es la señal más clara y la más fácil de leer.

Y la que indica lo contrario —que faltan— es más sutil: peticiones que tardan sin que la base esté lenta. Si en los logs ves tiempos altos con pocas consultas y poco tiempo de SQL, lo que pasa es que la petición **esperó** a que se liberara un worker.

## El riesgo de copiar

Vas a encontrar configuraciones con `workers = 16` en blogs. Ese número salía del servidor de quien lo escribió.

Dos servidores con la misma CPU pueden necesitar números distintos según cuántos módulos tengan instalados, cuántos usuarios simultáneos y qué tan pesados sean sus informes.

**Calculalo con tu CPU y tu RAM, y después medí.** Son dos comandos.

> **Quedate con esto**
> `(CPU × 2) + 1`, pero limitado por la RAM, y tomá el menor de los dos — un worker que no entra en memoria da swap, no capacidad. `max_cron_threads = 0` hace que no corran los trabajos programados, incluidos los correos encolados. Y `limit_time_real` tiene que ser **menor** que el timeout de Nginx, o el usuario ve un 504 sin saber si la operación se completó.
