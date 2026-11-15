---
title: "Agregados: dónde termina un comprobante"
description: Notas de crédito, ítems y la frontera de consistencia. Qué se guarda junto, qué se referencia por número y por qué no hay un repositorio de ítems.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, ddd]
goal: Trazar la frontera de un agregado y hacer cumplir sus reglas dentro de ella.
course: clean-architecture-python
section: dominio
order: 3
---

Una factura aceptada por SUNAT no se edita. Si estaba mal, o el cliente devolvió algo, se emite una **nota de crédito**: un comprobante de tipo `07` que referencia al original y lo corrige total o parcialmente.

Las reglas:

- Solo sobre un comprobante ya aceptado.
- Al mismo cliente del original.
- Con una serie de la misma letra: `FC01` para facturas, `BC01` para boletas.
- Con un sustento, el motivo de la corrección.
- Sin que la suma de las notas supere el total del original.

Antes de escribirlas hay que responder una pregunta de diseño: ¿la nota es parte de la factura o es otra cosa?

## Qué es un agregado

Un agregado es **un grupo de objetos que se modifica como una unidad**, con una entidad como raíz. Desde afuera solo se accede a la raíz, y sus reglas internas se garantizan en una transacción.

`Comprobante` ya es un agregado y sus `Item` son parte de él:

- Un ítem no tiene identidad propia. «El segundo ítem de F001-42» solo existe a través del comprobante.
- Los ítems son una `tuple`: no se agregan ni se quitan por fuera.
- No hay `uow.items` ni `ItemsSql`. **El repositorio es por agregado, no por tabla**: `ComprobantesSql` guarda y lee los ítems con el comprobante, aunque estén en otra tabla.

## Entre agregados, por identidad

La nota de crédito tiene su propio ciclo de vida: se envía, se acepta o se rechaza por su cuenta, días después que la factura. Es otro agregado. Y un agregado apunta a otro **por su identificador, no por el objeto**:

```python dominio/comprobante.py · Lo que suma la nota de crédito
class TipoComprobante(StrEnum):
    FACTURA = "01"
    BOLETA = "03"
    NOTA_DE_CREDITO = "07"


@dataclass(eq=False)
class Comprobante:
    ...
    referencia: NumeroComprobante | None = None
    sustento: str = ""
```

`referencia` es un `NumeroComprobante`, no un `Comprobante`. Con el objeto completo, leer una nota cargaría su factura, que cargaría sus otras notas, y una transacción que solo cambia el estado de la nota quedaría tocando dos agregados. Con el número, cada uno se lee, se modifica y se guarda solo.

## Una fábrica que hace cumplir las reglas

```python dominio/comprobante.py · La fábrica
    @classmethod
    def emitir_nota_de_credito(
        cls,
        numero: NumeroComprobante,
        original: "Comprobante",
        sustento: str,
        items: Iterable[Item],
        fecha: date,
    ) -> "Comprobante":
        if original.tipo is TipoComprobante.NOTA_DE_CREDITO:
            raise ErrorDeDominio("Una nota de crédito no se emite sobre otra nota de crédito")
        if original.estado is not Estado.ACEPTADO:
            raise ErrorDeDominio(f"{original.numero} todavía no fue aceptado por SUNAT")
        if numero.serie[0] != original.numero.serie[0]:
            raise ErrorDeDominio(f"La serie {numero.serie} no corresponde a {original.numero}")
        if not sustento.strip():
            raise ErrorDeDominio("Una nota de crédito necesita un sustento")
        nota = cls(
            TipoComprobante.NOTA_DE_CREDITO,
            numero,
            original.cliente,
            tuple(items),
            fecha,
            referencia=original.numero,
            sustento=sustento,
        )
        if not nota.items:
            raise ErrorDeDominio("Un comprobante necesita al menos un ítem")
        return nota
```

La fábrica recibe el original **para leerlo, no para modificarlo**. Y fijate cómo se cumple «al mismo cliente»: no hay un `if` que lo compare, la nota copia `original.cliente`. Una regla que se cumple por construcción no se puede olvidar.

`emitir()`, la fábrica de facturas y boletas, ahora rechaza el tipo `07`, así que la única forma de crear una nota es esta:

```python dominio/comprobante.py · emitir() cierra la puerta
        if tipo not in _LETRA_DE_SERIE:
            raise ErrorDeDominio("Una nota de crédito se emite sobre un comprobante existente")
```

## La regla que no entra

Falta una: que la suma de las notas no supere el total. Para verificarla hacen falta el original **y todas sus notas anteriores**, que son otros agregados. No entra en la fábrica sin convertir a la factura en dueña de sus notas, y eso es justo lo que acabamos de evitar. Va en un [servicio de dominio](/blog/clean-architecture/servicios-de-dominio).

## Consistencia entre agregados

Dos usuarios emiten una nota sobre la misma factura en el mismo segundo. Los dos leen las notas previas, los dos ven saldo suficiente, los dos guardan. Entre los dos acreditaron más que el total.

Dentro de un agregado la transacción protege las reglas. Entre agregados, hay que decidir. Acá la decisión es **bloquear el original** mientras se emite la nota, y por eso el repositorio tiene `obtener(numero, bloquear=True)`. En el adaptador SQL es una línea:

```python adaptadores/sql.py · obtener
        if bloquear:
            consulta = consulta.with_for_update()
```

`SELECT ... FOR UPDATE` hace esperar a la segunda nota hasta que la primera confirme, y recién entonces lee las notas previas, ya con la primera incluida.

Un detalle: el bloqueo funciona porque los ítems se cargan con `selectinload`, en una consulta aparte. Con `joinedload`, que usa un `LEFT OUTER JOIN`, PostgreSQL rechaza el `FOR UPDATE` con «cannot be applied to the nullable side of an outer join».

## El tamaño correcto

Los agregados conviene que sean chicos. Si para cambiar un campo tenés que cargar quinientos objetos, la frontera está mal trazada. Si dos agregados siempre cambian juntos en la misma transacción, probablemente son uno.

> **Quedate con esto**
> Un agregado es lo que se modifica como unidad, con una raíz como única puerta: los ítems viven dentro del comprobante y no tienen repositorio propio. Entre agregados se referencia por identificador, no por objeto. Las fábricas pueden hacer cumplir reglas por construcción, como copiar el cliente del original. Y las reglas que cruzan agregados necesitan una decisión explícita de concurrencia, como bloquear el original.
