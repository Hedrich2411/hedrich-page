---
title: "Cuatro principios antes de cualquier patrón"
description: Encapsular lo que varía, componer en lugar de heredar, programar contra interfaces y bajo acoplamiento. Los patrones son estos principios aplicados a casos que se repiten.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Reconocer los principios que hay detrás de todos los patrones del curso.
course: patrones-python
section: principios
order: 1
---

Un patrón de diseño es una solución con nombre a un problema que aparece una y otra vez. No se aprende de memoria: se reconoce el problema. Y casi todos los patrones salen de cuatro principios.

## 1. Encapsulá lo que varía

Un sistema manda avisos de cobro. Hoy por correo; mañana, por WhatsApp. Lo que cambia es **el canal**, no el aviso. Separalo:

```python avisos.py
class Canal(Protocol):
    def enviar(self, destino: str, texto: str) -> None: ...


class Correo:
    def enviar(self, destino: str, texto: str) -> None:
        print(f"correo a {destino}: {texto}")


class WhatsApp:
    def enviar(self, destino: str, texto: str) -> None:
        print(f"whatsapp a {destino}: {texto}")


class AvisoDeCobro:
    def __init__(self, canal: Canal) -> None:
        self.canal = canal

    def avisar(self, destino: str, saldo: Decimal) -> None:
        self.canal.enviar(destino, f"Tenés un saldo pendiente de S/ {saldo:,.2f}")
```

```text Terminal
correo a ana@empresa.pe: Tenés un saldo pendiente de S/ 1,250.50
whatsapp a +51 999 888 777: Tenés un saldo pendiente de S/ 1,250.50
```

Sumar SMS es una clase nueva; `AvisoDeCobro` no se toca.

El mismo principio en chico: un `@property` encapsula la validación de un atributo, y quien lo usa no se entera:

```python producto.py
class Producto:
    @property
    def precio(self) -> Decimal:
        return self._precio

    @precio.setter
    def precio(self, valor: Decimal) -> None:
        if valor < 0:
            raise ValueError(f"precio negativo para {self.nombre}: {valor}")
        self._precio = valor
```

## 2. Composición sobre herencia

La alternativa con herencia habría sido `AvisoDeCobroPorCorreo` y `AvisoDeCobroPorWhatsApp`. Con un segundo tipo de aviso, recordatorios, ya son cuatro clases; con tres canales, seis. La herencia multiplica; la composición suma: `AvisoDeCobro` **tiene** un canal, y se lo podés cambiar en ejecución.

Heredar está bien cuando la relación es de verdad «es un» y estable. Para reutilizar comportamiento, componer.

## 3. Programá contra interfaces

`AvisoDeCobro` depende de `Canal`, un `Protocol`, no de `Correo`. En Python no hace falta que `Correo` herede de nada: si tiene un `enviar` con esa firma, cumple. Es el tipado estructural, y es lo que hace que los patrones en Python sean más cortos que en Java.

## 4. Bajo acoplamiento

`AvisoDeCobro` no sabe que existe SMTP, ni la API de WhatsApp, ni sus credenciales. Cada pieza conoce lo mínimo de las otras, y por eso se puede probar con un canal falso y cambiar sin efectos en cadena.

## Y SOLID

Estos cuatro principios están en la base de SOLID, que tiene su propia sección, con ejemplos, en el [curso de Clean Architecture](/blog/clean-architecture/responsabilidad-unica): responsabilidad única, abierto/cerrado, Liskov, segregación de interfaces e inversión de dependencias.

## Python cambia los patrones

Muchos patrones del libro clásico, el de la «banda de los cuatro», existen porque C++ y Java no tenían funciones como valores, módulos ni tipado estructural. En Python:

| Patrón | En Python suele ser |
|---|---|
| Strategy | Una función que se pasa como argumento |
| Iterator | Un generador con `yield` |
| Singleton | Un módulo |
| Factory | Un diccionario de clases o funciones |
| Decorator | `@decorador` |
| Command | Un objeto llamable o un `functools.partial` |

El curso muestra cada patrón en su versión clásica cuando aporta, y la forma Python cuando alcanza.

> **Quedate con esto**
> Separá lo que cambia de lo que no, componé en lugar de heredar, dependé de un `Protocol` y no de una clase concreta, y que cada pieza sepa lo mínimo de las demás. Los patrones son esos principios con nombre. Y en Python, muchos se reducen a funciones, módulos y generadores.
