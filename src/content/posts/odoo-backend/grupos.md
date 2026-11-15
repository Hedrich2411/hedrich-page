---
title: "Grupos y categorías: Técnico y Jefe de taller"
description: Los grupos son la base de todo el modelo de seguridad de Odoo, y además sirven para mostrar y esconder funcionalidad.
date: 2026-10-10
topic: ERP
tags: [odoo, security, xml]
goal: Dos perfiles reales, en vez de todo el mundo como administrador.
course: odoo-backend-framework
section: seguridad
order: 1
---

Hasta ahora cualquier usuario interno puede ver y modificar todas las órdenes. Para un taller de tres personas tal vez alcance; en cuanto hay un jefe y varios técnicos, no.

La seguridad de Odoo tiene tres capas, y conviene verlas juntas antes de empezar:

1. **Grupos** — a qué perfil pertenece cada usuario. Esta lección.
2. **Permisos de acceso** (`ir.model.access.csv`) — qué puede hacer cada grupo **sobre cada modelo**. La próxima.
3. **Reglas de registro** (`ir.rule`) — **qué registros** de ese modelo puede tocar. La siguiente.

La metáfora que funciona: el grupo es la credencial, el permiso de acceso dice a qué edificios entrás, y la regla de registro dice qué oficinas de ese edificio.

## Declarar los grupos

```xml security/service_security.xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="module_category_service" model="ir.module.category">
        <field name="name">Taller</field>
        <field name="description">Gestión de órdenes de servicio técnico</field>
        <field name="sequence">20</field>
    </record>

    <record id="privilege_service" model="res.groups.privilege">
        <field name="name">Taller</field>
        <field name="category_id" ref="module_category_service"/>
        <field name="sequence">10</field>
    </record>

    <record id="group_service_technician" model="res.groups">
        <field name="name">Técnico</field>
        <field name="privilege_id" ref="privilege_service"/>
        <field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
        <field name="comment">Trabaja sobre las órdenes que tiene asignadas.</field>
    </record>

    <record id="group_service_manager" model="res.groups">
        <field name="name">Jefe de taller</field>
        <field name="privilege_id" ref="privilege_service"/>
        <field name="implied_ids" eval="[(4, ref('group_service_technician'))]"/>
        <field name="comment">Ve y administra todas las órdenes del taller.</field>
    </record>
</odoo>
```

Un grupo es **un registro de `res.groups`**. Nada más exótico que eso.

### El privilegio: la capa nueva de Odoo 19

```xml
<record id="privilege_service" model="res.groups.privilege">
    <field name="category_id" ref="module_category_service"/>
</record>
```

Acá hay un cambio de estructura que conviene entender, porque es nuevo y rompe todo lo que vas a encontrar escrito antes.

La cadena en Odoo 19 es de **tres niveles**:

```text
ir.module.category  ←  res.groups.privilege  ←  res.groups
```

El **privilegio** es lo que agrupa tus grupos en la ficha del usuario: con él, en Ajustes → Usuarios aparece una sección «Taller» con un desplegable para elegir el nivel. La **categoría** ubica ese bloque entre los de los demás módulos.

Sin privilegio, tus grupos salen como casillas sueltas mezcladas con todas las demás.

> **Si venís de versiones anteriores**
> Esto se hacía con `category_id` directamente sobre el grupo, apuntando a `ir.module.category`. **En Odoo 19 `res.groups` ya no tiene `category_id`**: el módulo ni siquiera instala, falla con `ValueError: Invalid field 'category_id' in 'res.groups'`. El campo se llama ahora `privilege_id` y apunta al modelo intermedio.

### `base.group_user` en la base de la cadena

```xml
<field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
```

El grupo más básico de los tuyos conviene que implique `base.group_user`, el grupo de todo empleado. Así alcanza con poner a alguien en «Técnico» para que sea un usuario interno completo, sin tener que marcarle dos cosas.

### `implied_ids`: la jerarquía

```xml
<field name="implied_ids" eval="[(4, ref('group_service_technician'))]"/>
```

**El jefe implica al técnico**: quien está en «Jefe de taller» obtiene automáticamente todo lo del grupo «Técnico», más lo suyo.

Esto es lo que te deja escribir los permisos sin repetirte. Le das al técnico lo básico, y al jefe solo lo que agrega.

El `eval` con `(4, ref(...))` es un comando de relación de los que vimos en la lección de `create` y `write`: `4` es enlazar un registro existente. En archivos XML se escribe así porque `Command` es Python y acá estamos en XML.

Un detalle importante: **la implicación es acumulativa, no excluyente**. No existe «solo jefe»: un jefe es un técnico con más permisos. Si necesitás que un perfil *no* tenga algo que otro sí, no uses `implied_ids` — son dos grupos hermanos.

### El dato que confunde: la categoría los hace excluyentes

Cuando varios grupos comparten `category_id` **y están encadenados con `implied_ids`**, Odoo los dibuja como un desplegable de niveles en vez de casillas sueltas. Es lo que hace que «Técnico / Jefe de taller» se elija como opción única.

Por eso vale la pena definir la categoría aunque parezca decorativa: cambia cómo se administra el módulo.

## Asignar los grupos

A mano, por usuario: Ajustes → Usuarios → la pestaña con las aplicaciones.

Y por datos, para que al instalar el módulo el administrador ya quede como jefe:

```xml security/service_security.xml
<record id="base.user_admin" model="res.users">
    <field name="group_ids" eval="[(4, ref('group_service_manager'))]"/>
</record>
```

Es cómodo y evita el clásico «instalé el módulo y no veo el menú».

**Pero solo funciona al instalar.** `base.user_admin` está declarado con `noupdate` en el módulo base, así que si agregás esta línea a un módulo **que ya estaba instalado**, el `-u` la va a ignorar en silencio. El síntoma es desconcertante: el XML está bien, el módulo actualiza sin errores, y el administrador sigue sin ver nada.

Cuando te pase, asignalo a mano desde Ajustes → Usuarios, o desde el shell:

```python odoo shell
admin = env.ref("base.user_admin")
admin.group_ids = [(4, env.ref("service_workshop.group_service_manager").id)]
env.cr.commit()
```

> **Si venís de versiones anteriores**
> El campo se llamaba `groups_id`. **En Odoo 19 es `group_ids`**, y hay además un `all_group_ids` de solo lectura con los grupos implicados incluidos. El nombre viejo falla con `ValueError: Invalid field 'groups_id' in 'res.users'`. Es el tercer renombre de esta lección, así que conviene la costumbre general: cuando algo relacionado con grupos no exista, buscá el campo en `odoo/addons/base/models/res_users.py` antes que en Google.

## Los grupos de Odoo que vas a usar

```text
base.group_user       Usuario interno — cualquier empleado
base.group_system     Administrador de ajustes
base.group_portal     Usuario de portal (cliente externo)
base.group_public     Visitante sin login
```

**`base.group_user` es el que importa**: es el grupo base de todo empleado. Tus grupos deberían implicarlo o depender de él, porque muchos permisos de Odoo se cuelgan de ahí.

Y una advertencia sobre los otros dos: `group_portal` y `group_public` **no** heredan de `group_user`. Es a propósito —un cliente externo no es un empleado— y es la causa de que, cuando hagas el portal en la sección de integración, tengas que darles permisos explícitamente.

## Usar un grupo para mostrar u ocultar

Los grupos no son solo permisos: también controlan qué se ve.

**En un campo:**

```python models/service_order.py
cost_total = fields.Monetary(
    string="Costo interno",
    groups="service_workshop.group_service_manager",
)
```

Esto es **seguridad real**, no cosmética: el campo no se envía al cliente y no se puede leer por RPC. Un técnico ni siquiera sabe que existe.

**En un elemento de vista:**

```xml
<field name="cost_total" groups="service_workshop.group_service_manager"/>
<page string="Costos" name="costs" groups="service_workshop.group_service_manager">
```

**En un menú:**

```xml
<menuitem id="menu_service_config" name="Configuración"
          parent="menu_service_root"
          groups="service_workshop.group_service_manager"/>
```

Siempre con el nombre completo: **módulo punto grupo**.

### Cosmético vs real

Vale la pena tener clara la diferencia:

- **`groups` en la definición del campo** — seguridad de verdad. El dato no sale del servidor.
- **`groups` en la vista o el menú** — solo esconde. El dato sigue siendo accesible por RPC si alguien lo pide.

Para algo que no debe verse nunca, va en el modelo. Para ordenar la interfaz y no abrumar, alcanza con la vista.

## Activar funcionalidad opcional

El mismo mecanismo sirve para las opciones de configuración. Odoo lo usa en todos lados: cuando activás «Variantes de producto» en Ajustes, lo que pasa es que te agrega a un grupo, y eso hace aparecer campos y menús que ya estaban ahí.

Es un patrón que vale la pena reconocer: **una casilla de ajustes es un grupo**.

## Declararlo en el manifest

```python __manifest__.py
"data": [
    "security/service_security.xml",
    "security/ir.model.access.csv",
    ...
],
```

**Los grupos van antes que los permisos de acceso**, porque el CSV los referencia por su identificador externo. Y los dos van antes que las vistas, que también pueden referenciarlos.

Es el orden que venimos arrastrando desde la lección del manifest, y acá se ve por qué.

> **Quedate con esto**
> Un grupo es un registro de `res.groups` y la jerarquía se arma con `implied_ids`: el jefe implica al técnico, así los permisos no se repiten. `groups` en la definición de un campo es seguridad real; en una vista o un menú solo esconde. Y los grupos van primero en la lista `data`, porque todo lo demás los referencia.
