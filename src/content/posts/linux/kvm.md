---
title: "Máquinas virtuales con KVM y libvirt"
description: "Hipervisores, la pila KVM, QEMU y libvirt, crear una VM desde una imagen cloud con virt-install, y administrarla con virsh: snapshots, recursos y clones."
date: 2026-10-19
topic: Infraestructura
tags: [linux, kvm, libvirt, virtualizacion]
goal: Crear y administrar máquinas virtuales en un servidor Linux propio.
course: linux-administracion
section: virtualizacion
order: 1
---

Una máquina virtual es una computadora completa, con su kernel, que corre como un proceso dentro de otra. En la nube, cada servidor que creás es una VM; en un servidor propio, KVM te da lo mismo sin pagarle a nadie.

## Dos tipos de hipervisor

| | Tipo 1, sobre el hardware | Tipo 2, sobre un sistema operativo |
|---|---|---|
| Ejemplos | KVM, Xen, VMware ESXi, Hyper-V | VirtualBox, VMware Workstation |
| Para | Servidores | Escritorio, laboratorio |

KVM es un módulo del kernel que convierte a Linux en un hipervisor tipo 1. Encima trabajan dos piezas más:

| Pieza | Hace |
|---|---|
| **KVM** | Usa las extensiones de virtualización de la CPU para que la VM corra a velocidad nativa |
| **QEMU** | Emula el resto: discos, red, placa de video |
| **libvirt** | Una API y un servicio, `libvirtd`, para administrar VMs, redes y almacenamiento |
| **virsh**, **virt-install** | Las herramientas de línea de comandos de libvirt |

Es la misma pila que usan OpenStack, Proxmox y muchos proveedores de nube.

## ¿La CPU puede?

```bash Terminal
grep -cE 'vmx|svm' /proc/cpuinfo     # más de 0: Intel VT-x o AMD-V disponibles
ls -l /dev/kvm                       # existe si el módulo está cargado
sudo virt-host-validate qemu
```

Sin `/dev/kvm`, QEMU puede igual emular la CPU por software, en modo TCG: funciona, pero entre diez y cincuenta veces más lento. El laboratorio de esta lección corrió así, dentro de un contenedor sin acceso a `/dev/kvm`, y por eso las VMs se crean con `--virt-type qemu`. En un servidor con KVM, ese parámetro se omite.

## Instalar

```bash Terminal
sudo apt install --no-install-recommends qemu-system-x86 qemu-utils \
  libvirt-daemon-system libvirt-clients virtinst dnsmasq-base
sudo usermod -aG libvirt ana
```

`dnsmasq-base` es el DHCP y DNS de la red virtual por defecto. Sin él, la red `default` no arranca, con un error que no dice eso: «Unable to find 'dnsmasq' binary». Y si en el servidor ya hay un DNS escuchando en el puerto 53 de todas las interfaces, como un BIND mal acotado, tampoco: «failed to create listening socket for 192.168.122.1: Address already in use». Los dos aparecieron armando este laboratorio.

```bash Terminal
sudo virsh net-start default
sudo virsh net-autostart default
```

La red `default` es una red con NAT en `192.168.122.0/24`: las VMs salen a Internet a través del host, y el host las ve.

## Una VM desde una imagen cloud

Instalar Ubuntu desde el ISO en cada VM es lento. Las **imágenes cloud** vienen instaladas y se configuran solas al primer arranque con [cloud-init](/blog/linux/cloud-init):

```bash Terminal
cd /var/lib/libvirt/images
sudo curl -LO https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-amd64.img
qemu-img info ubuntu-24.04-minimal-cloudimg-amd64.img
```

```text Terminal
file format: qcow2
virtual size: 3.5 GiB (3758096384 bytes)
```

Cada VM usa la imagen como **base** y guarda solo sus diferencias:

```bash Terminal
sudo qemu-img create -f qcow2 -F qcow2 -b ubuntu-24.04-minimal-cloudimg-amd64.img facturacion-01.qcow2 10G
```

```text Terminal · qemu-img info facturacion-01.qcow2
virtual size: 10 GiB (10737418240 bytes)
disk size: 196 KiB
backing file: ubuntu-24.04-minimal-cloudimg-amd64.img
```

10 GB de disco virtual, 196 KB ocupados. La imagen base no se puede modificar ni borrar mientras haya VMs que dependan de ella.

```bash Terminal
sudo virt-install \
  --name facturacion-01 \
  --memory 2048 --vcpus 2 \
  --osinfo ubuntu24.04 \
  --disk path=/var/lib/libvirt/images/facturacion-01.qcow2,format=qcow2,bus=virtio \
  --import \
  --cloud-init user-data=/var/lib/libvirt/cloud-init/facturacion-01.yaml \
  --network network=default,model=virtio \
  --graphics none --noautoconsole
```

`--import` arranca del disco que le das, sin instalador. `--cloud-init` arma la configuración inicial: el usuario y su clave SSH, como vas a ver en la lección siguiente. `virtio` en disco y red son los drivers paravirtualizados, mucho más rápidos que emular hardware real.

```text Terminal · virsh domifaddr facturacion-01
 Name       MAC address          Protocol     Address
-------------------------------------------------------------------------------
 vnet0      52:54:00:f1:99:6f    ipv4         192.168.122.11/24
```

```text Terminal · ssh ana@192.168.122.11 'cloud-init status --long | head -2; hostname'
status: done
extended_status: done
facturacion-01
```

Una VM nueva, configurada y con SSH, en menos de un minuto.

## virsh

| Para | Comando |
|---|---|
| Listar | `virsh list --all` |
| Arrancar, apagar | `virsh start`, `virsh shutdown` (ordenado), `virsh destroy` (desenchufar) |
| Consola serie | `virsh console facturacion-01`; se sale con `Ctrl+]` |
| Información | `virsh dominfo`, `virsh domblklist`, `virsh domifaddr` |
| Arrancar con el host | `virsh autostart facturacion-01` |
| Editar la definición | `virsh edit facturacion-01` |
| Borrar con sus discos | `virsh undefine facturacion-01 --remove-all-storage` |

`virsh destroy` no destruye nada: corta la corriente de la VM. El nombre asusta más de lo que hace.

### Recursos

Con la VM apagada, para que valga desde el próximo arranque:

```bash Terminal
virsh setmaxmem facturacion-01 4G --config
virsh setmem facturacion-01 3G --config
virsh setvcpus facturacion-01 4 --config --maximum
virsh setvcpus facturacion-01 4 --config
```

```text Terminal · dentro de la VM, después de arrancar
4
2891 MB
```

### Snapshots

Antes de una actualización riesgosa:

```bash Terminal
virsh shutdown facturacion-01
virsh snapshot-create-as facturacion-01 antes-de-actualizar --description "antes de apt upgrade"
virsh start facturacion-01
```

En el laboratorio, se escribió `versión 1` en un archivo, se tomó el snapshot, se cambió a `versión rota`, y se volvió atrás:

```text Terminal
$ virsh snapshot-list facturacion-01
 Name                  Creation Time               State
------------------------------------------------------------
 antes-de-actualizar   2026-10-19 22:22:34 +0000   shutoff
$ virsh snapshot-revert facturacion-01 antes-de-actualizar
Domain snapshot antes-de-actualizar reverted
$ ssh ana@192.168.122.11 cat /etc/estado
versión 1
```

Tomarlo con la VM apagada es más confiable. Con la VM corriendo, libvirt guarda también la memoria; en el laboratorio, con emulación por software, ese revert en caliente no volvió a levantar la VM, y es un caso donde no querés sorpresas.

Un snapshot no es un backup: vive en el mismo disco que la VM. Se crea antes del cambio y se borra cuando el cambio salió bien, con `virsh snapshot-delete`.

### Clones

```bash Terminal
virt-clone --original facturacion-01 --name facturacion-02 --auto-clone
```

```text Terminal
Clone 'facturacion-02' created successfully.
```

Copia el disco y le da a la VM nueva otra MAC. Lo que **no** cambia es lo que está adentro: el mismo hostname, las mismas claves de host de SSH, el mismo `machine-id`. Para hacer muchas VMs iguales, mejor que clonar es crear cada una desde la imagen base con su propio cloud-init. Si clonás, `virt-sysprep` limpia esas identidades antes del primer arranque.

> **Quedate con esto**
> KVM es el hipervisor en el kernel, QEMU emula los dispositivos, libvirt los administra y `virsh` es la herramienta. Sin `/dev/kvm` todo funciona pero muy lento. Las VMs se crean desde una imagen cloud con un disco qcow2 que guarda solo las diferencias, `virt-install --import --cloud-init` y drivers virtio. Snapshot con la VM apagada antes de cambios riesgosos, y borrarlo después. Y para muchas VMs iguales, imagen base más cloud-init en lugar de clones.
