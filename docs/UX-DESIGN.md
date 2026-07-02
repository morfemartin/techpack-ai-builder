# Diseño y UX — por qué la interfaz es como es

> Una ficha técnica no la lee un diseñador. La lee una **fábrica** — muchas veces
> en otro país, en otro idioma, impresa en blanco y negro y anotada a mano sobre
> la mesa de corte. Cada decisión de esta interfaz parte de ahí.

Este documento explica el sistema de diseño de TechPack AI Builder y **justifica
cada decisión** en dos ejes: qué aporta al **producto** (la herramienta) y qué
aporta al **cliente final real** (la fábrica que produce la prenda a partir del
documento). No es decoración retroactiva: todas estas reglas están codificadas
en [`src/design/tokens.js`](../src/design/tokens.js) como fuente única de verdad
y las consume tanto la interfaz como el generador de SVG.

Demo en vivo: **https://morfemartin.github.io/techpack-ai-builder/**

---

## 1. El lector real es la fábrica

El error clásico al diseñar una herramienta de fichas técnicas es optimizarla
para quien la **rellena** (la marca, el diseñador). Pero el documento que sale
tiene un solo trabajo: que una persona en una planta de producción —a menudo en
India, Bangladesh, Portugal o China— **corte, cosa y arme la prenda sin
ambigüedad ni preguntas de ida y vuelta**.

Eso impone restricciones que no son estéticas, son operativas:

- Se imprime, y muchas veces se **fotocopia en blanco y negro** en el taller.
- Lo leen personas que **no comparten idioma** con la marca.
- Se **cruza por número**: un callout en el dibujo apunta a una fila del BOM.
- Los **datos deben ser inequívocos**: un código de estilo, una medida en mm, un
  Pantone. Un `0` confundido con una `O` es una prenda mal producida.

Todo lo que sigue se deriva de estas cuatro realidades.

---

## 2. El color es información, no estética

La regla central del sistema: **el color codifica prioridad de atención, no
gusto**. Un elemento elige su color por *para qué sirve*, nunca por cómo se ve.
Cinco colores; negro y blanco son el 80%.

| Rol (`role`) | Color | Qué significa | Por qué — producto | Por qué — fábrica |
|---|---|---|---|---|
| `index` | **Rojo** | Marcadores numéricos que el ojo busca y cuenta primero | Da un ancla visual consistente entre pantalla y papel | La fábrica **navega por número**: el `3` rojo del callout es el mismo `3` de la fila del BOM. El rojo se encuentra antes que cualquier otra cosa en la hoja |
| `priority` | **Azul** | Bloques de información prioritaria, con texto blanco encima | Marca las secciones que estructuran el documento | Le dice a la fábrica *dónde mirar primero*: cabeceras de sección, títulos de página. Un bloque, un tema |
| `highlight` | **Amarillo** | Máxima prioridad pero área pequeña; siempre con keyline negro | Señala lo que no puede pasarse por alto (campo requerido, dato faltante) | Resalta la excepción —una nota crítica, una tolerancia especial— sin gritar en toda la página |
| `structure` / `surface` | **Tinta / Blanco** | La retícula, el texto, los bordes, el fondo | El 80% tranquilo sobre el que todo lo demás resalta | Máxima legibilidad, máximo contraste, mínimo desperdicio de tinta |

Esto sigue la disciplina del [Bauhaus](#7-forma-bauhaus-por-qué-encaja-con-la-produccion-textil)
y de la guía de diseño que adoptamos: un marcador numerado solo se justifica si
el contenido **es** una secuencia real. Aquí lo es —los pasos del asistente y las
piezas del BOM están genuinamente enumeradas—, así que el rojo-índice es
información, no adorno.

---

## 3. Impresión primero

### Superficie blanco puro
El documento imprimible es **blanco puro `#FFFFFF`**. El blanco grisáceo azulado
que enmarca la interfaz en pantalla es solo eso —chrome de pantalla, como el gris
del lienzo en Illustrator— y **nunca se imprime**. La ficha sale limpia en papel,
sin tintes que descalibren un colorway.

### Funciona en blanco y negro
Esta es la decisión que más define el sistema. Las fichas técnicas **se
fotocopian en la planta**: el color se pierde. Así que la paleta está afinada por
luminancia para que los cinco tonos caigan en niveles de gris **claramente
separados**:

```
blanco 255  ›  amarillo ~200  ›  rojo ~121  ›  azul ~76  ›  tinta ~25
```

Regla dura: el amarillo **siempre** lleva keyline negro, porque es el par más
cercano al blanco en gris — el borde lo mantiene como una forma distinta aunque
la fotocopia lo aplane. El resultado: **el documento conserva toda su jerarquía
sin una gota de color.** Verificable aplicando un filtro de escala de grises a la
interfaz — la barra azul, los chips rojos y el texto blanco siguen siendo
inconfundibles.

---

## 4. Tipografía: dos familias, tres jerarquías

- **Space Grotesk** (display + interfaz): una grotesca geométrica con linaje
  Bauhaus, distintiva pero muy legible. Lleva títulos, etiquetas y navegación.
- **JetBrains Mono** (datos): monoespaciada, para todo valor técnico — códigos de
  estilo, medidas en mm, hex, POMs.

**Por qué mono para los datos** no es un capricho estético:

- **Desambiguación.** En una mono bien hecha, `0` y `O`, `1`, `l` e `I` no se
  confunden. En una ficha de producción, esa confusión es una prenda mal cortada.
- **Alineación.** Los dígitos monoespaciados forman **columnas perfectas** — una
  tabla de POMs o una lista de medidas se lee de un vistazo, sin números
  bailando.
- **Señal de "esto es un dato".** El cambio de familia le dice a la fábrica, sin
  palabras, qué es texto descriptivo y qué es un valor que debe respetar al
  milímetro.

Tres jerarquías (display / interfaz / datos) sobre dos familias: suficiente
estructura, cero ruido.

---

## 5. Íconos, no emojis

Todo ícono es de **Google Material Symbols** (variante Sharp, esquinas angulares
coherentes con el radio 0). Cero emojis, en ninguna parte.

- **Producto:** los emojis se renderizan distinto en cada sistema operativo y
  versión; un ícono vectorial se ve igual siempre y se colorea según su rol
  semántico.
- **Fábrica:** un emoji es ruido cultural y de plataforma; puede no imprimirse, o
  imprimirse como una caja. Un pictograma técnico es universal y sobrevive al
  papel.

---

## 6. La retícula: una sola fuente de verdad

La retícula no es un fondo decorativo: es el **mismo motor de layout**
([`src/layout/`](../src/layout/)) el que distribuye la interfaz en pantalla **y**
el que arma la ficha técnica en SVG. Un solo sistema numérico para ambos.

- **Micro-grid fija** (`space(n) = n×4px`) para el espaciado interno de los
  componentes.
- **Márgenes por porcentaje entre las retículas mayores**: el motor resuelve
  valores como `"6%"`, así los canales entre bloques **escalan con el formato**
  en lugar de quedar fijos.

**Por qué importa:** la consistencia. Como la misma lógica ordena la pantalla y
el impreso, la fábrica aprende la disposición **una vez** y la reconoce en cada
página y en cada estilo. Y como es código, no hay dos páginas que se maqueten
"parecido pero distinto" a mano en Illustrator — el error más común y más caro en
la producción de fichas.

---

## 7. Forma Bauhaus: por qué encaja con la producción textil

Radio cero, superficies planas (sin sombras), reglas hairline negras, color en
bloques geométricos. No es una elección de moda: el Bauhaus es **la forma sigue a
la función**, y una ficha técnica es función pura.

- **Producto:** sin sombras ni gradientes que compliquen el render o el export.
- **Fábrica:** bordes nítidos y llenos sólidos son lo que mejor sobrevive a una
  impresora láser barata y a una fotocopia. Cada línea negra de la retícula
  **delimita una zona sin ambigüedad** — exactamente lo que hace una hoja de
  producción bien hecha.

El Bauhaus nació enseñando a diseñar para la manufactura. Usarlo para una
herramienta de manufactura textil no es una cita estética; es coherencia.

---

## 8. El asistente de 6 pasos

La interfaz es un asistente lineal: **Prenda → Idioma → Header → Piezas → Diseños
→ Vista Previa**.

- **Producto:** la fase más lenta y frustrante de una ficha técnica no es el
  dibujo —es **recolectar y ordenar los datos** y maquetar las tablas. El
  asistente convierte eso en un formulario guiado y deja el área de diseño en
  blanco para Illustrator. (La recolección asistida por IA que profundiza esto
  está en el roadmap.)
- **Fábrica:** al forzar una estructura de captura, garantiza que **ningún campo
  que la fábrica necesita quede vacío por olvido** — los requeridos se marcan en
  amarillo hasta completarse.

---

## 9. Piso de calidad

Sin anunciarlo, la interfaz respeta un mínimo: foco de teclado visible (un anillo
sólido de tinta, sin glow), `prefers-reduced-motion` respetado, y layout que baja
a móvil. Una herramienta profesional se usa con teclado y en pantallas distintas;
eso no es opcional.

---

## 10. Cómo se traduce en código

Nada de lo anterior vive como "guía de estilo" para humanos. Todo está en código:

- [`src/design/tokens.js`](../src/design/tokens.js) — **fuente única**: paleta con
  su valor de gris, roles semánticos, tipografía, escala de espaciado. Exporta las
  variables CSS **y** los valores que importan los generadores de SVG.
- [`src/design/base.css`](../src/design/base.css) — reset, radio cero global,
  foco visible, motion reducido.
- [`src/layout/`](../src/layout/) — el motor flexbox (con soporte de porcentajes)
  que ordena interfaz y ficha con el mismo sistema.

Cambiar un color o un tipo es editar **un** archivo, y el cambio se propaga a la
pantalla y al documento impreso a la vez. Ese es el punto: el diseño es un
sistema, no una capa de pintura.

---

*Este proyecto es la base open source que usa [Morfe](https://github.com/morfemartin)
—agencia de branding, desarrollo textil, fichas técnicas y web— en su propio
pipeline de lanzamiento de marcas de ropa. Si querés el desarrollo completo hecho
de punta a punta, [hablemos](https://github.com/morfemartin).*
