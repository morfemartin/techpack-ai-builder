# TechPack AI Builder 🧵

Open-source wizard that generates professional, print-ready fashion **tech packs** (fichas técnicas) as SVG — no design software required. Built by [Morfe](https://github.com/morfemartin), a branding + textile development agency, to run our own production pipeline in the open.

> Turn a brand's parts list, colorways, and embroidery specs into a multi-page, artboard-ready technical sheet in minutes, in Spanish, English and/or Chinese.

**[▶ Demo en vivo](https://morfemartin.github.io/techpack-ai-builder/)** — build del wizard servido desde GitHub Pages.
Nota: esta demo estática no incluye las funciones asistidas por IA (importar CSV, traducción, extracción de PDF de bordado) — esas requieren el proxy backend en Vercel descrito en [Seguridad](#seguridad), que un sitio estático no puede correr. Corré `npm run dev` en local para probarlas (ver [Instalación](#instalación)).

---

## Índice

- [Sobre el proyecto](#sobre-el-proyecto)
- [Características](#características)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Arquitectura multi-prenda](#arquitectura-multi-prenda)
- [Diseño y UX](#diseño-y-ux)
- [Roadmap](#roadmap)
- [Contribuir](#contribuir)
- [Tecnologías](#tecnologías)
- [Licencia](#licencia)

---

## Sobre el proyecto

Cualquier marca de ropa que produce en fábrica necesita una ficha técnica (tech pack) por cada estilo: especificaciones de piezas, vista técnica de 4 ángulos, posición y técnica de cada diseño/bordado, colores exactos en Pantone/CMYK, y — si hay bordado — la ficha de máquina (puntadas, hilos, secuencia de paradas).

Normalmente esto se arma a mano en Illustrator, ficha por ficha. TechPack AI Builder lo genera desde un wizard: completás los datos una vez y obtenés SVG listos para abrir en Illustrator con un artboard por página.

Está pensado para dos públicos a la vez:
- Marcas y agencias que necesitan producir fichas técnicas rápido, en varios idiomas.
- Programadores que quieran una base sólida de generación de documentos técnicos en SVG para extender a otras verticales.

## Características

- Wizard guiado de 6 pasos: prenda → idioma(s) de exportación → header de marca → piezas/specs → diseños → vista previa.
- Diagrama técnico de 4 vistas (frontal/trasera/izq/der) con callouts numerados apuntando a cada pieza.
- Editor de colores Pantone/nombre + hex, con conversión automática a CMYK.
- Ficha técnica de bordado dedicada, con extracción automática de datos desde un PDF de máquina Wilcom (requiere API key de Anthropic, opcional).
- Exportación multi-idioma (ES/EN/ZH) con traducción asistida por IA (opcional).
- Cada página se genera como SVG A4 horizontal (`297×210 mm`), descargable o copiable y agrupado semánticamente para abrir como artboards separados en Illustrator.
- Cuando faltan dibujos técnicos, el resultado se identifica como **Illustration Handoff**: incluye índice, páginas numeradas, artboards editables e instrucciones textiles para que un diseñador gráfico complete las ilustraciones sin inventar construcción.
- **Arquitectura multi-prenda desde el diseño**: agregar un nuevo tipo de prenda es un archivo de datos, no una reescritura — ver [abajo](#arquitectura-multi-prenda).

## Instalación

Requisitos: Node.js 18+.

```bash
git clone https://github.com/morfemartin/techpack-ai-builder.git
cd techpack-ai-builder
npm install
npm run dev
```

Abrí `http://localhost:3000`.

Opcional — para traducción automática y extracción de PDF de bordado, copiá `.env.example` a `.env.local` y agregá tu API key de Anthropic. El resto de la app funciona igual sin ella.

## Uso rápido

1. Elegí el tipo de prenda (por ahora: Gorra — más tipos en el [roadmap](#roadmap)).
2. Elegí en qué idiomas exportar (ES/EN/ZH).
3. Completá marca, temporada, código de estilo, fábrica.
4. Activá/editá las piezas de construcción (tela, cierre, paneles, etc.).
5. Agregá uno o más diseños: posición, técnica, colores, imagen de referencia, y ficha de bordado si aplica.
6. En la vista previa, generá el SVG por idioma y copiá/descargá cada página.

## Arquitectura multi-prenda

Toda la data específica de una prenda (piezas por defecto, nombres de piezas en 3 idiomas, posiciones de diseño disponibles, y el diagrama de silueta de 4 vistas con sus callouts) vive en un único archivo bajo `src/garments/`. El motor de wizard, generación de SVG y vista previa son genéricos y leen de ese archivo — no hay nada hardcodeado a "gorra" fuera de `src/garments/cap.js`.

```
src/
├─ core/           # primitivas SVG, i18n base, utilidades de color, helpers, cliente de Claude API
├─ garments/        # un archivo de datos por tipo de prenda + registry
│  ├─ cap.js        # unico tipo soportado en v0.1
│  └─ index.js
├─ components/       # UI del wizard (editor de colores, uploader de imagen, ficha de bordado, modal SVG, preview)
├─ pages/            # generadores de SVG (independientes de React)
└─ App.jsx           # wizard que conecta todo lo anterior
```

Agregar una prenda nueva = copiar `cap.js`, completar los mismos campos, y registrarla. Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Diseño y UX

La interfaz sigue un sistema de diseño **Bauhaus** donde el color codifica
prioridad de atención (rojo = índices numéricos, azul = bloques de prioridad,
amarillo = highlights críticos), pensado desde el lector real de una ficha
técnica: **la fábrica** — que la imprime, la fotocopia en blanco y negro y la lee
en otro idioma. Todo está codificado en un solo `tokens.js` que alimenta la
interfaz y el SVG generado.

El porqué de cada decisión (impresión, escala de grises, tipografía mono para
datos, la retícula ligada al motor flexbox) está justificado en
**[docs/UX-DESIGN.md](docs/UX-DESIGN.md)**.

El motor de layout (grid, alineación, espacio en blanco y el compositor
row-vs-stack) se desarrolla y prueba de forma aislada con un banco de pruebas
visual — **[docs/layout-lab/](docs/layout-lab/README.md)** — que renderiza el
compositor real contra entradas fijas, sin IA ni el wizard. _(Docs going
forward are written in English.)_

## Roadmap

- [x] v0.1 — arquitectura multi-prenda + Gorra como primer tipo completo
- [ ] v0.2 — Camiseta, Hoodie, Polo
- [ ] v0.3 — export PDF multi-página, guardar/cargar ficha como JSON

Detalle completo en [ROADMAP.md](ROADMAP.md).

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md) — agregar un tipo de prenda nuevo es la forma más directa de contribuir. Antes de participar, revisá el [Código de Conducta](CODE_OF_CONDUCT.md).

## Tecnologías

- React 18 + Vite 5
- SVG generado 100% en cliente (sin dependencias de canvas/render externo)
- DeepSeek (vía API OpenAI-compatible de NVIDIA) para el intake asistido y la traducción — a través de un proxy backend, nunca directo desde el navegador
- Serverless en Vercel (`api/deepseek.js`) para custodiar la API key del lado servidor

## ¿Necesitás la ficha técnica de tu marca ya armada, no la herramienta?

Este repo es la base open source que usamos en [Morfe](https://github.com/morfemartin) para nuestro propio pipeline de lanzamiento de marcas de ropa (branding, desarrollo textil, fichas técnicas y web). Si preferís que te lo hagamos nosotros de punta a punta, [contactanos](https://github.com/morfemartin).

## Seguridad

La API key de DeepSeek/NVIDIA **nunca** vive en el repositorio ni llega al
navegador: todas las llamadas de IA pasan por un proxy serverless
(`api/deepseek.js`) que adjunta la key del lado servidor. Los archivos `.env*`
están gitignoreados, hay escaneo de secretos (gitleaks + push protection de
GitHub) y Dependabot vigilando dependencias. Detalle completo y política de
reporte en [SECURITY.md](SECURITY.md).

## Licencia

MIT — ver [LICENSE](LICENSE).
