---
title: "Builder"
description: Armar una consulta con filtros opcionales sin concatenar valores en el SQL, y por qué en Python un dataclass con valores por defecto reemplaza a la mayoría de los builders.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Construir objetos complejos paso a paso, y saber cuándo un dataclass ya lo resuelve.
course: patrones-python
section: creacionales
order: 2
---

El endpoint de reportes acepta filtros opcionales: rango de fechas, estado, cliente. Armar el SQL con `if` y concatenación termina en una de dos cosas: un error de sintaxis cuando falta un `AND`, o una inyección SQL cuando alguien pega un valor dentro del string.

Un **Builder** construye un objeto complejo paso a paso, y valida o arma el resultado al final.

## Un constructor de consultas

```python consultas.py
class Consulta:
    def __init__(self, tabla: str) -> None:
        self._tabla = tabla
        self._condiciones: list[str] = []
        self._parametros: list[object] = []
        self._orden = ""
        self._limite: int | None = None

    def donde(self, condicion: str, *valores: object) -> Self:
        self._condiciones.append(condicion)
        self._parametros.extend(valores)
        return self

    def ordenar_por(self, columna: str, descendente: bool = False) -> Self:
        self._orden = f" ORDER BY {columna}{' DESC' if descendente else ''}"
        return self

    def limitar(self, cantidad: int) -> Self:
        self._limite = cantidad
        return self

    def construir(self) -> tuple[str, list[object]]:
        sql = f"SELECT * FROM {self._tabla}"
        if self._condiciones:
            sql += " WHERE " + " AND ".join(self._condiciones)
        sql += self._orden
        if self._limite is not None:
            sql += " LIMIT %s"
            return sql, [*self._parametros, self._limite]
        return sql, list(self._parametros)
```

Cada método devuelve `self` para encadenar. Los **valores nunca entran al texto**: van aparte, como parámetros, y el driver de la base los escapa.

```python consultas.py
def buscar_comprobantes(desde: date, hasta: date, estado: str | None = None, cliente: str | None = None) -> tuple[str, list[object]]:
    consulta = Consulta("comprobantes").donde("fecha BETWEEN %s AND %s", desde, hasta)
    if estado:
        consulta.donde("estado = %s", estado)
    if cliente:
        consulta.donde("cliente_nombre ILIKE %s", f"%{cliente}%")
    return consulta.ordenar_por("fecha", descendente=True).limitar(100).construir()
```

```text Terminal
('SELECT * FROM comprobantes WHERE fecha BETWEEN %s AND %s AND estado = %s AND cliente_nombre ILIKE %s ORDER BY fecha DESC LIMIT %s', [datetime.date(2026, 10, 1), datetime.date(2026, 10, 31), 'rechazado', '%andina%', 100])
('SELECT * FROM comprobantes WHERE fecha BETWEEN %s AND %s ORDER BY fecha DESC LIMIT %s', [datetime.date(2026, 10, 1), datetime.date(2026, 10, 31), 100])
```

El SQL siempre es válido, tenga los filtros que tenga. Es la misma idea de `select(...).where(...)` de SQLAlchemy, que es un builder completo; en un proyecto real, usá ese.

Ojo con lo que sí entra al texto: `tabla` y `columna`. Esos tienen que venir de tu código, nunca del usuario. Si el orden lo elige el usuario, validalo contra una lista de columnas permitidas.

## En Python, muchas veces alcanza un dataclass

En Java, el builder también resuelve los constructores con muchos parámetros opcionales. En Python, eso lo resuelven los argumentos con nombre y los valores por defecto:

```python pedidos.py
@dataclass(frozen=True)
class Pedido:
    cliente: str = "Ana Quispe"
    items: tuple[tuple[str, int, Decimal], ...] = (("POLO-M", 1, Decimal("35.50")),)
    cupon: str | None = None
    envio: str = "lima"
```

Y `dataclasses.replace` crea una variante cambiando solo lo necesario:

```python test_pedidos.py
base = Pedido()
con_cupon = replace(base, cupon="BIENVENIDA10", items=(("POLO-M", 2, Decimal("35.50")),))
```

```text Terminal
35.50 63.90
```

En los tests, un objeto con valores por defecto válidos más `replace` es el *test data builder* entero: cada test cambia solo lo que prueba.

## Cuándo sí un builder

- El objeto se arma en **pasos condicionales**, como la consulta.
- El resultado necesita una validación que solo se puede hacer al final, con todas las partes.
- La construcción produce algo de otro tipo, como un string SQL o un documento XML.

Para un objeto con muchos campos opcionales, dataclass y `replace`.

> **Quedate con esto**
> Un builder arma un objeto complejo paso a paso y lo produce al final, y encadenar devolviendo `self` lo hace legible. En una consulta, los valores van siempre como parámetros, nunca dentro del texto. Y para objetos con muchos campos opcionales, Python ya tiene argumentos con nombre, valores por defecto y `dataclasses.replace`.
