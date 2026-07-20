# Prueba controlada de Affinity e Illustrator

Esta carpeta compara la misma pagina real del benchmark `O-complete-semantic-project` con dos contratos de exportacion. No son dos layouts distintos.

## Archivos

- `sample/01-legacy-system.svg`: salida anterior, sin preparacion especifica para Illustrator.
- `sample/02-illustrator-system.svg`: misma pagina con XML explicito, fuentes y tamanos originales, baseline vertical explicito para Affinity/Illustrator, imagenes embebidas con `href` y `xlink:href`, metadata segura y siete grupos de capa estables.
- `sample/Techpack-complete.ai`: documento completo con once mesas de trabajo nombradas y siete capas globales.
- `Techpack-Import-Illustrator.jsx`: promueve los grupos SVG a capas nativas y guarda el AI.
- `sample/illustrator-import-report.txt`: version, artboard, capas, objetos y grupos faltantes detectados por Illustrator.

## Capas esperadas

De arriba hacia abajo en el panel Capas:

1. `07 PAGE_CHROME`
2. `06 CALLOUTS`
3. `05 DESIGNER_COMMUNICATION`
4. `04 TECH_DATA`
5. `03 REFERENCES`
6. `02 ARTWORK`
7. `01 PAGE_BACKGROUND`

`DESIGNER_COMMUNICATION` queda aislada para poder ocultarla o borrarla sin tocar datos de fabrica, dibujos, referencias ni numeracion.

## Como repetir la prueba

1. Ejecutar `npm run illustrator:sample` para regenerar ambos SVG desde el fixture.
2. En Illustrator 2026 elegir `Archivo > Secuencias de comandos > Otra secuencia de comandos`.
3. Abrir `Techpack-Import-Illustrator.jsx`.
4. Abrir `sample/Techpack-complete.ai` y revisar el reporte.
5. Abrir aparte `sample/01-legacy-system.svg` para comparar el comportamiento anterior.

## Proceso y problemas resueltos

### 1. SVG heredado

Affinity conservaba los grupos del SVG, pero cada pagina seguia siendo un
documento independiente. Esta version se mantiene como control: no se modifica
ni se elimina del programa.

![SVG heredado abierto en Affinity](img/03-legacy-affinity-reference.png)

### 2. Capas nombradas, pero vacias

Illustrator 30.4 importo los siete contenedores visuales, pero descarto sus
atributos `id`. El primer JSX creo capas con los nombres correctos y dejo los
objetos dentro de `SOURCE_SVG`. El reporte permitio detectar el fallo sin
depender solo de una captura.

![Primera importacion con capas vacias](img/01-illustrator-empty-layers.png)

La correccion usa el orden de apilado determinista como fallback. Illustrator
ahora crea siete capas nativas y mueve un contenedor de cada pagina a cada capa.

### 3. Metricas tipograficas alteradas

Una primera normalizacion sustituyo las familias originales. Aunque el SVG era
valido, cambio anchos, tamanos aparentes y posiciones. Se retiro toda
sustitucion: las fuentes y tamanos del renderer son la fuente de verdad.

![Iteracion con metricas tipograficas alteradas](img/02-font-metrics-shift.png)

### 4. Baseline inconsistente

Affinity e Illustrator interpretan `dominant-baseline=central` de forma
distinta. El perfil final lo convierte a una linea base explicita: `0.36em`
para texto UI y `0.35em` para datos monoespaciados, sin cambiar cajas ni
columnas.

![Baseline corregido en Affinity](img/04-affinity-baseline-fixed.png)

### 5. Importacion completa sin bloqueos

Illustrator mostraba un aviso modal por cada `clipPath`; el motor ya mide y
envuelve esos textos, por lo que el perfil Adobe elimina los recortes
redundantes. Once mesas en una sola fila superaban ademas el ancho maximo del
lienzo. El importador final usa una reticula de cuatro columnas y tres filas.

Resultado aceptado:

- 11 mesas A4 nombradas en orden fisico;
- 7 capas globales;
- 11 grupos de pagina dentro de cada capa;
- comunicacion del disenador aislada y borrable;
- sin sustitucion tipografica, desplazamiento ni dialogos bloqueantes.

![Documento final y capas nativas en Illustrator](img/05-illustrator-final-layers.png)

## Capturas necesarias

Tomar las capturas al 100% de zoom y sin modificar el documento:

1. El artboard completo del AI nuevo.
2. Panel Capas con las siete capas desplegadas.
3. Panel Mesas de trabajo y dimensiones del documento.
4. Acercamiento a header, tabla, instrucciones amarillas y footer.
5. El SVG anterior abierto con su panel Capas.
6. Cualquier aviso de fuentes, perfil de color o contenido SVG.

## Criterio de aceptacion

- A4 horizontal: `297 x 210 mm`.
- Ningun texto cortado, sustituido o desplazado.
- Sin imagenes vinculadas ausentes.
- Siete capas nativas con los nombres indicados.
- La capa de comunicacion con el disenador puede ocultarse sin cambiar el documento de fabrica.
- El SVG nuevo y el anterior contienen el mismo contenido; las diferencias deben provenir solo del contrato de importacion.
