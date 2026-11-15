---
title: "Segregación de interfaces: pedir solo lo que se usa"
description: Un repositorio con quince métodos obliga a cada fake a implementar quince. Interfaces chicas, pensadas para quien las consume.
date: 2026-10-19
topic: Backend
tags: [python, arquitectura, solid]
goal: Diseñar puertos a la medida de cada cliente y reconocer cuándo una interfaz creció de más.
course: clean-architecture-python
section: solid
order: 4
---

**Ningún cliente debería depender de métodos que no usa.** Es el principio de SOLID que `Protocol` hace casi gratis en Python, y el que más se olvida cuando un repositorio crece con el proyecto.

## El repositorio que creció

Después de dos años, el repositorio típico se ve así:

```python Mal · una interfaz para todos
class RepositorioComprobantes(Protocol):
    def agregar(self, c: Comprobante) -> None: ...
    def obtener(self, numero: NumeroComprobante) -> Comprobante | None: ...
    def actualizar(self, c: Comprobante) -> None: ...
    def eliminar(self, numero: NumeroComprobante) -> None: ...
    def listar(self, desde: date, hasta: date) -> list[Comprobante]: ...
    def buscar_por_cliente(self, ruc: str) -> list[Comprobante]: ...
    def totales_del_mes(self, mes: int, anio: int) -> dict[str, Decimal]: ...
    def exportar_csv(self, desde: date, hasta: date) -> bytes: ...
    def pendientes(self, limite: int) -> list[Comprobante]: ...
    def marcar_enviado(self, numero: NumeroComprobante) -> None: ...
    def contar_rechazados(self) -> int: ...
    # ...
```

`EnviarPendientes` usa dos de esos métodos y depende de todos. Las consecuencias son concretas:

- **El fake de los tests tiene que implementar los quince**, o se reemplaza por un `MagicMock`, y volvés a los tests que verifican llamadas.
- **Cambiar la firma de `totales_del_mes`** obliga a tocar todos los fakes, aunque ningún caso de uso que se testea con ellos la use.
- **Nadie sabe qué usa quién.** ¿Se puede borrar `contar_rechazados`? Hay que buscar en todo el proyecto.
- **`eliminar` existe**, y en facturación electrónica un comprobante no se elimina nunca. Que el método esté es una invitación.

## Interfaces por cliente

En el curso cada puerto tiene los métodos de sus clientes y nada más:

| Interfaz | Quién la usa | Métodos |
|---|---|---|
| `Comprobantes` | Emitir, notas, enviar | 5 |
| `Series` | Emitir, notas | 1 |
| `Pse` | Enviar pendientes | 1 |
| `Correo` | Avisar rechazos | 1 |
| `ConsultasSql` | Listado y exportación | 1 |
| `Exportador` | El endpoint de exportación | 1 |

Las [lecturas](/blog/clean-architecture/lecturas) separadas de las escrituras son, en el fondo, segregación de interfaces: los listados no comparten interfaz con lo que modifica comprobantes.

## La interfaz más chica posible

Con `Protocol`, cada función puede declarar exactamente lo que necesita. Los exportadores reciben `Sequence[FilaListado]`, no `ConsultasSql`: no necesitan consultar nada, solo formatear filas. Y el caso de uso recibe `hoy: Callable[[], date]`; una función es la interfaz más chica que existe.

```python Comparación
def exportar(self, consultas: ConsultasSql, desde: date, hasta: date) -> bytes: ...  # depende de la base
def exportar(self, filas: Sequence[FilaListado]) -> bytes: ...                       # depende de datos
```

La segunda se prueba con una lista armada a mano y sirve igual si mañana las filas vienen de un archivo.

## Una excepción consciente

`UnidadDeTrabajo` expone `comprobantes` y `series`, y `EnviarPendientes` nunca usa `series`. Según el principio, debería recibir algo más chico.

No lo hacemos porque la unidad de trabajo representa la transacción, no una colección de métodos. Partirla en una variante por caso de uso agrega tipos sin quitar ningún problema real: el fake es el mismo y nadie va a llamar a `series` por accidente. ISP sirve para cortar dependencias que molestan, no para tener el diagrama más puro.

## Señales de que una interfaz creció de más

- Un fake con métodos que hacen `raise NotImplementedError`.
- Métodos que usa un solo cliente.
- Un cambio de firma que obliga a tocar archivos que no tienen nada que ver con el cambio.
- Nombres como `RepositorioGeneral` o `ServicioDeComprobantes`.

> **Quedate con esto**
> Cada cliente depende solo de lo que usa: interfaces chicas, escritas desde el lado de quien las consume. Una interfaz gorda obliga a cada fake a implementarlo todo y esconde qué usa quién. Con `Protocol` y `Callable` en Python es barato pedir exactamente lo necesario. Y como todo principio, se aplica donde corta un problema real, no por pureza.
