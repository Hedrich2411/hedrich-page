---
title: "Strategy y Template Method"
description: El costo de envío como funciones intercambiables en un diccionario, y un importador que fija los pasos y deja a cada formato completar los suyos.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Intercambiar algoritmos sin condicionales y fijar el esqueleto de un proceso dejando variar sus pasos.
course: patrones-python
section: comportamiento
order: 1
---

Dos formas de variar un algoritmo. **Strategy** reemplaza el algoritmo entero por otro con la misma firma. **Template Method** fija los pasos y deja que las subclases cambien algunos.

## Strategy: el costo de envío

Lima, provincia, recojo en tienda: cada modalidad calcula distinto. En Python, una estrategia es una **función**:

```python envios.py
def envio_lima(p: Pedido) -> Decimal:
    return Decimal(0) if p.subtotal >= 150 else Decimal("10")


def envio_provincia(p: Pedido) -> Decimal:
    return Decimal("15") + Decimal("4") * max(p.peso_kg - 1, Decimal(0))


def recojo_en_tienda(p: Pedido) -> Decimal:
    return Decimal(0)


ENVIOS: dict[str, Callable[[Pedido], Decimal]] = {
    "lima": envio_lima,
    "provincia": envio_provincia,
    "tienda": recojo_en_tienda,
}


def costo_de_envio(modalidad: str, pedido: Pedido) -> Decimal:
    return ENVIOS[modalidad](pedido)
```

```text Terminal · Pedido a Arequipa, 3.5 kg, S/ 120
lima       S/ 10
provincia  S/ 25.0
tienda     S/ 0
express    S/ 25
```

La última línea es una modalidad que se sumó en ejecución, con `ENVIOS["express"] = lambda p: Decimal("25")`, sin tocar `costo_de_envio`. Las estrategias se prueban de a una, con un `assert` y un pedido armado a mano.

La versión clásica, con una clase por estrategia y un método `calcular`, tiene sentido cuando cada estrategia necesita **configuración o estado**, como una tarifa que viene de la base. Si no, una función alcanza. `sorted(lista, key=...)` es el ejemplo más usado de Strategy en Python, y nadie lo llama así.

## Template Method: importadores

Importar clientes desde CSV o desde JSON sigue siempre los mismos pasos: leer, convertir cada fila, juntar los errores, avisar al terminar. Solo cambia cómo se lee. La clase base fija el esqueleto:

```python importadores.py
class Importador(ABC):
    def importar(self, contenido: str) -> tuple[list[Cliente], list[str]]:
        validos: list[Cliente] = []
        errores: list[str] = []
        for numero, fila in enumerate(self.leer(contenido), start=1):
            try:
                validos.append(self.convertir(fila))
            except (KeyError, ValueError) as e:
                errores.append(f"fila {numero}: {e}")
        self.al_terminar(validos, errores)
        return validos, errores

    @abstractmethod
    def leer(self, contenido: str) -> Iterable[dict[str, str]]: ...

    def convertir(self, fila: dict[str, str]) -> Cliente:
        documento = fila["documento"].strip()
        if len(documento) not in (8, 11) or not documento.isdigit():
            raise ValueError(f"documento inválido {documento!r}")
        return Cliente(documento, fila["nombre"].strip())

    def al_terminar(self, validos: list[Cliente], errores: list[str]) -> None:
        pass


class ImportadorCsv(Importador):
    def leer(self, contenido: str) -> Iterable[dict[str, str]]:
        return csv.DictReader(io.StringIO(contenido))


class ImportadorJson(Importador):
    def leer(self, contenido: str) -> Iterable[dict[str, str]]:
        return json.loads(contenido)

    def al_terminar(self, validos: list[Cliente], errores: list[str]) -> None:
        print(f"  json: {len(validos)} importados, {len(errores)} con error")
```

```text Terminal
([Cliente(documento='20131312955', nombre='Distribuidora Andina')], ["fila 2: documento inválido '1234'"])
  json: 1 importados, 1 con error
```

Tres tipos de método: `importar` es el **esqueleto** y no se sobrescribe; `leer` es **obligatorio**, con `@abstractmethod`; `convertir` y `al_terminar` son **ganchos** con un comportamiento por defecto que se puede cambiar. Nadie puede olvidarse de juntar los errores, porque eso está en el esqueleto.

## Cuál

| | Strategy | Template Method |
|---|---|---|
| Varía | El algoritmo entero | Algunos pasos |
| Mecanismo | Composición: se pasa una función u objeto | Herencia: se sobrescriben métodos |
| Se cambia en ejecución | Sí | No |

Template Method usa herencia, y con la herencia vienen sus problemas: una subclase que sobrescribe el gancho equivocado rompe el proceso sin aviso. Cuando los pasos que varían son uno o dos, pasarlos como funciones a un proceso común es más simple: `importar(contenido, leer=leer_csv)`.

> **Quedate con esto**
> Strategy en Python es una función en un diccionario o pasada como argumento; la clase hace falta cuando la estrategia tiene configuración. Template Method fija el esqueleto en la clase base y deja pasos obligatorios y ganchos opcionales a las subclases. Si varían uno o dos pasos, pasá funciones en lugar de heredar.
