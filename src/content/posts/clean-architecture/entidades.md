---
title: "Entidades: el comprobante y sus reglas"
description: Identidad, ciclo de vida y reglas que cruzan varios datos. Por qué emitir y reconstruir no son lo mismo.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura]
goal: Escribir una entidad que haga cumplir sus reglas y controle sus estados.
course: clean-architecture-python
section: dominio
order: 2
---

Un `Documento` es un valor: dos iguales son intercambiables. Un comprobante no. `F001-42` y `F001-43` pueden tener el mismo cliente, los mismos ítems y el mismo total, y siguen siendo dos comprobantes distintos. Y `F001-42` pasa de `pendiente` a `aceptado` sin dejar de ser `F001-42`.

Eso es una entidad: **tiene identidad y un ciclo de vida**.

## Las piezas

```python dominio/comprobante.py · Lo que compone un comprobante
TASA_IGV = Decimal("0.18")
TOPE_BOLETA_SIN_DOCUMENTO = Decimal("700")


class TipoComprobante(StrEnum):
    FACTURA = "01"
    BOLETA = "03"


_LETRA_DE_SERIE = {TipoComprobante.FACTURA: "F", TipoComprobante.BOLETA: "B"}


class Estado(StrEnum):
    PENDIENTE = "pendiente"
    ACEPTADO = "aceptado"
    RECHAZADO = "rechazado"


@dataclass(frozen=True)
class Cliente:
    nombre: str
    documento: Documento | None = None


@dataclass(frozen=True)
class Item:
    descripcion: str
    cantidad: Decimal
    precio_unitario: Decimal

    def __post_init__(self) -> None:
        if self.cantidad <= 0:
            raise ErrorDeDominio(f"Cantidad inválida en «{self.descripcion}»")
        if self.precio_unitario < 0:
            raise ErrorDeDominio(f"Precio negativo en «{self.descripcion}»")

    @property
    def valor_venta(self) -> Decimal:
        return redondear(self.cantidad * self.precio_unitario)
```

`Cliente` e `Item` son value objects: no tienen identidad propia, viven dentro del comprobante. Las tasas son constantes con nombre; un `0.18` suelto en medio de un cálculo es el número que nadie se anima a cambiar.

## El comprobante

```python dominio/comprobante.py · La entidad
@dataclass(eq=False)
class Comprobante:
    tipo: TipoComprobante
    numero: NumeroComprobante
    cliente: Cliente
    items: tuple[Item, ...]
    fecha: date
    estado: Estado = Estado.PENDIENTE
    motivo_rechazo: str = ""

    @classmethod
    def emitir(
        cls,
        tipo: TipoComprobante,
        numero: NumeroComprobante,
        cliente: Cliente,
        items: Iterable[Item],
        fecha: date,
    ) -> "Comprobante":
        comprobante = cls(tipo, numero, cliente, tuple(items), fecha)
        comprobante._validar_emision()
        return comprobante

    def _validar_emision(self) -> None:
        if not self.items:
            raise ErrorDeDominio("Un comprobante necesita al menos un ítem")
        if self.numero.serie[0] != _LETRA_DE_SERIE[self.tipo]:
            raise ErrorDeDominio(f"La serie {self.numero.serie} no es de {self.tipo.name.lower()}")
        documento = self.cliente.documento
        if self.tipo is TipoComprobante.FACTURA and (documento is None or documento.tipo is not TipoDocumento.RUC):
            raise ErrorDeDominio("Una factura solo se emite a un cliente con RUC")
        if self.tipo is TipoComprobante.BOLETA and documento is None and self.total > TOPE_BOLETA_SIN_DOCUMENTO:
            raise ErrorDeDominio(f"Una boleta de más de S/ {TOPE_BOLETA_SIN_DOCUMENTO} necesita el documento del cliente")

    @property
    def subtotal(self) -> Decimal:
        return sum((item.valor_venta for item in self.items), Decimal(0))

    @property
    def igv(self) -> Decimal:
        return redondear(self.subtotal * TASA_IGV)

    @property
    def total(self) -> Decimal:
        return self.subtotal + self.igv
```

### Emitir no es construir

Las reglas de emisión están en `emitir()`, no en `__post_init__`. Parece un detalle y es la decisión más importante de la lección.

Un comprobante se construye en dos situaciones: cuando se emite uno nuevo y cuando se lee uno de la base. Las reglas de emisión aplican a lo primero, no a lo segundo. Si mañana el tope de la boleta baja a S/ 500, las boletas de S/ 600 sin documento que ya emitiste siguen siendo válidas: cumplían la regla de su momento. Con las reglas en el constructor, no podrías ni leerlas.

Así que `emitir()` es para lo nuevo, y el constructor directo para reconstruir; lo usa [el repositorio](/blog/clean-architecture/repositorio-sqlalchemy). Un método de clase que arma un objeto válido es el patrón fábrica en su versión más simple, y en [agregados](/blog/clean-architecture/agregados) aparece una segunda. Lo que vale siempre, como que una cantidad sea positiva, sí queda en `__post_init__`.

### Los totales se calculan

`subtotal`, `igv` y `total` son propiedades, no campos. No hay forma de que el total diga una cosa y los ítems otra.

El IGV se calcula una sola vez, sobre el subtotal. Calcularlo ítem por ítem y sumar no siempre da lo mismo: dos ítems de S/ 10.25 dan 1.85 + 1.85 = 3.70, y sobre el subtotal de S/ 20.50 da 3.69. Elegí una forma y que sea la única.

## El ciclo de vida

```python dominio/comprobante.py · Transiciones
    def aceptar(self) -> None:
        self._exigir_pendiente()
        self.estado = Estado.ACEPTADO

    def rechazar(self, motivo: str) -> None:
        self._exigir_pendiente()
        self.estado = Estado.RECHAZADO
        self.motivo_rechazo = motivo

    def _exigir_pendiente(self) -> None:
        if self.estado is not Estado.PENDIENTE:
            raise ErrorDeDominio(f"{self.numero} ya fue {self.estado.value}")
```

Nadie hace `comprobante.estado = Estado.ACEPTADO` desde afuera. Se llama a `aceptar()` y el comprobante decide si puede. Uno aceptado por SUNAT no se rechaza después: si tenía un error, se emite una nota de crédito, que es otro comprobante.

Python no impide asignar `estado` directo. La convención y el code review sí, y no vale la pena pelear contra el lenguaje con propiedades privadas para esto.

## La identidad

```python dominio/comprobante.py · Igualdad por número
    def __eq__(self, otro: object) -> bool:
        return isinstance(otro, Comprobante) and otro.numero == self.numero

    def __hash__(self) -> int:
        return hash(self.numero)
```

`eq=False` en el decorador evita que `dataclass` genere la igualdad por campos. Dos objetos con el mismo número son el mismo comprobante, aunque uno esté `pendiente` en memoria y el otro `aceptado` recién leído de la base.

## Dónde no va la lógica

Todas las reglas del comprobante están en el comprobante. La alternativa común es una clase de datos sin métodos y un `ComprobanteService` con `calcular_igv(c)`, `validar_factura(c)` y `aceptar(c)`. Funciona hasta que alguien escribe otro servicio que cambia `c.estado` sin pasar por la validación.

Si la regla habla de un solo comprobante, es un método del comprobante.

## Los tests

```python tests/test_comprobante.py · Extracto
def test_totales() -> None:
    c = factura(Item("Laptop", Decimal("1"), Decimal("2000")), Item("Mouse", Decimal("2"), Decimal("250")))
    assert (c.subtotal, c.igv, c.total) == (Decimal("2500.00"), Decimal("450.00"), Decimal("2950.00"))


def test_boleta_grande_exige_documento() -> None:
    with pytest.raises(ErrorDeDominio, match="700"):
        boleta(Cliente("Ana"), Item("Laptop", Decimal("1"), Decimal("2000")))


def test_no_se_rechaza_lo_aceptado() -> None:
    c = factura(Item("Laptop", Decimal("1"), Decimal("2000")))
    c.aceptar()
    with pytest.raises(ErrorDeDominio, match="ya fue aceptado"):
        c.rechazar("tarde")
```

`factura()` y `boleta()` son dos funciones cortas al principio del archivo que arman un comprobante válido. Cada test cambia solo lo que prueba.

> **Quedate con esto**
> Una entidad tiene identidad y estados: se compara por su número, no por sus campos. Las reglas de emisión van en `emitir()` y no en el constructor, porque reconstruir desde la base no es emitir. Los totales se calculan, no se guardan. Y si la regla habla de un comprobante, es un método del comprobante.
