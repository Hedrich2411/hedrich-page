---
title: "Migrar de versión mayor"
description: Qué implica saltar de una versión de Odoo a la siguiente, con módulos propios encima.
date: 2026-10-11
topic: ERP
tags: [odoo, produccion, migracion]
goal: Entender el tamaño real del trabajo antes de prometer una fecha.
course: odoo-produccion
section: actualizacion
order: 2
---

Subir de Odoo 18 a Odoo 19 no es la lección anterior con un número más grande. Es un proyecto, y el error que más caro sale es tratarlo como un despliegue.

Esta lección es sobre **estimar bien**, que es el noventa por ciento del problema.

## Por qué no es un `-u`

`-u` actualiza un módulo dentro de la misma versión de Odoo. Un salto de versión mayor cambia tres cosas a la vez:

**El esquema del core.** Campos que se renombraron, modelos que se fusionaron, tablas que cambiaron de forma. Tus datos viven ahí.

**Las APIs que usás.** Lo vimos a lo largo de los dos cursos anteriores: `_sql_constraints` pasó a `models.Constraint`, `<tree>` a `<list>`, `attrs` desapareció, `groups_id` es `group_ids`, `type="json"` es `type="jsonrpc"`.

**Los módulos de terceros.** Que migran cuando migran, o nunca.

El código de Odoo que convierte el esquema viejo al nuevo **no está en el repositorio que te bajás**. Es el servicio de actualización de Odoo, al que le mandás un dump y te devuelve la base convertida.

```text
upgrade.odoo.com  →  le subís el dump, te devuelve la base en la versión nueva
```

Acá entra el `manifest.json` de la lección de backups: es lo primero que mira ese proceso, porque le dice de qué versión y con qué módulos salió el dump.

Lo que ese servicio **no** hace es migrar tus módulos. Eso es tu trabajo, y es donde está el tiempo.

### La alternativa de la comunidad

**OpenUpgrade**, de la OCA, es el equivalente libre: scripts de migración para el core, mantenidos por la comunidad, versión por versión. Se enchufa con una opción del servidor:

```bash Terminal
odoo-bin --upgrade-path /opt/openupgrade/scripts -d taller -u all --stop-after-init
```

Es un camino real y mucha gente lo usa. Dos cosas a tener claras: la cobertura depende de cuánto avanzó la comunidad en esa versión —que para una versión recién salida puede ser poca—, y vas a leer scripts de migración ajenos. Mirá el estado del repositorio para tu salto antes de comprometerte con esta vía.

Y hay una opción más, para scripts tuyos que tienen que correr antes que cualquier módulo:

```bash Terminal
odoo-bin --pre-upgrade-scripts /opt/taller/migracion/limpiar.py -d taller -u all
```

## La herramienta que sí te ahorra trabajo

Odoo 19 trae un comando que reescribe tu código fuente:

```bash Terminal
odoo-bin upgrade_code --help
```

```text
options:
  --script NAME    run this single script
  --from VERSION   run all scripts starting from this version, inclusive
  --to VERSION     run all scripts until this version, inclusive (default: 19.0)
  --glob GLOB      select the files to rewrite (default: **/*)
  --dry-run        list the files that would be re-written, but rewrite none
```

Los scripts que trae:

```text
17.5-01-tree-to-list.py              <tree> → <list>
18.1-00-sql-constraint.py            _sql_constraints → models.Constraint
18.1-02-route-jsonrpc.py             type="json" → type="jsonrpc"
18.5-00-deprecated-properties.py
18.5-00-domain-dynamic-dates.py
18.2-00-l10n-translate.py
18.3-00-l10n-fiscal-position-taxes.py
18.5-00-no-tax-tag-invert.py
```

Reconocerás varios: son exactamente los cambios que fuimos encontrando en el curso de backend.

El de las restricciones, por ejemplo, hace esta transformación:

```python antes
_sql_constraints = [
    ("code_uniq", "unique(code)", "El código de la orden debe ser único."),
]
```

```python después
_code_uniq = models.Constraint(
    'unique(code)',
    "El código de la orden debe ser único.",
)
```

El uso es siempre el mismo, y **siempre con `--dry-run` la primera vez**:

```bash Terminal
odoo-bin upgrade_code --from 18.0 --dry-run --addons-path /opt/taller/addons
```

Te lista los archivos que tocaría. Después, sin `--dry-run`, los reescribe en el disco — así que corrés esto con el repositorio limpio y lo revisás con `git diff`, no con fe.

### Lo que no hace

La documentación del propio comando lo dice sin vueltas:

> *all the scripts are doing a best-effort at migrating the source code, they only help do the heavy-lifting, they are not silver bullets.*

Lo medí: corrí el de `tree-to-list` en dry-run sobre **todo el código de Odoo 19**, que ya está migrado. Debería dar cero. Dio tres archivos:

```text
addons/hr_timesheet/static/tests/hr_timesheet_models.js
addons/mail/static/src/views/fields/activity_model_selector/activity_model_selector.js
addons/stock/tests/test_proc_rule.py
```

Los tres son falsos positivos: la palabra `tree` aparece en otro contexto. Eso es lo que significa «best-effort»: **el script hace el 90% del trabajo mecánico y vos revisás el 100% del diff**.

## Lo que siempre se rompe en tus módulos

Por orden de frecuencia, en un salto de versión mayor:

**Las vistas.** Son lo más frágil. Un `xpath` que apuntaba a un elemento que ya no está hace que la vista entera no cargue, y el módulo no instala. Los `xpath` sobre vistas del core son la primera causa.

**Los campos del core que usabas.** Un `related="partner_id.x"` donde `x` se renombró. Esto no falla al instalar: falla cuando alguien abre el formulario.

**El JavaScript.** Es lo peor de todo, y el curso de web framework explica por qué: OWL cambia entre versiones, los servicios se mueven de módulo, las plantillas del core se reescriben. Un `useService` importado de la ruta vieja, un `patch` sobre un componente que ya no existe, un `xpath` sobre una plantilla que el core vació. Nada de eso lo arregla ningún script.

**Los informes QWeb.** Si heredaste una plantilla del core, revisá si sigue existiendo con ese nombre.

**Los módulos de terceros.** No dependen de vos. Si uno no migró, tus opciones son esperar, migrarlo vos, o sacarlo — y las tres se deciden *antes* de empezar, no a mitad de camino.

## El ensayo general

El único método que funciona, y conviene hacerlo **dos veces**.

**La primera, para descubrir.** Dump de producción, pasarlo por el proceso de migración, instalar tus módulos encima, anotar todo lo que explota. El resultado no es una base migrada: es **la lista de trabajo**, y recién después de tenerla podés estimar.

**La segunda, para cronometrar.** Con todo arreglado, de principio a fin, midiendo cada paso.

```bash Terminal · el ensayo, en orden
odoo-bin db dump taller taller-$(date +%F).zip      # 1. el dump
# 2. el proceso de migración del core
odoo-bin db load --force taller_v19 taller-migrada.zip
odoo-bin -d taller_v19 -u all --stop-after-init     # 3. tus módulos encima
```

Lo que se anota del segundo ensayo:

| | |
|---|---|
| Cuánto tarda cada paso | para la ventana de mantenimiento |
| Cuánto pesa cada archivo | para el disco y la red |
| Qué warnings aparecen | los que se ignoran y los que no |
| Qué hay que hacer a mano | los pasos que no se automatizaron |

Y después de eso, **que lo use alguien que trabaja ahí todos los días**. Un desarrollador abre el módulo y ve que carga. Una persona del taller abre su pantalla y nota en diez segundos que falta una columna que usa siempre. Ese paso encuentra cosas que ninguna prueba automática encuentra.

## Estimar

La trampa está en que la parte visible es la chica.

| Fase | Peso |
|---|---|
| Migrar el core (el servicio o OpenUpgrade) | chico |
| Que tus módulos instalen | mediano |
| Que tus módulos **funcionen** | grande |
| El JavaScript | el más grande, y el más impredecible |
| Pruebas con usuarios reales | mediano |
| La ventana y el plan de vuelta atrás | chico |

Una regla que funciona bastante bien: **el tiempo de hacer que instale es un tercio del tiempo de hacer que funcione**. Si en tres días lograste instalar todo, no prometas la semana.

Y la variable que más mueve la estimación no es el tamaño de tus módulos: es **cuánto JavaScript tienen** y **cuántos módulos de terceros hay**.

## Antes de arrancar

Cuatro preguntas que se contestan al principio, cuando cambiar de idea todavía es barato:

**¿Qué versión de Python pide?** Odoo 19 declara `MIN_PY_VERSION = (3, 10)` en `odoo/release.py`. Si el servidor tiene una más vieja, el salto empieza por el sistema operativo.

**¿Qué versión de PostgreSQL?** Migrar Odoo y PostgreSQL a la vez es duplicar las variables. Hacé uno, estabilizá, hacé el otro.

**¿Todos los módulos de terceros tienen versión?** Esta es la que hunde proyectos. Un módulo sin migrar del que depende una operación diaria es un bloqueo, y es mejor saberlo en la semana uno.

**¿Hay que migrar?** Pregunta honesta. Si la versión actual está soportada y funciona, el salto puede esperar a que haya una razón: una funcionalidad que necesitás, el fin del soporte, un módulo que lo pide. Migrar porque salió una versión nueva es la peor de las razones.

## El día

El orden, sin sorpresas:

1. Avisar con tiempo, con una ventana concreta.
2. Parar Odoo. Nadie entra.
3. Backup completo. **Verificado**, con la prueba de la lección de restore.
4. Correr el procedimiento del segundo ensayo, paso por paso, sin improvisar.
5. Revisar: entrar, abrir las pantallas clave, imprimir un PDF, crear un registro.
6. Abrir a los usuarios.
7. Quedarse mirando el log las primeras horas.

**El plan de vuelta atrás es restaurar el backup.** Punto. No hay forma de desmigrar una base, y cualquier plan que suponga lo contrario es una ilusión. Lo único que se decide de antemano es *hasta qué hora* podés volver atrás, y eso se lo decís a quien decide antes de empezar.

> **Quedate con esto**
> El core lo migra el servicio de Odoo o los scripts de OpenUpgrade vía `--upgrade-path`; **tus módulos son tu trabajo, y ahí está el tiempo**. `odoo-bin upgrade_code` automatiza los cambios mecánicos —`<tree>`, `_sql_constraints`, `type="json"`— pero es best-effort: en el propio código de Odoo 19, ya migrado, el dry-run todavía marca tres falsos positivos. Dos ensayos completos: uno para descubrir la lista de trabajo y otro para cronometrarla. Y el plan de vuelta atrás es el backup, porque una base no se desmigra.
