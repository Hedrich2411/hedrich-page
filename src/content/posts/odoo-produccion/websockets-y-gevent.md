---
title: "El puerto de websockets y por qué el chatter no actualiza"
description: El segundo puerto de Odoo, el que casi nadie proxyea, y el síntoma que produce.
date: 2026-10-11
topic: ERP
tags: [odoo, nginx, websockets]
goal: Las notificaciones en vivo funcionando detrás del proxy.
course: odoo-produccion
section: nginx
order: 2
---

Este es el problema más frecuente de un despliegue de Odoo, y el que más tiempo hace perder porque **el síntoma no se parece a la causa**.

Alguien escribe un mensaje en el chatter. Al otro no le aparece hasta que recarga. Las notificaciones de actividades no llegan. El contador de conversaciones no se mueve.

Nada de eso falla. Simplemente nadie proxyeó el segundo puerto.

## Odoo escucha en dos puertos

| Puerto | Qué atiende |
|---|---|
| **8069** | todo el HTTP normal |
| **8072** | las conexiones largas: websockets, notificaciones en vivo, el chatter |

El segundo lo atiende un proceso aparte basado en **gevent**, pensado para mantener miles de conexiones abiertas sin un hilo por cada una. Por eso es un puerto distinto y no una ruta más del primero.

```ini config/odoo.conf
http_port = 8069
gevent_port = 8072
```

> **Si leíste `longpolling_port`**
> Ese era el nombre en versiones anteriores, y sigue apareciendo en casi todos los tutoriales y en bastantes libros. **En Odoo 19 la opción se llama `gevent_port`**, con 8072 de default. Si la ponés con el nombre viejo, Odoo la ignora en silencio.

## La clave: solo existe con workers

Acá está lo que explica por qué el problema aparece recién en producción:

**Con `workers = 0`, Odoo corre en un solo proceso y atiende todo por el 8069.** El chatter funciona perfecto en tu máquina.

**Con `workers > 0`, Odoo arranca el proceso de gevent aparte** y las conexiones largas se van al 8072.

Como en desarrollo usás `workers = 0` y en producción no, el problema nace justo cuando pasás a producción. Y como todo lo demás anda, cuesta relacionarlo.

## El bloque que falta

```nginx /etc/nginx/sites-available/taller
upstream odoo_websocket {
    server 127.0.0.1:8072;
}

server {
    # ... el resto de la configuración de la lección anterior ...

    location /websocket {
        proxy_pass http://odoo_websocket;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 720s;
        proxy_send_timeout 720s;
    }
}
```

Las tres líneas que no pueden faltar:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
```

Un websocket empieza como una petición HTTP normal que pide **cambiar de protocolo** con una cabecera `Upgrade`. Nginx, por defecto, habla HTTP/1.0 con el backend y **no reenvía esa cabecera**, así que el cambio nunca ocurre.

Sin esas tres líneas la conexión se establece y se cae enseguida, una y otra vez.

Y el `proxy_read_timeout` largo es igual de necesario: un websocket **está diseñado para quedarse abierto sin tráfico**. Con el default de 60 segundos, Nginx lo corta cada minuto y el cliente reconecta en un bucle eterno.

## Cómo se ve cuando falta

En la consola del navegador:

```text
WebSocket connection to 'wss://taller.ejemplo.com/websocket' failed
```

En la pestaña de red, filtrando por WS, vas a ver la conexión intentando y fallando cada pocos segundos.

En el log de Nginx:

```text
"GET /websocket HTTP/1.1" 404
```

Ese 404 es la pista más clara: **la petición llegó a Nginx y no supo a dónde mandarla** porque no hay un `location /websocket`.

## Verificar que anda

```bash Terminal · el puerto responde
curl -I http://127.0.0.1:8072/websocket
```

```bash Terminal · el proceso de gevent existe
docker compose exec odoo ps aux | grep gevent
```

Si con `workers > 0` no hay proceso de gevent, el problema es la configuración de Odoo, no la de Nginx.

**Y la prueba que de verdad vale**: abrí Odoo en dos navegadores distintos, con dos usuarios, y escribí un mensaje en el chatter de un registro desde uno. Tiene que aparecer en el otro **sin recargar**, en un par de segundos.

Esa prueba hacela el día del despliegue. Es un minuto y te ahorra que te la reporten como «el sistema va lento» tres semanas después.

## Lo que se rompe exactamente

Por si te lo reportan con otras palabras:

- Los mensajes del chatter no aparecen hasta recargar.
- Las notificaciones de actividades no llegan.
- El contador de Conversaciones no se actualiza.
- En las listas, los cambios de otro usuario no se reflejan.
- Si usás Punto de Venta, las pantallas no se sincronizan.

Todo eso es **un solo bloque de Nginx faltante**. Vale la pena tener la lista a mano porque ninguno de esos síntomas dice «websocket».

> **Quedate con esto**
> El 8072 solo entra en juego con `workers > 0`, y por eso el problema nace exactamente al pasar a producción. El `location /websocket` necesita `proxy_http_version 1.1` más las dos cabeceras de `Upgrade`, o la conexión no cambia de protocolo. Y el timeout largo es obligatorio: un websocket se queda abierto sin tráfico a propósito.
