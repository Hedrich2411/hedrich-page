---
title: "Condiciones, bucles, funciones y arrays"
description: test y [[ ]], case, for sobre archivos sin romperse, while read correcto, el bucle que pierde sus variables en una tubería, arrays, funciones y getopts.
date: 2026-10-19
topic: Infraestructura
tags: [linux, bash]
goal: Escribir la lógica de un script de administración con las construcciones de Bash que no fallan con datos reales.
course: linux-administracion
section: scripting
order: 2
---

## Condiciones

`[[ ]]` es la forma de Bash; `[ ]` es la de `sh`, más antigua y con más trampas:

```text Terminal
$ x="a b"; [ $x = "a b" ]
bash: [: too many arguments
$ [[ $x = "a b" ]] && echo "con [[ ]] no hay que citar"
con [[ ]] no hay que citar
```

| Prueba | Verdadera si |
|---|---|
| `-f archivo` | Existe y es un archivo |
| `-d dir` | Existe y es un directorio |
| `-r`, `-w`, `-x` | Se puede leer, escribir, ejecutar |
| `-s archivo` | Existe y no está vacío |
| `-z "$var"`, `-n "$var"` | Está vacía, no está vacía |
| `"$a" = "$b"`, `!=` | Textos iguales, distintos |
| `$a -eq $b`, `-lt`, `-gt` | Números iguales, menor, mayor |
| `"$x" =~ regex` | Coincide con la expresión regular |

```text Terminal
$ [[ "F001-42" =~ ^([FB][A-Z0-9]{3})-([0-9]+)$ ]] && echo "serie=${BASH_REMATCH[1]} correlativo=${BASH_REMATCH[2]}"
serie=F001 correlativo=42
```

`BASH_REMATCH` guarda los grupos de la última coincidencia.

## case

Cuando hay varias opciones sobre el mismo valor, `case` es más claro que una cadena de `elif`:

```bash Terminal
for s in F001 B001 X001; do
  case "$s" in
    F*) echo "$s: factura" ;;
    B*) echo "$s: boleta" ;;
    *)  echo "$s: no se reconoce" ;;
  esac
done
```

```text Terminal
F001: factura
B001: boleta
X001: no se reconoce
```

## for sobre archivos

```bash Bien
for f in /var/backups/facturacion/*.dump; do
  [[ -e "$f" ]] || continue
  echo "procesando $f"
done
```

El comodín lo expande Bash directamente en una lista de archivos, con espacios y todo. La línea `[[ -e ]]` cubre el caso de que no haya ninguno: sin ella, el bucle corre una vez con el texto literal `*.dump`. `shopt -s nullglob` al principio del script logra lo mismo.

```bash Mal
for f in $(ls /var/backups/*.dump); do
```

`$(ls)` parte por espacios y vuelve a expandir comodines. Es el error `SC2045` de shellcheck.

## while read

Para leer un archivo línea por línea, con campos separados:

```bash Terminal
printf 'F001-1;2360.00\nB001-7;59.00\n' > montos.csv
while IFS=';' read -r numero monto; do
  echo "$numero -> $monto"
done < montos.csv
```

```text Terminal
F001-1 -> 2360.00
B001-7 -> 59.00
```

`IFS=';'` define el separador solo para ese `read`, y `-r` evita que una barra invertida en los datos se interprete como escape.

### El bucle que pierde sus variables

```text Terminal
$ contador=0; printf 'a\nb\n' | while read -r _; do contador=$((contador + 1)); done; echo "$contador"
0
$ contador=0; while read -r _; do contador=$((contador + 1)); done < <(printf 'a\nb\n'); echo "$contador"
2
```

En el primero, el `while` está del lado derecho de una tubería, y **cada lado de una tubería corre en un subproceso**: el contador se incrementó en otro proceso, que terminó. El segundo usa *process substitution*, `< <(comando)`, y el bucle corre en la shell actual.

Si el bucle no lee del teclado, mirá también si adentro hay un `ssh`, que se [come la entrada](/blog/linux/ssh) del bucle.

## Arrays

```bash Terminal
servidores=(servidor laptop respaldo)
echo "${#servidores[@]} servidores: ${servidores[*]}"
for s in "${servidores[@]}"; do
  printf '%-10s %s\n' "$s" "$(getent hosts "$s" | awk '{print $1}')"
done
```

```text Terminal
3 servidores: servidor laptop respaldo
servidor   172.20.0.2
laptop     172.20.0.3
respaldo   172.20.0.4
```

`"${array[@]}"`, con comillas, recorre los elementos aunque tengan espacios. Los asociativos funcionan como diccionarios:

```bash Terminal
declare -A puertos=([ssh]=22 [http]=80 [postgres]=5432)
for k in "${!puertos[@]}"; do echo "$k=${puertos[$k]}"; done
```

Y `mapfile` carga la salida de un comando en un array, una línea por elemento:

```text Terminal
$ mapfile -t usuarios < <(awk -F: '$3 >= 1000 && $3 < 65534 {print $1}' /etc/passwd)
$ echo "usuarios humanos: ${usuarios[*]}"
usuarios humanos: ubuntu ana
```

## Funciones

```bash script.sh
log() { printf '%s %s\n' "$(date -Is)" "$*"; }
morir() { log "ERROR: $*" >&2; exit 1; }

respaldar() {
  local base=$1
  local destino=$2
  [[ -d "$destino" ]] || morir "no existe $destino"
  log "respaldando $base"
}

respaldar facturacion /var/backups
```

Sin `local`, las variables de una función son globales y pisan las del resto del script. Una función devuelve un código de salida con `return N`; para devolver un valor, se imprime y se captura: `valor=$(funcion)`.

`morir` escribe en stderr, `>&2`, y sale con código 1. Es el patrón para cortar con un mensaje claro.

## Opciones con getopts

```bash opciones.sh
#!/usr/bin/env bash
uso() { echo "uso: $0 [-n] [-d dias] base" >&2; exit 2; }
simulacion=false; dias=14
while getopts ':nd:' opcion; do
  case "$opcion" in
    n) simulacion=true ;;
    d) dias=$OPTARG ;;
    *) uso ;;
  esac
done
shift $((OPTIND - 1))
[[ $# -eq 1 ]] || uso
echo "base=$1 dias=$dias simulacion=$simulacion"
```

```text Terminal
$ ./opciones.sh -n -d 30 facturacion
base=facturacion dias=30 simulacion=true
$ ./opciones.sh -x facturacion; echo "codigo: $?"
uso: opciones.sh [-n] [-d dias] base
codigo: 2
```

`d:` con dos puntos indica que `-d` lleva un valor. El código 2 es la convención para «se usó mal».

## printf, no echo

```text Terminal · printf '%-12s %10s\n' "Comprobante" "Total" "F001-1" "2360.00" "B001-7" "59.00"
Comprobante       Total
F001-1          2360.00
B001-7            59.00
```

`echo` se comporta distinto según la shell con `-e` y las barras invertidas. `printf` es igual en todos lados, alinea columnas y repite el formato para cada par de argumentos.

> **Quedate con esto**
> `[[ ]]` en lugar de `[ ]`, y `case` para varias opciones. `for f in /dir/*.ext` con la comprobación de que exista, nunca `for f in $(ls)`. `while IFS=... read -r` para leer líneas, y `< <(comando)` en lugar de una tubería si el bucle tiene que modificar variables. Arrays con `"${a[@]}"`, `local` en las funciones, `getopts` para opciones y `printf` en lugar de `echo`.
