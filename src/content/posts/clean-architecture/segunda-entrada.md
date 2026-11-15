---
title: "Un CLI que reusa los mismos casos de uso"
description: El arranque que arma todo, una segunda entrada para las tareas programadas y qué cambia si corrés más de un worker.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Armar las dependencias en un solo lugar y agregar una entrada nueva sin tocar el negocio.
course: clean-architecture-python
section: adaptadores
order: 6
---

Alguien tiene que leer `DATABASE_URL`, crear el engine, armar el cliente HTTP con el token, conectar el correo y pasárselos a quien los necesita. Ese alguien es lo más externo del sistema, y el único lugar donde todo se conoce. Se suele llamar *composition root*.

## El arranque

```python arranque.py
def sesiones() -> sessionmaker[Session]:
    return sessionmaker(create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True))


def pse() -> PseHttp:
    return PseHttp(
        httpx.Client(
            base_url=os.environ["PSE_URL"],
            headers={"Authorization": f"Bearer {os.environ['PSE_TOKEN']}"},
            timeout=10,
        )
    )


def bus() -> Bus:
    correo = CorreoSmtp(
        host=os.environ["SMTP_HOST"],
        puerto=int(os.environ.get("SMTP_PUERTO", "465")),
        usuario=os.environ["SMTP_USUARIO"],
        clave=os.environ["SMTP_CLAVE"],
    )
    bus = Bus()
    bus.suscribir(ComprobanteRechazado, AvisarRechazo(correo, os.environ["AVISOS_A"]))
    return bus
```

Tres funciones. Lo de afuera se crea acá y en ningún otro lado, y quién reacciona a qué evento también se decide acá.

**`os.environ["X"]` y no `os.getenv("X")`.** Si falta una variable, mejor un `KeyError` al arrancar que un `None` que explota en el primer request. El puerto SMTP es la única con default, porque casi siempre es 465.

**`pool_pre_ping`** descarta las conexiones que PostgreSQL cerró mientras el proceso estaba quieto, algo típico en un cron que corre cada cinco minutos.

**`timeout` explícito.** El default de httpx son 5 segundos. Ajustalo a lo que tarda tu PSE de verdad con un comprobante grande.

## La entrada web

```python web.py
configurar_logs()
fabrica = arranque.sesiones()
app = crear_app(lambda: UnidadSql(fabrica), ConsultasSql(fabrica))
```

```bash Terminal
uv run uvicorn facturacion.web:app
```

## La entrada de consola

Enviar los pendientes no lo dispara un usuario sino un cron, cada pocos minutos. Importar las ventas del día tampoco. Son otra entrada al mismo sistema.

```python cli.py
def main() -> None:
    parser = argparse.ArgumentParser(prog="facturacion")
    comandos = parser.add_subparsers(dest="comando", required=True)
    enviar = comandos.add_parser("enviar-pendientes", help="Manda a SUNAT lo que quedó pendiente")
    enviar.add_argument("--limite", type=int, default=50)
    importar = comandos.add_parser("importar", help="Emite un comprobante por cada fila de un CSV")
    importar.add_argument("archivo", type=Path)
    args = parser.parse_args()

    configurar_logs()
    id_operacion.set(f"{args.comando}-{uuid4().hex[:8]}")
    if args.comando == "enviar-pendientes":
        caso = EnviarPendientes(UnidadSql(arranque.sesiones()), arranque.pse(), arranque.bus().publicar)
        log.info("%d comprobantes enviados", caso.ejecutar(args.limite))
    else:
        sys.exit(_importar(args.archivo))
```

`_importar` está en [entradas, salidas y errores](/blog/clean-architecture/entradas-salidas-y-errores). `configurar_logs` e `id_operacion` son de [observabilidad](/blog/clean-architecture/observabilidad); por ahora pensalos como un `logging.basicConfig` que escribe JSON.

Con el `[project.scripts]` del `pyproject.toml` queda instalado como comando. Así se ve con el PSE caído:

```text Terminal · El PSE no responde
$ uv run facturacion enviar-pendientes
{"momento": "2026-10-19T03:36:53-0500", "nivel": "WARNING", "origen": "facturacion.aplicacion.enviar", "operacion": "enviar-pendientes-4a7be9d9", "mensaje": "PSE no disponible, se reintenta en la próxima corrida", "error": "ConnectError: [WinError 10061] No connection could be made because the target machine actively refused it"}
{"momento": "2026-10-19T03:36:53-0500", "nivel": "INFO", "origen": "facturacion.cli", "operacion": "enviar-pendientes-4a7be9d9", "mensaje": "0 comprobantes enviados"}
```

Y en el servidor, cada cinco minutos:

```bash crontab
*/5 * * * * cd /srv/facturacion && uv run --env-file .env facturacion enviar-pendientes >> /var/log/facturacion.log 2>&1
```

`--env-file` porque cron no carga las variables de tu sesión.

Para agregar esta entrada no cambió nada del dominio, de la aplicación ni de los adaptadores. Es un archivo nuevo de cuarenta líneas.

## Dónde se configura el logging

`enviar.py` hace `logging.getLogger(__name__)` y nada más. La configuración se hace en `cli.py` y en `web.py`, las entradas. El código de adentro emite logs; la entrada decide a dónde van y con qué formato.

Si un módulo interno configurara el logging, ganaría el primero que se importe y las entradas no podrían cambiarlo.

## Más de un worker

Con un solo cron, `pendientes()` es seguro. Con dos procesos a la vez, sea porque hay dos servidores o porque una corrida se solapa con la anterior, los dos leen los mismos 50 pendientes y los mandan dos veces.

Antes de resolverlo, preguntate si lo necesitás. Cincuenta comprobantes cada cinco minutos son 14.400 por día; para la mayoría de los negocios un worker sobra. Evitar el solapamiento es un `flock`:

```bash crontab
*/5 * * * * cd /srv/facturacion && flock -n /tmp/facturacion.lock uv run --env-file .env facturacion enviar-pendientes
```

`flock -n` no arranca si la corrida anterior todavía no terminó.

Si de verdad necesitás varios en paralelo, PostgreSQL lo resuelve en el adaptador sin tocar el caso de uso: `pendientes()` reserva las filas con `SELECT ... FOR UPDATE SKIP LOCKED`, y cada worker toma las que nadie tiene bloqueadas. El costo es mantener la transacción abierta durante el envío o sumar un estado `enviando` al dominio. Por eso no es el default.

> **Quedate con esto**
> El arranque es el único lugar que conoce el entorno, crea lo de afuera y conecta los eventos con sus reacciones; si falta una variable, falla al iniciar. Una entrada nueva es un archivo fino que arma dependencias y llama a casos de uso. El logging se configura en la entrada, nunca en un módulo. Y antes de paralelizar workers, un `flock` resuelve el solapamiento.
