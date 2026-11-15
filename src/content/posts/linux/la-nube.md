---
title: "La nube: IaaS, PaaS y quién es responsable de qué"
description: Los modelos de servicio con ejemplos concretos, la responsabilidad compartida, regiones y zonas, y cómo decidir entre un VPS, una nube grande o un servicio administrado.
date: 2026-10-19
topic: Infraestructura
tags: [linux, nube, aws]
goal: Elegir dónde correr el servidor de facturación con criterios de costo, responsabilidad y disponibilidad.
course: linux-administracion
section: nube
order: 1
---

«La nube» es, en concreto, alquilar infraestructura de otro con una API para pedirla y devolverla en minutos. Lo que cambia entre ofertas es **cuánto de la pila administra el proveedor y cuánto vos**.

## Los modelos

| Modelo | Te dan | Vos administrás | Ejemplos |
|---|---|---|---|
| **IaaS**, infraestructura | Una VM, discos, redes | El sistema operativo y todo lo de arriba | AWS EC2, Azure VMs, Google Compute Engine, DigitalOcean, Hetzner |
| **CaaS**, contenedores | Un lugar donde correr contenedores | Las imágenes y su configuración | AWS ECS y EKS, Azure AKS, Google GKE y Cloud Run |
| **PaaS**, plataforma | Un entorno donde subís código | El código | AWS Elastic Beanstalk, Google App Engine, DigitalOcean App Platform, Heroku |
| **SaaS**, software | La aplicación terminada | Tus datos y usuarios | Gmail, Odoo Online |

Este curso entero es IaaS: te dan una VM y el resto es tuyo. Es el modelo con más trabajo y más control.

## Responsabilidad compartida

El error más caro en la nube es creer que el proveedor se ocupa de algo que es tuyo:

| | IaaS | CaaS / PaaS |
|---|---|---|
| Hardware, datacenter, red física | Proveedor | Proveedor |
| Hipervisor | Proveedor | Proveedor |
| Sistema operativo y sus parches | **Vos** | Proveedor |
| Firewall del servidor | **Vos** | Proveedor, en parte |
| Tu aplicación y sus dependencias | **Vos** | **Vos** |
| Tus datos y sus backups | **Vos** | **Vos** |
| Quién tiene acceso a la cuenta | **Vos** | **Vos** |

Las dos últimas filas son tuyas **en todos los modelos**. Un proveedor que pierde un disco te va a dar otro; no te va a devolver tus datos si no tenías backup. Y la causa más común de incidentes en la nube no es un ataque sofisticado: es un bucket o una base de datos expuesta por un permiso mal puesto.

## Regiones y zonas

| Concepto | Qué es | Para qué importa |
|---|---|---|
| **Región** | Una ubicación geográfica: São Paulo, Virginia, Santiago | Latencia y leyes sobre dónde viven los datos |
| **Zona de disponibilidad** | Un datacenter independiente dentro de la región | Que una falla de energía no tire todo |

Para una aplicación usada en Perú, la región más cercana de AWS es São Paulo, `sa-east-1`; en Azure, Brazil South. Una VM vive en una zona. Para sobrevivir a la caída de una zona hacen falta dos servidores en zonas distintas y un balanceador, o una base de datos administrada con réplica en otra zona. Para una caída de región entera, una copia en otra región, que es lo que el [plan de recuperación](/blog/linux/plan-de-recuperacion) decide si vale lo que cuesta.

## VPS o nube grande

| | VPS: DigitalOcean, Hetzner, Linode | Nube grande: AWS, Azure, GCP |
|---|---|---|
| Precio | Bajo y predecible | Por uso, con muchos conceptos que suman |
| Tráfico de salida | Incluido en generosas cantidades | Se paga por GB, y puede ser lo más caro |
| Servicios administrados | Pocos: bases de datos, balanceadores | Cientos |
| Complejidad | Baja | Alta: redes, permisos, cuentas |
| Para | Una aplicación, un equipo chico | Muchos servicios, requisitos corporativos, escala |

Para el servidor de facturación de un negocio mediano, un VPS de 2 vCPU y 4 GB alcanza y sobra. La nube grande empieza a pagar cuando necesitás lo que el VPS no tiene: una base de datos administrada con réplicas, permisos finos por equipo, cumplimiento de normas específicas.

## Servicios administrados

La decisión que más cambia el trabajo diario: ¿PostgreSQL en el servidor, o un servicio administrado como Amazon RDS o Azure Database for PostgreSQL?

| Lo hace el servicio administrado | Te queda a vos |
|---|---|
| Parches, actualizaciones menores | Elegir cuándo |
| Backups automáticos y restauración a un momento | Probar que restaurar funciona |
| Réplica en otra zona | Pagarla |
| Monitoreo básico | Los índices y las consultas lentas |

Cuesta entre dos y tres veces lo que la misma base en una VM. A cambio, la mitad de la sección de [backups y recuperación](/blog/linux/backups) deja de ser tuya. Para un equipo sin alguien dedicado a infraestructura, suele valer la pena.

## Lo que cambia administrar en la nube

**Los servidores son descartables.** Un servidor se crea con una API y una plantilla, no se instala a mano. Si algo se rompe, se reemplaza. Eso solo funciona si la configuración es código: [cloud-init](/blog/linux/cloud-init) para el arranque y [Ansible](/blog/linux/ansible) para el resto.

**El firewall tiene dos capas**: la del proveedor, *security groups* o reglas de red, y la del servidor.

**Los discos son de red.** Se agrandan desde la consola sin apagar nada, se les toman snapshots en segundos y se pueden mover a otra VM. Es lo que hace la técnica de la [instancia de rescate](/blog/linux/arranque-que-falla).

**El costo se mira.** Una VM olvidada, un disco sin usar o tráfico de salida inesperado aparecen en la factura a fin de mes. Alertas de presupuesto desde el primer día.

## Las herramientas de gestión

| Herramienta | Hace |
|---|---|
| La CLI del proveedor: `aws`, `az`, `gcloud` | Crear y consultar recursos desde la terminal |
| Terraform, OpenTofu | Describir la infraestructura en archivos y crearla, para cualquier proveedor |
| Ansible | Configurar lo que hay dentro de los servidores |
| Puppet, Chef | Lo mismo que Ansible, con un agente en cada servidor |

Terraform crea el servidor, la red y el disco; Ansible entra al servidor y lo deja listo. Es la combinación más común. En este curso, la [lección siguiente](/blog/linux/aws-y-azure) usa la CLI para entender qué se crea, y la [sección de Ansible](/blog/linux/ansible) cierra la parte de adentro.

> **Quedate con esto**
> IaaS te da una VM y el resto es tuyo; CaaS y PaaS administran más, a cambio de menos control. Tus datos, tus backups y quién accede a la cuenta son tuyos en todos los modelos. Una VM vive en una zona: para sobrevivir a su caída, dos zonas. Para una aplicación, un VPS suele alcanzar; la nube grande paga con servicios administrados y requisitos corporativos. Y en la nube los servidores son descartables, lo que exige que su configuración sea código.
