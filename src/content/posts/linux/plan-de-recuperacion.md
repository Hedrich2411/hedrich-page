---
title: "Plan de recuperación: RPO, RTO y el riesgo en soles"
description: Cuánto podés perder y cuánto podés tardar, cómo poner un número a cada riesgo, la regla 3-2-1 y por qué el plan no existe hasta que lo probás.
date: 2026-10-19
topic: Infraestructura
tags: [linux, backups, recuperacion]
goal: Escribir un plan de recuperación con números concretos para el servidor de facturación.
course: linux-administracion
section: recuperacion
order: 1
---

«Tenemos backups» no es un plan. Un plan responde, antes de que pase: **si mañana este servidor desaparece, cuánto perdemos, cuánto tardamos en volver, y quién hace qué**.

## Dos números

| | Pregunta | Para el servidor de facturación |
|---|---|---|
| **RPO**, objetivo de punto de recuperación | ¿Cuántos datos puedo perder? | Una hora de comprobantes emitidos |
| **RTO**, objetivo de tiempo de recuperación | ¿Cuánto puede estar caído? | Cuatro horas |

No son números técnicos: los decide el negocio, y la técnica dice cuánto cuesta cumplirlos. Un RPO de un día se cumple con un `pg_dump` nocturno. Un RPO de una hora necesita volcados cada hora o archivado continuo del WAL de PostgreSQL. Un RPO de cero necesita una réplica en otro servidor.

Para facturación electrónica hay un dato que ayuda: cada comprobante aceptado también lo tiene SUNAT. Perder una hora de datos no es perder la factura; es tener que reconstruir el estado desde el PSE. Ese tipo de detalle es el que baja el costo de un RPO razonable.

## Poner el riesgo en números

La fórmula clásica de análisis de riesgo:

| Término | Qué es |
|---|---|
| **SLE**, pérdida por evento | Lo que cuesta que pase una vez |
| **ARO**, ocurrencias por año | Cuántas veces se espera que pase en un año |
| **ALE**, pérdida anual esperada | SLE × ARO |

Para el servidor de facturación, con números de ejemplo:

| Riesgo | SLE | ARO | ALE |
|---|---|---|---|
| Disco del proveedor que falla | S/ 8 000: un día sin facturar y la reconstrucción | 0,05 | S/ 400 |
| Borrado accidental de datos | S/ 3 000 | 0,5 | S/ 1 500 |
| Ransomware en el servidor | S/ 40 000 | 0,02 | S/ 800 |
| Caída de la región del proveedor | S/ 8 000 | 0,1 | S/ 800 |

El ALE dice cuánto tiene sentido gastar por año en mitigar cada riesgo. Si un backup externo cifrado cuesta S/ 300 al año y cubre los cuatro, la discusión termina rápido. Si una réplica en otra región cuesta S/ 6 000 al año para cubrir un riesgo de S/ 800, no se justifica.

Con cada riesgo se elige una estrategia:

| Estrategia | Ejemplo |
|---|---|
| **Evitar** | No guardar en el servidor datos que no hacen falta |
| **Mitigar** | Backups, réplicas, permisos mínimos |
| **Transferir** | Un servicio administrado de base de datos, un seguro |
| **Disuadir** | Firewall, fail2ban, auditoría visible |
| **Aceptar** | Documentar que el riesgo existe y que no vale la pena cubrirlo |

Aceptar está bien, siempre que sea una decisión escrita y no un olvido.

## Las métricas de disponibilidad

| | Mide |
|---|---|
| **MTBF**, tiempo medio entre fallas | Cada cuánto falla algo reparable |
| **MTTR**, tiempo medio de reparación | Cuánto se tarda en volver |

El RTO es una promesa; el MTTR es lo que de verdad tardás. Si en el último simulacro restaurar tardó seis horas, el RTO de cuatro no se está cumpliendo, diga lo que diga el documento.

## La regla 3-2-1

- **3 copias** de los datos: la original y dos backups.
- En **2 medios** distintos: el disco del servidor y otro lugar.
- **1 copia fuera** del sitio: otro proveedor, otra región, otra cuenta.

Y la variante moderna, por el ransomware: **una copia inmutable o desconectada**, que ni siquiera el servidor comprometido pueda borrar. Un bucket con bloqueo de objetos, o un repositorio de backups al que el servidor solo puede agregar.

## Qué se respalda

| Sí | No hace falta |
|---|---|
| La base de datos, con `pg_dump` o `pg_basebackup` | El sistema operativo: se reinstala |
| `/etc`: la configuración | Los paquetes: se reinstalan |
| Los datos de la aplicación que no están en la base | El código, si está en git |
| Los secretos, cifrados y en otro lugar | Cachés, temporales |
| La **lista de pasos** para reconstruir | |

La última fila es la que más se olvida. Si reconstruir el servidor depende de que alguien recuerde cómo se configuró, el RTO es «cuando esa persona vuelva de vacaciones». Con [cloud-init](/blog/linux/cloud-init) y [Ansible](/blog/linux/ansible), la lista de pasos es código.

## El plan escrito

Una página alcanza:

```text plan-de-recuperacion.md · Estructura
1. Qué cubre: servidor facturacion-01, base facturación, API.
2. RPO: 1 hora. RTO: 4 horas.
3. Dónde están los backups, cada cuánto, cuánto se guardan.
4. Dónde están las claves para descifrarlos (no en el mismo servidor).
5. Cómo se reconstruye: crear el servidor, aplicar Ansible, restaurar la base.
6. Cómo se comprueba que volvió: emitir un comprobante de prueba.
7. Quién decide activar el plan y quién lo ejecuta.
8. Fecha del último simulacro y cuánto tardó.
```

## Probarlo

**El plan no existe hasta que lo probaste.** Una vez por trimestre, en un servidor nuevo:

1. Crear el servidor desde cero, sin mirar el de producción.
2. Restaurar el último backup.
3. Arrancar la API y emitir un comprobante.
4. Anotar cuánto tardó y qué faltaba.

La primera vez siempre falta algo: una clave que nadie sabía dónde estaba, un paquete que se instaló a mano hace dos años, un paso que solo estaba en la cabeza de alguien. Encontrarlo un martes cualquiera es la idea.

> **Quedate con esto**
> El RPO es cuánto podés perder y el RTO cuánto podés tardar, y los decide el negocio. SLE × ARO = ALE pone cada riesgo en soles y dice cuánto vale la pena gastar en él. 3-2-1, con una copia que el servidor comprometido no pueda borrar. Se respaldan datos, configuración y la lista de pasos para reconstruir. Y un plan que no se probó es una hipótesis: simulacro trimestral, cronometrado.
