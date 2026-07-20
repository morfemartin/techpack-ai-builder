# Prueba controlada de Adobe Illustrator

Esta carpeta compara la misma pagina real del benchmark `O-complete-semantic-project` con dos contratos de exportacion. No son dos layouts distintos.

## Archivos

- `sample/01-legacy-system.svg`: salida anterior, sin preparacion especifica para Illustrator.
- `sample/02-illustrator-system.svg`: misma pagina con XML explicito, fuentes y tamanos originales, baseline vertical explicito para Affinity/Illustrator, imagenes embebidas con `href` y `xlink:href`, metadata segura y siete grupos de capa estables.
- `sample/02-illustrator-system.ai`: documento nativo creado por Illustrator 2026 mediante el importador.
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
4. Abrir `sample/02-illustrator-system.ai` y revisar el reporte.
5. Abrir aparte `sample/01-legacy-system.svg` para comparar el comportamiento anterior.

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
