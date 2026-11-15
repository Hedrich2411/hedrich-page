---
title: "Anatomía de un módulo de Odoo"
description: El manifest, las carpetas y qué va en cada una. Leer la estructura antes de escribirla ahorra la mitad de los errores.
date: 2026-10-10
topic: ERP
tags: [odoo, python]
goal: Saber para qué sirve cada archivo y cada carpeta antes de escribir ninguno.
course: odoo-backend-framework
section: entorno
order: 4
---

En Odoo todo es un módulo. Las ventas son un módulo. La contabilidad es un módulo. Lo que vos escribas va a ser un módulo, y va a convivir con los de Odoo como un igual: mismos mecanismos, mismas reglas, misma capacidad de modificar a los demás.

Eso explica por qué la estructura importa tanto. No es una convención estética: es el contrato que te permite extender código que no escribiste.

## Qué es un módulo, técnicamente

**Un directorio con dos archivos obligatorios.** Nada más.

```text El módulo más chico que existe
service_workshop/
├── __init__.py          ← lo hace importable por Python
└── __manifest__.py      ← lo hace visible para Odoo
```

Si falta `__init__.py`, Python no puede importarlo y Odoo no lo carga. Si falta `__manifest__.py`, Odoo ni siquiera lo reconoce como módulo: lo ve como una carpeta cualquiera en el `addons_path`.

El **nombre del directorio es el nombre técnico** del módulo, y tiene que ser un identificador válido de Python: empieza con letra, solo letras, números y guiones bajos. Por convención, todo en minúsculas. Ese nombre lo vas a escribir en `depends` de otros módulos, en los identificadores externos y en la línea de comandos, así que elegilo pensando en que no lo vas a poder cambiar después sin romper cosas.

## El manifest, clave por clave

```python service_workshop/__manifest__.py
{
    "name": "Taller de servicio técnico",
    "summary": "Órdenes de reparación, diagnóstico y entrega",
    "version": "19.0.1.0.0",
    "category": "Services",
    "author": "Hedrich Apaza",
    "website": "https://hedrich.dev",
    "license": "LGPL-3",
    "depends": ["base", "mail"],
    "data": [
        "security/groups.xml",
        "security/ir.model.access.csv",
        "views/service_order_views.xml",
        "views/menus.xml",
    ],
    "demo": ["demo/service_order_demo.xml"],
    "application": True,
    "installable": True,
}
```

Es un diccionario de Python y nada más. Pero hay tres claves que deciden casi todo.

### `depends` — la más importante

Es la lista de módulos de los que dependés. Y hace dos cosas que conviene tener claras:

**Garantiza el orden de carga.** Odoo instala primero tus dependencias y después tu módulo. Eso significa que cuando tu código corra, todo lo de esos módulos ya existe.

**Te da acceso a sus modelos y a sus identificadores externos.** Si vas a heredar `res.partner`, necesitás `base`. Si vas a usar el chatter, necesitás `mail`. Si referenciás un identificador externo de otro módulo en un XML y no lo declaraste en `depends`, vas a recibir un error de carga que no menciona en ningún momento la palabra «depends», y vas a perder un buen rato.

La regla práctica: **si lo nombrás, lo declarás.** Un modelo que heredás, una vista que extendés, un grupo de seguridad que referenciás, un identificador externo que usás en un `ref`. Todo eso va en `depends`.

Como mínimo, siempre `base`.

### `data` — y el orden importa

La lista de archivos que Odoo carga al instalar o actualizar el módulo. **Se cargan en el orden en que están escritos**, y eso no es un detalle: si una vista referencia un grupo de seguridad, el archivo del grupo tiene que estar antes.

Por eso el orden del ejemplo no es casual, y conviene adoptarlo como costumbre:

1. **Seguridad primero** — grupos, y después los permisos de acceso.
2. **Datos de configuración** — secuencias, etapas, categorías.
3. **Vistas**.
4. **Menús al final** — porque apuntan a acciones que tienen que existir antes.

Cuando veas un error de carga que dice que no encuentra un identificador externo, lo primero que hay que mirar es si el archivo que lo define está más arriba en esta lista.

### `license` — la que nadie mira hasta que importa

El valor por defecto es `LGPL-3`, y los que vas a ver son estos:

- **LGPL-3** — podés distribuir el módulo con código cerrado que lo use. Es el default de Odoo Community.
- **AGPL-3** — contagiosa incluso sobre la red: si alguien usa tu módulo en un servidor, tiene derecho al fuente de lo que lo extiende.
- **OPL-1** (Odoo Proprietary License) — la de los módulos pagos del App Store.

Es una decisión que se toma al crear el módulo y se paga cara años después, cuando ya hay veinte módulos encima y alguien pregunta si se puede vender. Elegila a conciencia la primera vez.

### Las demás

- **`version`** — usá el formato `19.0.1.0.0`. Si no empieza con la versión de Odoo, Odoo se la agrega sola, pero escribirla hace obvio para qué versión es el módulo. Y eso importa: **un módulo de una versión mayor no funciona en la siguiente sin trabajo de migración**.
- **`application: True`** — hace que el módulo aparezca como aplicación en el menú de Aplicaciones, con su ícono. Reservalo para el módulo central de un área funcional; los satélites van sin esto.
- **`auto_install: True`** — módulos puente. Se instalan solos cuando todas sus dependencias están instaladas. Sirve para el módulo que conecta dos aplicaciones: si tenés las dos, el puente aparece sin que nadie lo pida.
- **`external_dependencies`** — si tu módulo necesita un paquete de Python o un binario del sistema, declaralo acá. Odoo va a impedir la instalación si falta, en vez de romperse a mitad de camino con un `ImportError`.
- **`installable: False`** — la forma de desactivar un módulo sin borrarlo.

### El ícono

```text Dónde va el ícono
static/description/icon.png
```

Esa ruta exacta. Un PNG ahí y tu módulo deja de verse como un placeholder en la lista de aplicaciones.

## La estructura de carpetas

Odoo no te obliga a usar esta estructura: podrías poner todo en un archivo. Pero es la que usan los módulos estándar, la que espera la OCA y la que va a esperar cualquiera que abra tu código.

```text service_workshop/ · La estructura completa
service_workshop/
├── __init__.py
├── __manifest__.py
├── models/              código Python de los modelos
│   ├── __init__.py
│   └── service_order.py
├── views/               vistas y menús, en XML
├── security/            grupos e ir.model.access.csv
├── data/                datos que se cargan siempre
├── demo/                datos de demostración
├── wizards/             modelos transitorios y sus vistas
├── reports/             plantillas QWeb de los PDF
├── controllers/         rutas HTTP
├── i18n/                archivos .po de traducción
└── static/
    ├── description/     icon.png y la descripción del App Store
    └── src/             js, scss, xml del lado del cliente
```

Creá solo las que vayas a usar. Una carpeta vacía no aporta nada.

## Los `__init__.py` encadenados

Este es el punto donde más gente se traba al principio, y es simple cuando lo ves: **Odoo importa tu módulo como un paquete de Python normal**. Si un archivo no se importa, su código nunca corre, y tu modelo no existe.

La cadena tiene dos eslabones:

```python service_workshop/__init__.py
from . import models
from . import controllers
from . import wizards
```

```python service_workshop/models/__init__.py
from . import service_order
```

Si agregás `models/service_equipment.py` y te olvidás de sumarlo al `__init__.py` de `models`, el archivo queda ahí, prolijo y completamente inerte. Odoo no se queja: simplemente tu modelo no aparece por ningún lado.

**Es el primer lugar donde mirar cuando «agregué el modelo y no pasa nada».**

Fijate también que el `__init__.py` de arriba no importa `views` ni `security`: esas carpetas tienen XML y CSV, no Python. Odoo las carga por la lista `data` del manifest, no por los imports.

## Dos formas de leer esto

Lo que acabás de ver tiene un uso inmediato y uno que vas a agradecer más: **así están armados todos los módulos de Odoo**. Cuando no sepas cómo se hace algo, vas a abrir el módulo estándar que ya lo hace, y vas a saber exactamente dónde mirar: el manifest para entender de qué depende, `models/` para la lógica, `views/` para la interfaz, `security/` para los permisos.

> **Quedate con esto**
> El manifest declara tres cosas que deciden todo: de qué dependés, qué archivos se cargan y en qué orden, y bajo qué licencia. Y la cadena de `__init__.py` es la razón número uno por la que un modelo recién escrito «no aparece» — antes de debuggear nada, revisá que el archivo esté importado.
