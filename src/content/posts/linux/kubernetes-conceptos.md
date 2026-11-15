---
title: "Kubernetes: la arquitectura y los objetos"
description: Qué problema resuelve, el plano de control y los nodos, los objetos que vas a usar todos los días, el modelo declarativo, y cuándo no hace falta.
date: 2026-10-19
topic: Infraestructura
tags: [linux, kubernetes, contenedores]
goal: Entender cómo funciona Kubernetes por dentro y decidir si tu aplicación lo necesita.
course: linux-administracion
section: nube
order: 3
---

Con [Docker](/blog/linux/docker), la API corre en un contenedor en un servidor. ¿Y si querés tres copias, en tres servidores, que se reemplacen solas si una muere, que se actualicen de a una sin cortar el servicio, y que alguien decida en qué servidor va cada una? Eso es un **orquestador**, y Kubernetes es el que ganó.

## El modelo declarativo

Con Docker decís **qué hacer**: «arrancá este contenedor». Con Kubernetes decís **qué querés**: «quiero tres copias de la API con esta imagen». Kubernetes compara lo que querés con lo que hay, todo el tiempo, y corrige la diferencia.

Si un servidor se apaga y se lleva una copia, Kubernetes ve dos donde querías tres, y crea otra en otro servidor. No lo programaste: es la consecuencia de haber declarado el estado deseado. Ese ciclo de «observar, comparar, corregir» se llama *reconciliación*, y es la idea central.

## La arquitectura

Un clúster tiene un **plano de control**, que decide, y **nodos**, que ejecutan.

| Componente | Dónde | Hace |
|---|---|---|
| **kube-apiserver** | Plano de control | La única puerta: todo, incluido `kubectl`, habla con la API |
| **etcd** | Plano de control | La base de datos con el estado deseado y el actual. Si se pierde, se pierde el clúster |
| **kube-scheduler** | Plano de control | Decide en qué nodo va cada contenedor nuevo, según recursos y reglas |
| **kube-controller-manager** | Plano de control | Los bucles de reconciliación: réplicas, nodos, trabajos |
| **kubelet** | Cada nodo | Recibe qué tiene que correr ahí y se lo pide al runtime |
| **container runtime** | Cada nodo | containerd: arranca los contenedores, con los [namespaces y cgroups](/blog/linux/contenedores-por-dentro) de siempre |
| **kube-proxy** | Cada nodo | Programa las reglas de red para que los Services funcionen |

En un servicio administrado, como EKS, AKS o GKE, el plano de control lo opera el proveedor y vos solo ves los nodos. Es la forma más común de usar Kubernetes en producción.

## Los objetos

Todo en Kubernetes es un objeto descrito en YAML, con la misma forma: `apiVersion`, `kind`, `metadata` y `spec`, el estado deseado.

| Objeto | Es | Para la API de facturación |
|---|---|---|
| **Pod** | Uno o más contenedores que comparten red y discos; la unidad mínima | Una copia de la API |
| **Deployment** | Mantiene N copias de un Pod y las actualiza de a poco | Las réplicas de la API |
| **StatefulSet** | Como un Deployment, pero cada Pod con identidad y disco propios y estables | PostgreSQL |
| **Service** | Un nombre y una IP estable delante de un grupo de Pods | `api` y `db` |
| **ConfigMap** | Configuración no secreta | La URL del PSE |
| **Secret** | Configuración secreta | La contraseña de la base |
| **PersistentVolumeClaim** | Un pedido de disco | Los datos de PostgreSQL |
| **Job** | Algo que corre hasta terminar | Crear el esquema |
| **CronJob** | Un Job programado | Enviar pendientes cada 5 minutos |
| **Ingress** | Reglas HTTP desde afuera hacia los Services | `api.empresa.pe` → `api` |
| **Namespace** | Una división del clúster | `facturacion` |

Los Pods son **descartables**: no se arreglan, se reemplazan, y cada reemplazo tiene otra IP. Por eso nadie habla con un Pod directamente: se habla con su **Service**, que tiene un nombre fijo en el DNS interno del clúster, `db.facturacion.svc.cluster.local`, o simplemente `db` desde el mismo namespace.

## Las etiquetas

Los objetos se encuentran entre sí por **etiquetas**, no por nombre. Un Deployment crea Pods con la etiqueta `app: api`; el Service manda tráfico a todos los Pods con `app: api`, sean los que sean en ese momento:

```yaml Fragmento
kind: Service
spec:
  selector:
    app: api
```

Si un Pod nuevo nace con esa etiqueta, recibe tráfico. Si deja de estar sano, el Service lo saca.

## Las probes

Kubernetes necesita saber si un contenedor está bien, y lo pregunta:

| Probe | Pregunta | Si falla |
|---|---|---|
| `readinessProbe` | ¿Puede recibir tráfico? | Lo saca del Service, sin matarlo |
| `livenessProbe` | ¿Está vivo? | Lo reinicia |
| `startupProbe` | ¿Terminó de arrancar? | Espera antes de evaluar las otras |

Para eso la API tiene un endpoint `/salud`. Sin probes, Kubernetes manda tráfico a un contenedor que todavía está arrancando, o deja vivo a uno colgado.

## Requests y limits

```yaml Fragmento
resources:
  requests: { cpu: 100m, memory: 128Mi }
  limits: { memory: 256Mi }
```

`requests` es lo que el scheduler **reserva** para ubicar el Pod en un nodo con espacio. `limits` es el tope que el cgroup aplica: si el contenedor lo supera en memoria, el OOM killer lo mata, con el mismo `OOMKilled` que viste en [diagnóstico](/blog/linux/diagnostico). `100m` son 100 milinúcleos: un décimo de CPU.

## Cuándo no

Kubernetes resuelve problemas reales y trae los suyos: una capa entera más de conceptos, redes y seguridad, actualizaciones del clúster cada pocos meses, y un costo fijo de nodos y plano de control.

| Situación | Alcanza con |
|---|---|
| Una aplicación, un servidor | systemd o Docker compose |
| Unas pocas aplicaciones, tráfico moderado | Compose en un par de servidores, o un PaaS |
| Muchos servicios, equipos que despliegan solos, escalar según la carga | Kubernetes administrado |

La API de facturación de un negocio no necesita Kubernetes. La plataforma de un proveedor de facturación electrónica que atiende a miles de empresas, probablemente sí. La [lección siguiente](/blog/linux/kubernetes-en-la-practica) la despliega igual, porque es la mejor forma de ver todo esto funcionando.

> **Quedate con esto**
> Kubernetes es declarativo: describís el estado que querés y los controladores lo reconcilian sin parar. El plano de control decide (API, etcd, scheduler, controladores) y los nodos ejecutan con kubelet y containerd. Los Pods son descartables y se les habla a través de Services, que los encuentran por etiquetas. Probes para que sepa si están bien, requests y limits para ubicarlos y acotarlos. Y para una sola aplicación, no hace falta.
