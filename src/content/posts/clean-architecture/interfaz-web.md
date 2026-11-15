---
title: "Una pantalla de caja que reusa todo"
description: Un formulario HTML para emitir boletas, sin JavaScript y sin tocar el dominio ni los casos de uso.
date: 2026-10-19
topic: Backend
tags: [python, fastapi, arquitectura]
goal: Agregar una interfaz web completa reusando casos de uso y presentadores.
course: clean-architecture-python
section: adaptadores
order: 5
---

La cajera no va a emitir boletas con `curl`. Necesita una pantalla: nombre del cliente, DNI si hace falta, lo que se lleva, y un botón.

Es la tercera entrada al sistema, después de la API JSON y el CLI, y la prueba de fuego de la arquitectura: **¿cuánto hay que tocar para agregarla?**

| | Cambia |
|---|---|
| Dominio | Nada |
| Casos de uso | Nada |
| Adaptadores | `paginas.py` y una plantilla |
| Arranque | Una línea: `app.include_router(rutas_html(nueva_unidad))` |

## El formulario

```html adaptadores/plantillas/caja.html · Extracto
{% if error %}<p class="error" role="alert">{{ error }}</p>{% endif %}
<form method="post" action="/caja">
  <label>Cliente <input name="cliente" required value="{{ datos.cliente or '' }}"></label>
  <label>DNI o RUC <input name="documento" inputmode="numeric" pattern="\d{8}|\d{11}" value="{{ datos.documento or '' }}"></label>
  {% for descripcion, cantidad, precio in datos.filas or [("", "", "")] * 3 %}
  <div class="item">
    <input name="descripcion" placeholder="Descripción" value="{{ descripcion }}">
    <input name="cantidad" placeholder="Cant." inputmode="decimal" value="{{ cantidad }}">
    <input name="precio" placeholder="Valor unit." inputmode="decimal" value="{{ precio }}">
  </div>
  {% endfor %}
  <p><button type="submit">Emitir boleta</button></p>
</form>
```

Tres filas de ítems con el mismo `name`: el navegador manda listas, y FastAPI las recibe como `list[str]`.

Un detalle que el test atrapó: la primera versión usaba `datos.items` y fallaba con «'builtin_function_or_method' object is not iterable». En Jinja, `datos.items` sobre un diccionario resuelve primero al **método** `dict.items`, no a la clave. La clave se llama `filas`.

## El manejador

```python adaptadores/paginas.py · Cobrar
    @rutas.post("/caja")
    def cobrar(
        request: Request,
        cliente: Annotated[str, Form()],
        descripcion: Annotated[list[str], Form()],
        cantidad: Annotated[list[str], Form()],
        precio: Annotated[list[str], Form()],
        documento: Annotated[str, Form()] = "",
    ) -> Response:
        filas = [fila for fila in zip(descripcion, cantidad, precio, strict=True) if fila[0].strip()]
        try:
            solicitud = SolicitudEmision(
                tipo=TipoComprobante.BOLETA,
                serie=serie_de_caja,
                cliente=Cliente(cliente.strip(), _documento(documento)),
                items=tuple(Item(d.strip(), decimal_desde_texto(c), decimal_desde_texto(p)) for d, c, p in filas),
            )
            comprobante = EmitirComprobante(nueva_unidad()).ejecutar(solicitud)
        except ErrorDeDominio as error:
            datos = {"cliente": cliente, "documento": documento, "filas": filas}
            return _PLANTILLAS.TemplateResponse(
                request, "caja.html", {"error": str(error), "datos": datos}, status_code=422
            )
        return RedirectResponse(f"/comprobantes/{comprobante.numero}/impreso", status_code=303)
```

Es un controlador como los de la API: traduce el formulario a una `SolicitudEmision` y llama al mismo `EmitirComprobante`. Tres cosas son propias de la web.

**Interpretar lo que escribe la cajera.** Escribe un número y no elige un tipo de documento. Que 8 dígitos sea DNI y 11 sea RUC es una regla de esta pantalla, no del negocio; por eso vive en el adaptador:

```python adaptadores/paginas.py · _documento
def _documento(texto: str) -> Documento | None:
    texto = texto.strip()
    if not texto:
        return None
    if len(texto) == 8:
        return Documento(TipoDocumento.DNI, texto)
    if len(texto) == 11:
        return Documento(TipoDocumento.RUC, texto)
    raise ErrorDeDominio("El documento tiene que ser un DNI de 8 dígitos o un RUC de 11")
```

**Los errores vuelven al formulario.** Acá un `ErrorDeDominio` no se convierte en el JSON 422 de la API: se vuelve a mostrar la pantalla con el mensaje y lo que ya se había cargado. La cajera no tiene que reescribir nada.

**Post/Redirect/Get.** Si el POST respondiera con el HTML del impreso, apretar F5 reenviaría el formulario y emitiría **otra boleta**: dos correlativos por una venta. El `303` redirige a una página que se puede recargar sin efectos.

## Tres niveles de validación

| Nivel | Qué verifica | ¿Alcanza solo? |
|---|---|---|
| HTML: `required`, `pattern` | Que el campo no esté vacío, que tenga 8 u 11 dígitos | No: se saltea con las herramientas del navegador |
| Adaptador | Que los números sean números | No: es una pantalla entre varias |
| Dominio | Las reglas del negocio | Sí: es el único que vale |

La validación del navegador es UX. La única que protege algo es la del dominio, y la API, el CLI y la caja pasan por la misma.

## Lo que falta para producción

**Autenticación.** Una caja que emite boletas no puede estar abierta. Va un login delante, y con él, protección contra CSRF: un token en el formulario o cookies `SameSite=Strict`, porque FastAPI no la trae incluida.

**Precios con IGV.** En una tienda real el precio de la etiqueta ya incluye el IGV; acá la cajera carga el valor sin impuesto. Convertir de uno a otro, `valor = precio / 1.18` con su redondeo, es una regla del dominio. No cambia nada de esta pantalla.

## Los tests

```python tests/test_paginas.py · Extracto
def test_cobrar_y_ver_el_impreso(api: TestClient) -> None:
    respuesta = api.post("/caja", data=CAJA, follow_redirects=False)

    assert respuesta.status_code == 303
    assert respuesta.headers["location"] == "/comprobantes/B001-1/impreso"
    impreso = api.get("/comprobantes/B001-1/impreso").text
    assert "SON: VEINTE CON 06/100 SOLES" in impreso


def test_una_regla_incumplida_vuelve_al_formulario(api: TestClient) -> None:
    respuesta = api.post("/caja", data={**CAJA, "precio": ["800", ""]})

    assert respuesta.status_code == 422
    assert "necesita el documento del cliente" in respuesta.text
    assert 'value="Ana Quispe"' in respuesta.text
```

Dos cafés de S/ 8.50 son 17.00 más 3.06 de IGV. La regla de la boleta de más de S/ 700 la probó el dominio hace rato; acá se prueba que el mensaje llegue a la pantalla.

> **Quedate con esto**
> Una interfaz web nueva es un adaptador más: el dominio y los casos de uso no cambian. Lo propio de la web, como interpretar lo que se tipea, volver al formulario con el error o redirigir después del POST, queda en el controlador. La validación del navegador es comodidad; la del dominio es la que vale. Y Post/Redirect/Get evita que un F5 emita dos boletas.
