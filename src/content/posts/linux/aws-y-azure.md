---
title: "Servidores en AWS y Azure desde la CLI"
description: Crear el servidor de facturación en EC2 con su par de claves, security group, cloud-init, IMDSv2 y una IP fija, sumarle un disco, y lo equivalente en Azure.
date: 2026-10-19
topic: Infraestructura
tags: [linux, aws, azure, nube]
goal: Crear y administrar servidores en AWS y Azure desde la línea de comandos, con una configuración segura desde el primer minuto.
course: linux-administracion
section: nube
order: 2
---

Las consolas web cambian de diseño cada año; la CLI no. Y un servidor creado con comandos se puede repetir, revisar y documentar.

Un aviso sobre esta lección: el laboratorio no tenía cuentas de AWS ni de Azure. Cada comando se pasó por la CLI oficial, AWS CLI 2.38 y Azure CLI 2.91, que **verifica la sintaxis y los nombres de los parámetros antes de pedir credenciales**: un parámetro inventado falla ahí mismo. Lo que no verifica son los valores, como el tipo de instancia o el ID de la imagen; esos vienen de la documentación de cada proveedor.

## AWS: lo que se crea

| Recurso | Qué es |
|---|---|
| Par de claves | Tu clave pública SSH, registrada en AWS |
| Security group | El firewall de la nube, asociado a la instancia |
| Instancia EC2 | La VM |
| Volumen EBS | Un disco de red |
| Elastic IP | Una IP pública fija |

Con la CLI configurada (`aws configure`, o mejor `aws configure sso`) y una región elegida, por ejemplo `export AWS_DEFAULT_REGION=sa-east-1` para São Paulo.

### La clave

```bash Terminal
aws ec2 import-key-pair --key-name ana-laptop \
  --public-key-material fileb://~/.ssh/id_ed25519.pub
```

Importar tu clave pública es mejor que `create-key-pair`, que genera la privada del lado de AWS y te la manda: tu clave privada nunca debería haber pasado por otro lado.

### El security group

```bash Terminal
MI_IP=$(curl -s https://checkip.amazonaws.com)
SG=$(aws ec2 create-security-group --group-name facturacion-web \
  --description "API de facturacion" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 22 --cidr "$MI_IP/32"
aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
  'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]'
```

SSH **solo desde tu IP**, `/32`. Web para todos. Un security group nuevo deniega toda la entrada por defecto, y permite toda la salida.

### La imagen

Los IDs de las imágenes cambian por región y con cada actualización. Canonical publica el de la última Ubuntu en un parámetro público:

```bash Terminal
AMI=$(aws ssm get-parameters \
  --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameters[0].Value' --output text)
```

Así el script siempre usa la imagen actual, con los parches más recientes, sin copiar IDs de una página.

### La instancia

```bash Terminal
ID=$(aws ec2 run-instances \
  --image-id "$AMI" \
  --instance-type t3.small \
  --key-name ana-laptop \
  --security-group-ids "$SG" \
  --user-data file://user-data \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=facturacion-01}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$ID"
```

**`--user-data file://user-data`** es el mismo archivo de la [lección de cloud-init](/blog/linux/cloud-init): la instancia arranca con tu usuario, SSH endurecido, firewall y actualizaciones automáticas. La CLI lo codifica en base64 sola.

**`HttpTokens=required`** obliga a usar **IMDSv2**, la versión del servicio de metadatos que pide un token. Con la versión vieja, una vulnerabilidad en tu aplicación que haga pedidos HTTP arbitrarios puede leer `http://169.254.169.254/...` y robar las credenciales de la instancia. Es una línea y debería estar siempre.

**`Encrypted=true`** cifra el disco con una clave administrada por AWS, sin costo extra.

`wait instance-status-ok` bloquea hasta que la instancia pasa sus chequeos. Después:

```bash Terminal
aws ec2 describe-instances --instance-ids "$ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
ssh ana@<esa-ip> 'cloud-init status --wait'
```

### Una IP que no cambie

La IP pública de una instancia **cambia cada vez que se detiene y arranca**. Para un servidor al que apunta un DNS:

```bash Terminal
EIP=$(aws ec2 allocate-address --query AllocationId --output text)
aws ec2 associate-address --instance-id "$ID" --allocation-id "$EIP"
```

### Un disco para los datos

```bash Terminal
VOL=$(aws ec2 create-volume --availability-zone sa-east-1a --size 50 \
  --volume-type gp3 --encrypted --query VolumeId --output text)
aws ec2 attach-volume --volume-id "$VOL" --instance-id "$ID" --device /dev/sdf
```

El volumen tiene que estar en **la misma zona** que la instancia. Dentro, en las instancias modernas, no aparece como `/dev/sdf` sino como `/dev/nvme1n1`: otra razón para montar por UUID, como en [discos y sistemas de archivos](/blog/linux/discos-y-sistemas-de-archivos). Y agrandarlo después es `aws ec2 modify-volume` más `growpart` y `resize2fs`, en caliente, como en [particiones](/blog/linux/particiones).

### Snapshot, parar, borrar

```bash Terminal
aws ec2 create-snapshot --volume-id "$VOL" --description "antes de migrar"
aws ec2 stop-instances --instance-ids "$ID"
aws ec2 terminate-instances --instance-ids "$ID"
```

| | El disco | Se cobra |
|---|---|---|
| `stop` | Se conserva | El disco y la Elastic IP |
| `terminate` | **Se borra el disco raíz** | Nada de la instancia |

`terminate` no tiene vuelta atrás. Para una instancia de producción, activá la protección: `aws ec2 modify-instance-attribute --instance-id "$ID" --disable-api-termination`.

## Azure

Los mismos conceptos con otros nombres. En Azure, todo vive en un **grupo de recursos**, y borrar el grupo borra todo lo de adentro:

```bash Terminal
az group create --name facturacion --location brazilsouth
az vm create \
  --resource-group facturacion \
  --name facturacion-01 \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username ana \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --custom-data user-data \
  --public-ip-sku Standard \
  --nsg-rule SSH \
  --os-disk-size-gb 30
az vm open-port --resource-group facturacion --name facturacion-01 --port 443 --priority 1010
```

| AWS | Azure |
|---|---|
| Security group | Network Security Group, NSG |
| AMI | Imagen, con alias como `Ubuntu2404` |
| User data | `--custom-data` |
| Elastic IP | IP pública con SKU `Standard` y asignación estática |
| EBS | Managed disk |
| `stop` | `az vm deallocate`: `az vm stop` apaga, pero **se sigue cobrando** la VM |

La última fila confunde a todo el que viene de AWS: en Azure, una VM detenida con `stop` sigue reservando el hardware y se cobra. Para dejar de pagar, `deallocate`.

```bash Terminal
az vm list --resource-group facturacion --show-details \
  --query "[].{nombre:name, ip:publicIps, estado:powerState}" -o table
az vm deallocate --resource-group facturacion --name facturacion-01
az group delete --name facturacion --yes --no-wait
```

El alias de la imagen lo da la propia CLI:

```text Terminal · az vm image list --query "[?contains(urnAlias, 'Ubuntu')].urnAlias" -o tsv
Ubuntu2204
Ubuntu2404
Ubuntu2404Pro
```

## Del script a la infraestructura como código

Estos comandos sirven para entender qué se crea y para tareas puntuales. Para infraestructura que va a vivir años, se describe en archivos con **Terraform** u OpenTofu, que guardan el estado y muestran qué van a cambiar antes de hacerlo, como el `--check --diff` de [Ansible](/blog/linux/ansible-roles).

> **Quedate con esto**
> En AWS: tu clave pública importada, un security group con SSH solo desde tu IP, la imagen de Ubuntu desde el parámetro de SSM de Canonical, el user-data de cloud-init, IMDSv2 obligatorio y disco cifrado. Una Elastic IP si la IP no puede cambiar, y los volúmenes en la misma zona que la instancia. `terminate` borra el disco: protegé las de producción. En Azure, lo mismo con otros nombres, y para dejar de pagar una VM, `deallocate`, no `stop`.
