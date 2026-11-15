---
title: "Nginx delante de Odoo"
description: La configuración de Nginx que Odoo necesita, explicada línea por línea.
date: 2026-10-11
topic: ERP
tags: [odoo, nginx, https]
goal: Odoo detrás de un proxy, con HTTPS y las cabeceras correctas.
course: odoo-produccion
section: nginx
order: 1
---

Odoo trae su propio servidor HTTP. Podrías exponerlo directo y funcionaría.

No lo hagas, por cuatro motivos concretos: no hace HTTPS, no comprime, no cachea los assets estáticos, y no te deja filtrar rutas. Nginx hace las cuatro cosas y cuesta veinte líneas.

## La configuración

```nginx /etc/nginx/sites-available/taller
upstream odoo {
    server 127.0.0.1:8069;
}

upstream odoo_websocket {
    server 127.0.0.1:8072;
}

server {
    listen 80;
    server_name taller.ejemplo.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name taller.ejemplo.com;

    ssl_certificate     /etc/letsencrypt/live/taller.ejemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/taller.ejemplo.com/privkey.pem;

    # los adjuntos pueden ser grandes
    client_max_body_size 100M;

    # un informe pesado puede tardar
    proxy_read_timeout    720s;
    proxy_connect_timeout 720s;
    proxy_send_timeout    720s;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # los assets llevan un hash en la URL: se pueden cachear para siempre
    location ~ ^/web/assets/ {
        proxy_pass http://odoo;
        proxy_cache_valid 200 90m;
        expires 864000;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://odoo;
        proxy_redirect off;
    }

    gzip on;
    gzip_types text/css text/plain application/javascript application/json image/svg+xml;
    gzip_min_length 1100;
}
```

Falta un bloque —el de websockets— que tiene su propia lección porque merece explicación aparte.

## Las cuatro cabeceras

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

**Las cuatro son obligatorias** y cada una resuelve un problema distinto.

**`Host`** — sin ella, Odoo ve `127.0.0.1:8069` como host. El `dbfilter` por dominio deja de funcionar y los enlaces absolutos salen mal.

**`X-Forwarded-For`** — sin ella, **todas las peticiones parecen venir del proxy**. Eso significa: todos los registros de auditoría con la misma IP, y —como vimos en la auditoría del endpoint de contacto— cualquier límite por IP se vuelve inútil porque todo el mundo comparte el mismo cubo.

**`X-Forwarded-Proto`** — es la que más síntomas raros produce si falta. Sin ella Odoo cree que lo están llamando por HTTP, y **los enlaces que pone en los correos salen con `http://`**. El cliente hace clic y le aparece una advertencia del navegador.

## `proxy_mode = True`

Las cabeceras no sirven de nada si Odoo no las lee:

```ini config/odoo.conf
proxy_mode = True
```

Con eso, Odoo usa `X-Forwarded-For` como IP del cliente y `X-Forwarded-Proto` para armar las URLs.

**Y acá va la advertencia que importa**: `proxy_mode = True` hace que Odoo **confíe en esas cabeceras venga de donde venga la petición**. Si el puerto 8069 es accesible desde fuera, cualquiera puede mandar un `X-Forwarded-For` falso y hacerse pasar por otra IP.

Por eso las dos cosas van juntas y no se separan:

```yaml compose.yaml
ports:
  - "127.0.0.1:8069:8069"
```

```ini
proxy_mode = True
```

**`proxy_mode = True` sin el puerto atado a localhost es un agujero.** Y al revés, el puerto atado sin `proxy_mode` te deja con los correos rotos. Son un par.

## HTTPS

```bash Terminal
sudo certbot --nginx -d taller.ejemplo.com
```

Certbot escribe los bloques de certificado y configura la renovación automática. No hay motivo para hacerlo a mano.

Lo que sí conviene verificar es que **la renovación de verdad corre**:

```bash Terminal
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

Un certificado vencido es una caída total, y es de las más evitables.

## La caché de assets

```nginx
location ~ ^/web/assets/ {
    proxy_cache_valid 200 90m;
    expires 864000;
    add_header Cache-Control "public, immutable";
}
```

Esto se apoya en algo que vimos en el curso de Web Framework: **las URLs de los bundles llevan un hash de versión**. Cuando el contenido cambia, cambia la URL.

Eso los hace cacheables para siempre sin riesgo: nunca vas a servir un asset viejo, porque la URL vieja deja de pedirse.

Es la optimización con mejor relación esfuerzo/resultado de toda la configuración. El bundle de Odoo pesa varios megabytes y, sin esto, se renegocia en cada carga.

## Los timeouts largos

```nginx
proxy_read_timeout 720s;
```

Doce minutos parece exagerado hasta que alguien importa un CSV de veinte mil líneas o genera un informe de todo el año.

Si Nginx corta antes de que Odoo termine, el usuario ve un **504 Gateway Timeout** y —lo peor— no sabe si la operación se completó o no.

El `limit_time_real` de Odoo es quien debería cortar primero, no el proxy. Eso se ve en la sección de workers.

## Comprobar que quedó bien

```bash Terminal
sudo nginx -t                    # sintaxis
sudo systemctl reload nginx      # recargar sin cortar conexiones
```

Y desde afuera:

```bash Terminal
curl -I https://taller.ejemplo.com/web/login
curl -I http://taller.ejemplo.com/web/login     # debe dar 301
```

La prueba de que las cabeceras llegan bien es más indirecta: **entrá a Odoo y mirá un correo enviado**. Si los enlaces empiezan con `https://tu-dominio`, `X-Forwarded-Proto` y `proxy_mode` están bien. Si empiezan con `http://localhost:8069`, falta algo.

> **Quedate con esto**
> Las cuatro cabeceras `proxy_set_header` son obligatorias, y `X-Forwarded-Proto` es la que hace que los enlaces de los correos salgan con HTTPS. `proxy_mode = True` y el puerto atado a `127.0.0.1` van siempre juntos: la primera sin la segunda deja que cualquiera falsifique su IP. Y cachear `/web/assets/` es gratis porque las URLs llevan hash.
