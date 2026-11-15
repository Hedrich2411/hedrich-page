---
title: "Contextos delimitados: cada parte del negocio con su modelo"
description: «Cliente» no significa lo mismo en facturación que en cobranzas. Por qué el comprobante copia el nombre en vez de apuntar al cliente, y cómo se conectan los contextos.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, ddd]
goal: Reconocer los límites de un modelo y conectar contextos sin que se contaminen.
course: clean-architecture-python
section: dominio
order: 5
---

Preguntale a tres áreas de la empresa qué es un cliente:

| Área | Para ella, un cliente es |
|---|---|
| Facturación | Un nombre y un documento, tal como estaban al emitir |
| Cobranzas | Una línea de crédito, días de pago y una deuda |
| Ventas | Un contacto, un teléfono y un historial de pedidos |

Las tres tienen razón. El error es hacer una sola clase `Cliente` con los cuarenta campos que piden entre todas. Termina siendo el modelo que nadie se anima a tocar, porque cada cambio puede romper a alguien que no conocés.

## Un modelo, un límite

Un **contexto delimitado** es la frontera dentro de la cual un modelo y sus palabras significan una sola cosa. Este curso entero es un contexto: facturación. Adentro, `Cliente` es esto y nada más:

```python dominio/comprobante.py
@dataclass(frozen=True)
class Cliente:
    nombre: str
    documento: Documento | None = None
```

Es un value object dentro del comprobante, no una referencia a una tabla de clientes. Y es a propósito: **una factura es un documento legal**. Si el cliente cambia de razón social mañana, la factura de ayer tiene que seguir mostrando el nombre de ayer. Por eso `ComprobanteFila` guarda `cliente_nombre` y no un `cliente_id`.

Lo mismo pasa con los ítems. `Item.descripcion` es un texto copiado, no un `producto_id`. Si mañana el catálogo renombra «Laptop 14"» a «Notebook 14"», los comprobantes emitidos no cambian.

Copiar parece duplicación. Es la forma correcta de modelar algo que **no tiene que cambiar** cuando cambia la fuente.

## Varios contextos en un repositorio

Si la empresa suma inventario y cobranzas, cada uno es un paquete con sus propias capas:

```text empresa/ · Un paquete por contexto
empresa/
├── facturacion/
│   ├── dominio/
│   ├── aplicacion/
│   └── adaptadores/
├── inventario/
│   ├── dominio/
│   ├── aplicacion/
│   └── adaptadores/
└── cobranzas/
    └── ...
```

Y que no se importen entre sí lo verifica el mismo linter de [proteger la arquitectura](/blog/clean-architecture/proteger-la-arquitectura):

```toml pyproject.toml
[[tool.importlinter.contracts]]
name = "Los contextos no se importan entre sí"
type = "independence"
modules = ["empresa.facturacion", "empresa.inventario", "empresa.cobranzas"]
```

## Cómo se hablan

**Por identificador.** Cobranzas guarda `numero_comprobante = "F001-42"` y su propio monto adeudado. No importa `Comprobante`.

**Por eventos.** Cuando facturación publica `ComprobanteAceptado`, inventario descuenta stock con su propio modelo. Facturación no sabe que inventario existe. Es el tema de [eventos de dominio](/blog/clean-architecture/eventos-de-dominio).

**Con una capa anticorrupción.** Cuando del otro lado hay un sistema que no controlás, un adaptador traduce su modelo al tuyo en el borde, y el modelo ajeno no entra. `PseHttp._a_json` es exactamente eso hacia el PSE. Si integrás con un ERP como Odoo, el adaptador convierte un `res.partner` en `Cliente` y el resto del sistema nunca ve un campo de Odoo.

## Cuándo partir

Un equipo y un sistema chico: un solo contexto, sin ceremonia. La señal para partir es lingüística: **cuando la misma palabra empieza a significar dos cosas** en reuniones distintas, o cuando dos equipos se pisan en los mismos archivos por razones que no tienen nada que ver.

Partir antes de tiempo cuesta caro: integraciones por eventos entre cosas que podrían haber sido una llamada a función.

> **Quedate con esto**
> Un contexto delimitado es la frontera donde un modelo significa una sola cosa; «cliente» puede y debe ser distinto en facturación y en cobranzas. Un documento legal copia los datos que no pueden cambiar en vez de referenciarlos. Los contextos se hablan por identificadores, eventos o una capa anticorrupción, nunca importándose. Y se parte cuando el lenguaje lo pide, no antes.
