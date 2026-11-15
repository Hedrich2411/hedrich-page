---
title: "Record rules, acceso por campo y el peligro de sudo()"
description: Filtrar registros por usuario, esconder campos por grupo, y la función que se lleva puesta toda la seguridad si la usás mal.
date: 2026-10-10
topic: ERP
tags: [odoo, security, python]
goal: El técnico ve solo sus órdenes y el costo lo ve nada más que el jefe.
course: odoo-backend-framework
section: seguridad
order: 3
---

Los permisos de la lección anterior son por modelo: «el técnico puede leer órdenes». Pero no todas las órdenes deberían ser suyas.

Las **reglas de registro** son la capa que filtra **cuáles**.

## Una regla es un dominio que se aplica siempre

```xml security/service_security.xml
<record id="rule_service_order_technician" model="ir.rule">
    <field name="name">Técnico: solo sus órdenes</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="domain_force">[('user_id', '=', user.id)]</field>
    <field name="groups" eval="[(4, ref('group_service_technician'))]"/>
    <field name="perm_read" eval="True"/>
    <field name="perm_write" eval="True"/>
    <field name="perm_create" eval="True"/>
    <field name="perm_unlink" eval="True"/>
</record>

<record id="rule_service_order_manager" model="ir.rule">
    <field name="name">Jefe de taller: todas las órdenes</field>
    <field name="model_id" ref="model_service_order"/>
    <field name="domain_force">[(1, '=', 1)]</field>
    <field name="groups" eval="[(4, ref('group_service_manager'))]"/>
</record>
```

El `domain_force` es **un dominio normal**, de los de la lección de dominios, que Odoo le agrega a toda búsqueda que haga un usuario de ese grupo. Incluso a las que hace internamente.

`[(1, '=', 1)]` es el dominio «todo»: una condición siempre verdadera. Es la forma idiomática de escribir «sin restricción».

### Variables disponibles

```python
user          # el usuario actual, como recordset
user.id
user.company_id
time          # el módulo time de Python
```

Con `user` siendo un recordset podés navegar: `user.partner_id.id`, `user.company_id.id`, lo que necesites.

## La regla que sorprende a todos

**Varias reglas sobre el mismo modelo se combinan con OR entre grupos, y con AND dentro del mismo grupo.**

Dicho de otra forma: si un usuario pertenece a dos grupos y cada uno tiene su regla, **ve la unión de los dos dominios**.

Esto es lo que hace funcionar nuestro caso. El jefe pertenece a «Jefe de taller» y —por `implied_ids`— también a «Técnico». Entonces:

- Por la regla del técnico vería solo las suyas.
- Por la regla del jefe ve todas.
- Como se combinan con **OR**, ve todas.

Si fuera AND, el jefe vería solo las suyas y la jerarquía no serviría de nada.

**Las reglas globales son la excepción.** Una regla sin `groups` aplica a todos **y se combina con AND** contra las demás. Son las que no se pueden esquivar, y por eso Odoo las usa para la separación entre compañías. Si escribís una, pensala bien: restringe a todo el mundo, siempre.

## Las reglas también filtran las escrituras

Las cuatro columnas `perm_*` dicen a qué operaciones se aplica la regla.

El caso que conviene entender: con `perm_write` activo, un técnico **no puede modificar** una orden que no sea suya, aunque de alguna forma llegue a su id. El ORM se lo impide.

Y una consecuencia menos obvia: **con `perm_create` activo, un técnico no puede crear una orden asignada a otro**, porque el registro resultante no cumpliría el dominio. Es coherente, pero sorprende la primera vez.

## Acceso a nivel de campo

Una capa más fina: que el campo exista solo para algunos.

```python models/service_order.py
cost_total = fields.Monetary(
    string="Costo interno",
    compute="_compute_cost_total",
    groups="service_workshop.group_service_manager",
)
```

Esto es **seguridad real**. Para un usuario que no está en ese grupo, el campo:

- no se envía al cliente web,
- no se puede leer por RPC,
- no aparece aunque lo pongan en una vista,
- y no se puede usar en un dominio.

Es distinto de `groups` en la vista, que solo esconde. Si el dato es sensible, va en el modelo.

## `sudo()`: la salida de emergencia

```python
self.env["service.order"].sudo().search([])
```

`sudo()` **desactiva todas las comprobaciones de acceso**: permisos de modelo, reglas de registro y campos restringidos. Lo que sigue corre como superusuario.

Existe porque a veces hace falta. El caso legítimo típico es este:

```python models/res_partner.py
def _compute_service_order_count(self):
    for partner in self:
        partner.service_order_count = self.env["service.order"].sudo().search_count(
            [("partner_id", "=", partner.id)]
        )
```

Un vendedor que abre la ficha de un cliente debería ver **cuántas** órdenes tiene, aunque no tenga permiso para leerlas. El contador es información agregada; los detalles no se exponen.

### Las tres reglas para usarlo

**Lo más chico posible.** `sudo()` sobre una consulta puntual, nunca sobre un método entero. Cada línea que corre con privilegios es una línea que hay que auditar.

**Nunca con datos que vienen del usuario.** Esto es lo importante:

```python Peligroso · el usuario elige qué leer
def ver_orden(self, order_id):
    return self.env["service.order"].sudo().browse(order_id).read()
```

Si `order_id` llega de una petición web, cualquiera puede pedir cualquier orden del sistema. `sudo()` acaba de convertir tu endpoint en una fuga de datos. En la sección de integración volvemos sobre esto, porque es **el** error de seguridad de los controladores de Odoo.

**Comentá por qué.** Un `sudo()` sin explicación es una bomba de tiempo: el que lo lea en dos años no va a saber si era necesario o si alguien lo puso para que dejara de fallar.

```python
# sudo: el contador es información agregada; el vendedor ve cuántas
# órdenes tiene el cliente sin poder abrir ninguna.
```

### Las alternativas, que casi siempre son mejores

```python
self.with_user(otro_usuario)   # correr como un usuario concreto, con SUS permisos
self.with_company(compania)    # cambiar la compañía activa
```

`with_user` es mucho más fino que `sudo()`: seguís teniendo control de acceso, solo que el de otro usuario.

Y para el caso de la seguridad de campos, `fields.Field(groups=...)` ya resuelve lo que mucha gente intenta resolver con `sudo()`.

## Probarlo de verdad

La única forma de verificar que todo esto funciona es **entrar con un usuario que no sea administrador**:

1. Ajustes → Usuarios → Nuevo.
2. Dale solo el grupo «Técnico».
3. Entrá con él, en una ventana de incógnito.

Vas a ver únicamente las órdenes asignadas a ese usuario, sin el campo de costo, sin el menú de configuración.

Probarlo con el administrador no sirve: tiene todos los grupos y, según cómo esté configurado, puede saltearse las reglas.

## Con esto cierra la sección

El módulo ya tiene dos perfiles reales, permisos por modelo, filtrado por usuario y un campo sensible restringido.

Lo que sigue es automatizar: datos de configuración, asistentes, PDFs, correos y reglas que actúan solas.

> **Quedate con esto**
> Las reglas de distintos grupos se combinan con **OR** — por eso el jefe, que también es técnico, ve todas las órdenes. Una regla sin grupos es global y se combina con AND contra todo. Y `sudo()` apaga toda la seguridad: usalo en la consulta más chica posible, nunca sobre un id que venga del usuario, y dejá escrito por qué.
