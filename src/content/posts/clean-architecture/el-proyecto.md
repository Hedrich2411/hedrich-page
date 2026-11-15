---
title: "El proyecto: facturación electrónica"
description: Qué vamos a construir, las reglas de SUNAT que importan y cómo queda el árbol de carpetas.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, uv]
goal: Tener el proyecto creado y entender el dominio antes de escribir una línea.
course: clean-architecture-python
section: fundamentos
order: 2
---

El curso construye un solo sistema: el módulo de comprobantes de un negocio en Perú. Lo elegí porque tiene justo lo que justifica separar capas: reglas que impone alguien de afuera, plata, números que no se pueden repetir y un servicio externo que se cae.

## Lo que hace

1. **Emite** facturas y boletas: valida, numera, calcula el IGV y guarda como `pendiente`. Desde la API, desde una pantalla de caja o importando un CSV.
2. **Corrige** con notas de crédito sobre comprobantes ya aceptados.
3. **Envía** los pendientes a SUNAT a través de un PSE, el proveedor que firma y transmite, marca cada uno `aceptado` o `rechazado` y avisa a contabilidad de los rechazos.
4. **Consulta**: un comprobante por número, su versión impresa, un listado por fechas y la exportación para el contador.

Emitir y enviar están separados a propósito. El PSE puede tardar o no responder, y el cajero no puede quedarse esperando. Se emite al instante y un proceso aparte manda los pendientes cada pocos minutos.

## Las reglas, en castellano

Antes del código, el lenguaje. Esto es lo que el dominio tiene que hacer cumplir:

| Regla | Detalle |
|---|---|
| Tipo de comprobante | Factura `01`, boleta `03` (catálogo 01 de SUNAT) |
| Serie | 4 caracteres; empieza con `F` las facturas y con `B` las boletas |
| Correlativo | Por serie, de 1 a 99.999.999, sin saltos ni repetidos |
| Documento del cliente | DNI (tipo `1`, 8 dígitos) o RUC (tipo `6`, 11 dígitos con verificador) |
| Factura | Solo a clientes con RUC |
| Nota de crédito | Tipo `07`, sobre un comprobante aceptado, sin superar su total |
| Boleta | Sin documento hasta S/ 700; por encima hay que identificar al cliente |
| IGV | 18 % sobre el valor de venta, redondeado al céntimo |

Una simplificación consciente: nada de exonerados, inafectos, detracciones ni moneda extranjera. Agregarlos es sumar reglas al dominio, no arquitectura.

### Por qué los nombres en castellano

En los cursos de Odoo los identificadores van en inglés porque el framework está en inglés. Acá el código **es** el negocio: `Comprobante`, `serie`, `correlativo`, `igv`. Traducirlos a `Invoice`, `series`, `sequence` y `vat` obliga a todos, desde el contador hasta quien mantenga esto en dos años, a traducir de vuelta cada vez que hablan. El código usa las palabras de la gente que conoce el negocio.

## El árbol

```text facturacion/ · La estructura completa
facturacion/
├── pyproject.toml
├── src/facturacion/
│   ├── dominio/
│   │   ├── errores.py        # ErrorDeDominio
│   │   ├── valores.py        # Documento, NumeroComprobante, montos
│   │   ├── comprobante.py    # Comprobante, Item, Cliente
│   │   ├── credito.py        # cuánto se puede acreditar con notas
│   │   └── eventos.py        # lo que le pasa a un comprobante
│   ├── aplicacion/
│   │   ├── puertos.py        # lo que los casos de uso necesitan de afuera
│   │   ├── emitir.py
│   │   ├── notas.py
│   │   ├── enviar.py
│   │   ├── importar.py
│   │   ├── eventos.py        # el bus que reparte eventos
│   │   └── avisos.py         # reacciones a esos eventos
│   ├── adaptadores/
│   │   ├── tablas.py         # modelos de SQLAlchemy
│   │   ├── sql.py            # repositorios y unidad de trabajo
│   │   ├── consultas.py      # lecturas para listados
│   │   ├── pse.py            # cliente HTTP del PSE
│   │   ├── correo.py         # SMTP
│   │   ├── api.py            # FastAPI: JSON
│   │   ├── paginas.py        # FastAPI: HTML para la caja
│   │   ├── impresion.py      # el comprobante impreso
│   │   ├── exportar.py       # CSV y TXT para el contador
│   │   ├── ventas_csv.py     # lectura de ventas a importar
│   │   ├── observabilidad.py # logs en JSON
│   │   └── plantillas/
│   ├── arranque.py           # lee el entorno y crea lo de afuera
│   ├── web.py                # entrada: uvicorn
│   └── cli.py                # entrada: tareas programadas
└── tests/
```

**Las carpetas son las capas, no tipos de archivo.** No hay `models/`, `services/` ni `utils/`. Abrís `dominio/` y está el negocio entero.

**Hay dos entradas**, `web.py` y `cli.py`. Las dos son finas: leen la configuración y llaman a un caso de uso.

**`dominio/` y `aplicacion/` no importan dependencias de terceros.** No queda como buena intención: [un linter](/blog/clean-architecture/proteger-la-arquitectura) lo verifica en cada commit.

No hace falta memorizar el árbol. Cada archivo aparece en la lección que lo necesita.

## Crear el proyecto

Con [uv](/blog/uv-python):

```bash Terminal
uv init --package facturacion
cd facturacion
uv add "fastapi[standard]" sqlalchemy "psycopg[binary]" httpx tzdata
uv add --dev pytest mypy import-linter
```

`psycopg` es el driver con el que SQLAlchemy habla con PostgreSQL; la URL de conexión empieza con `postgresql+psycopg://`. `tzdata` está porque el dominio necesita la fecha de hoy en Lima, y en Windows o en una imagen Docker mínima Python no trae la base de zonas horarias. Lo vemos en [casos de uso](/blog/clean-architecture/casos-de-uso).

El comando de consola, apuntando a su módulo, y la configuración de las herramientas:

```toml pyproject.toml
[project.scripts]
facturacion = "facturacion.cli:main"

[tool.pytest.ini_options]
pythonpath = ["tests"]

[tool.mypy]
strict = true
```

`mypy --strict` no es opcional en este curso. Los puertos son `Protocol`, y es mypy el que avisa cuando un adaptador no cumple el contrato.

> **Quedate con esto**
> Separar capas paga en un dominio con reglas externas, plata, numeración y un servicio que falla. Las carpetas son capas, no tipos de archivo. El código usa el idioma del negocio. Y `dominio/` más `aplicacion/` solo usan la biblioteca estándar.
