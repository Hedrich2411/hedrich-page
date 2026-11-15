---
title: "Desplegar la API en Kubernetes"
description: Un clúster local con kind, la API y PostgreSQL con sus manifiestos, los errores reales que aparecieron en el camino, y un rollback cuando una imagen falla.
date: 2026-10-19
topic: Infraestructura
tags: [linux, kubernetes, kubectl]
goal: Desplegar, escalar, actualizar y revertir una aplicación real en Kubernetes, y diagnosticar cuando no arranca.
course: linux-administracion
section: nube
order: 4
---

Todo lo de esta lección corrió en un clúster real de tres nodos, creado con **kind**: Kubernetes dentro de contenedores de Docker. Los errores que aparecen no son inventados: salieron armando el despliegue, y son los que vas a ver en cualquier clúster.

## Un clúster local

```yaml kind.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```bash Terminal
kind create cluster --name curso-lab --config kind.yaml
kubectl get nodes
```

```text Terminal
NAME                      STATUS   ROLES           VERSION
curso-lab-control-plane   Ready    control-plane   v1.37.0
curso-lab-worker          Ready    <none>          v1.37.0
curso-lab-worker2         Ready    <none>          v1.37.0
```

| Para | Herramienta |
|---|---|
| Laboratorio en tu máquina | kind, o minikube |
| Un servidor o unos pocos, en producción liviana | k3s, o MicroK8s |
| Producción en la nube | EKS, AKS, GKE |

kind no tiene acceso al registro local de Docker: las imágenes construidas en tu máquina se cargan a los nodos con `kind load docker-image facturacion:1.0 --name curso-lab`.

## Los manifiestos

Todo en un archivo, separado con `---`. Lo principal:

```yaml facturacion.yaml · El secreto y la base
apiVersion: v1
kind: Namespace
metadata:
  name: facturacion
---
apiVersion: v1
kind: Secret
metadata:
  name: facturacion
  namespace: facturacion
type: Opaque
stringData:
  POSTGRES_PASSWORD: clave-del-cluster
  DATABASE_URL: postgresql+psycopg://facturacion:clave-del-cluster@db/facturacion
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
  namespace: facturacion
spec:
  serviceName: db
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: postgres
          image: postgres:18-alpine
          env:
            - name: POSTGRES_USER
              value: facturacion
            - name: POSTGRES_DB
              value: facturacion
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: facturacion
                  key: POSTGRES_PASSWORD
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "facturacion", "-d", "facturacion"]
          volumeMounts:
            - name: datos
              mountPath: /var/lib/postgresql
  volumeClaimTemplates:
    - metadata:
        name: datos
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 1Gi
```

Un **StatefulSet** para la base, porque su disco tiene que seguirla: `volumeClaimTemplates` crea un PersistentVolumeClaim por Pod, que sobrevive aunque el Pod se reemplace. Y un `Service` llamado `db` delante, que es el nombre que usa `DATABASE_URL`.

```yaml facturacion.yaml · La API
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: facturacion
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: api
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: api
          image: facturacion:1.0
          ports:
            - containerPort: 8000
          envFrom:
            - secretRef:
                name: facturacion
          readinessProbe:
            httpGet: { path: /salud, port: 8000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /salud, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { memory: 256Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

`maxUnavailable: 0` y `maxSurge: 1`: al actualizar, primero se crea un Pod nuevo y recién cuando está listo se borra uno viejo. Nunca hay menos de dos sirviendo. El `securityContext` es lo mismo que el endurecimiento de [Docker](/blog/linux/docker) y de systemd.

Y un **Job** que crea el esquema, con la misma imagen, que corre una vez y termina.

```bash Terminal
kubectl apply -f facturacion.yaml
kubectl -n facturacion rollout status statefulset/db
kubectl apply -f esquema.yaml
kubectl -n facturacion wait --for=condition=complete job/esquema
```

## Error 1: ImagePullBackOff

```text Terminal · kubectl -n facturacion get pods
NAME                  READY   STATUS             RESTARTS   AGE
api-b57977dbd-5w6bd   0/1     ImagePullBackOff   0          3m29s
api-b57977dbd-gz2dh   0/1     ImagePullBackOff   0          3m29s
db-0                  1/1     Running            0          3m29s
esquema-zhw8x         0/1     ImagePullBackOff   0          3m7s
```

`describe` dice por qué:

```text Terminal · kubectl -n facturacion describe pod -l job-name=esquema
Failed to pull image "facturacion:1.0": failed to resolve reference "docker.io/library/facturacion:1.0": pull access denied, repository does not exist or may require authorization
```

El nodo buscó la imagen en Docker Hub porque no la tenía: la carga con `kind load` había fallado por otra imagen del mismo comando. Cargada sola, el Job terminó:

```text Terminal
job.batch/esquema condition met
esquema listo
```

`ImagePullBackOff` es siempre una de tres: el nombre o el tag están mal, el registro pide credenciales y no se las diste (un Secret de tipo `docker-registry` en `imagePullSecrets`), o la imagen no existe donde el nodo la busca.

## Error 2: CreateContainerConfigError

```text Terminal
api-b57977dbd-5w6bd   0/1     CreateContainerConfigError   0          6m58s
```

```text Terminal · kubectl -n facturacion get events
Error: container has runAsNonRoot and image has non-numeric user (facturacion), cannot verify user is non-root
```

El `Dockerfile` tenía `USER facturacion`. Con `runAsNonRoot: true`, el kubelet tiene que comprobar que el usuario no es root antes de arrancar, y con un nombre no puede: el nombre se resuelve dentro de la imagen. Se cambió a `USER 10001` y se reconstruyó:

```text Terminal · kubectl -n facturacion get pods -o wide
NAME                   READY   STATUS      NODE
api-6bcb689949-gmx85   1/1     Running     curso-lab-worker
api-6bcb689949-slwjg   1/1     Running     curso-lab-worker2
db-0                   1/1     Running     curso-lab-worker2
esquema-zhw8x          0/1     Completed   curso-lab-worker
```

Dos réplicas en dos nodos distintos: el scheduler las repartió solo.

### Diagnosticar, en general

| Para | Comando |
|---|---|
| Estado | `kubectl get pods -o wide` |
| Por qué no arranca | `kubectl describe pod <pod>`: los **Events** del final |
| Lo que imprime la aplicación | `kubectl logs <pod>`, y `--previous` para el contenedor que murió |
| Entrar | `kubectl exec -it <pod> -- sh` |
| Todo lo que pasó en el namespace | `kubectl get events --sort-by=.lastTimestamp` |

## Tráfico de verdad

```bash Terminal
kubectl -n facturacion port-forward svc/api 18080:80
```

```text Terminal · curl -X POST localhost:18080/comprobantes ...
{"numero":"F001-1","fecha":"2026-10-19","estado":"pendiente","subtotal":"2000.00","igv":"360.00","total":"2360.00"}
```

`port-forward` es para probar desde tu máquina. Para tráfico público, un **Ingress** con un controlador como ingress-nginx o el balanceador del proveedor.

## Se recupera solo

```text Terminal
$ kubectl -n facturacion delete pod api-6bcb689949-gmx85
$ kubectl -n facturacion get pods -l app=api
NAME                   READY   STATUS    RESTARTS   AGE
api-6bcb689949-slwjg   1/1     Running   0          28s
api-6bcb689949-wptht   1/1     Running   0          8s
```

Ocho segundos después había otra. Nadie la pidió: el Deployment quería dos y vio una.

```bash Terminal
kubectl -n facturacion scale deployment/api --replicas=3
```

## Una actualización que sale mal

Una imagen que no existe, como cuando alguien se equivoca de tag:

```text Terminal
$ kubectl -n facturacion set image deployment/api api=facturacion:9.9
$ kubectl -n facturacion get pods -l app=api
NAME                   READY   STATUS         RESTARTS   AGE
api-6bcb689949-slwjg   1/1     Running        0          49s
api-6bcb689949-tltv9   1/1     Running        0          21s
api-6bcb689949-wptht   1/1     Running        0          29s
api-6bdcbf48c4-8hnw2   0/1     ErrImagePull   0          15s
```

Las tres réplicas viejas **siguen sirviendo**. Con `maxUnavailable: 0`, Kubernetes no saca ninguna hasta que la nueva esté lista, y la nueva nunca lo va a estar. El servicio no se cortó.

```text Terminal
$ kubectl -n facturacion rollout undo deployment/api
Warning: resource deployments/api was previously managed with 'kubectl apply'. Rolling back will not update the kubectl.kubernetes.io/last-applied-configuration annotation, which may cause unexpected behavior on future 'kubectl apply' operations.
deployment.apps/api rolled back
```

La advertencia importa: `rollout undo` arregla el clúster, pero el YAML en tu repositorio sigue diciendo lo que dice. El próximo `kubectl apply` del archivo puede volver a romper. **La versión que vale es la del repositorio**: corregí el archivo y aplicalo. Llevado al extremo, eso es GitOps: el clúster se sincroniza solo con lo que hay en git, con herramientas como Argo CD o Flux.

## Lo que falta para producción

- **Secretos de verdad.** Un Secret en un YAML del repositorio es texto en base64, no cifrado. Sealed Secrets, External Secrets con el gestor del proveedor, o SOPS.
- **La base fuera del clúster.** Un PostgreSQL en un StatefulSet funciona, pero sus backups, actualizaciones y recuperación son tuyos. Un servicio administrado, como en [la nube](/blog/linux/la-nube), suele ser más sensato.
- **Un CronJob para `enviar-pendientes`**, con `concurrencyPolicy: Forbid`, el equivalente a que el timer de systemd no se solape.
- **Monitoreo**: Prometheus y Grafana, o el del proveedor.

> **Quedate con esto**
> kind arma un clúster real en tu máquina; en producción, uno administrado. StatefulSet con `volumeClaimTemplates` para la base, Deployment con probes, recursos y `securityContext` para la API, y un Job para el esquema. `ImagePullBackOff` es nombre, credenciales o imagen ausente; con `runAsNonRoot`, el `USER` de la imagen tiene que ser numérico. `describe` y los eventos dicen casi siempre qué pasa. Con `maxUnavailable: 0`, una imagen rota no corta el servicio, y después de un `rollout undo` corregí el YAML del repositorio.
