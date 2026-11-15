---
title: "Proxy"
description: Un objeto que se pone en el lugar de otro para cargarlo recién cuando hace falta, controlar quién lo usa o contar cómo se usa. Con la trampa de __getattr__.
date: 2026-10-19
topic: Backend
tags: [python, patrones]
goal: Controlar el acceso a un objeto sin que quien lo usa note la diferencia.
course: patrones-python
section: estructurales
order: 3
---

Un **Proxy** tiene la misma interfaz que otro objeto y se pone en su lugar para controlar el acceso. Se parece al decorador, pero el propósito es otro: no agrega funcionalidad, decide **cuándo y quién** llega al objeto real.

| Tipo | Hace |
|---|---|
| Virtual | Crea el objeto caro recién cuando se usa |
| De protección | Verifica permisos antes de dejar pasar |
| Remoto | Representa localmente algo que vive en otro servidor |
| Inteligente | Cuenta usos, registra, libera recursos |

## Virtual: cargar cuando hace falta

Una pantalla lista 100 contratos en PDF. Cargarlos todos para mostrar el nombre es tirar segundos:

```python documentos.py
class DocumentoPerezoso:
    def __init__(self, ruta: str) -> None:
        self.ruta = ruta

    @cached_property
    def _real(self) -> Documento:
        return Documento(self.ruta)

    def pagina(self, numero: int) -> str:
        return self._real.pagina(numero)
```

```text Terminal
virtual:
  100 creados sin cargar nada
  cargando contrato-7.pdf (lento)
  contrato-7.pdf p.3
  contrato-7.pdf p.4
```

`functools.cached_property` hace el trabajo del proxy: el `Documento` real se crea en el primer acceso y queda guardado. Es la misma idea que el *lazy loading* de un ORM, que no trae la relación hasta que la tocás.

## De protección: permisos

Los reportes de márgenes son solo para gerencia:

```python reportes.py
class ReportesProtegidos:
    PERMISOS = {"ventas_del_mes": {"ventas", "gerencia"}, "margenes": {"gerencia"}}

    def __init__(self, reales: Reportes, usuario: Usuario) -> None:
        self._reales = reales
        self._usuario = usuario

    def _exigir(self, operacion: str) -> None:
        if not self.PERMISOS[operacion] & self._usuario.roles:
            raise PermissionError(f"{self._usuario.nombre} no puede ver {operacion}")

    def ventas_del_mes(self, mes: str) -> str:
        self._exigir("ventas_del_mes")
        return self._reales.ventas_del_mes(mes)

    def margenes(self, mes: str) -> str:
        self._exigir("margenes")
        return self._reales.margenes(mes)
```

```text Terminal
  ventas 2026-10: S/ 184,220.00
  Luis no puede ver margenes
```

`ReportesSql` no sabe nada de permisos, y se puede probar solo. El proxy se arma con el usuario del request, en el borde de la aplicación.

## Remoto

Cuando usás un cliente de una API, como el de un servicio gRPC o un SDK de la nube, estás usando un proxy remoto: un objeto local con métodos que, por debajo, hacen una llamada de red. La consecuencia práctica es no olvidarlo: cada método puede tardar, fallar por la red o quedarse colgado, y por eso necesita *timeouts* y [reintentos](/blog/patrones/retry-y-circuit-breaker).

## Inteligente, y la trampa de `__getattr__`

Un proxy genérico delega todo con `__getattr__`:

```python contador.py
class Contador:
    def __init__(self, objetivo: object) -> None:
        self._objetivo = objetivo
        self.usos: dict[str, int] = {}

    def __getattr__(self, nombre: str) -> object:
        self.usos[nombre] = self.usos.get(nombre, 0) + 1
        return getattr(self._objetivo, nombre)
```

```text Terminal
  {'ventas_del_mes': 2}
  len() no pasa por __getattr__: object of type 'Contador' has no len()
```

Funciona para métodos comunes, pero **los métodos especiales no pasan por `__getattr__`**: `len()`, `in`, `==` o `for` buscan `__len__`, `__contains__`, `__eq__` o `__iter__` en la clase, no en la instancia. Un proxy genérico de una lista no se comporta como una lista. Para proxies serios, escribí los métodos explícitamente, como en `ReportesProtegidos`, o usá `wrapt`, que resuelve estos casos.

> **Quedate con esto**
> Un proxy se pone en lugar del objeto real para decidir cuándo y quién llega a él. Virtual con `cached_property`, de protección con un chequeo antes de delegar, remoto en cada cliente de API, que conviene tratar como lo que es: una llamada de red. Y `__getattr__` no delega los métodos especiales.
