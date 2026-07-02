# TechPack AI Builder 🧵

Open-source wizard that generates professional, print-ready fashion **tech packs** (fichas técnicas) as SVG — no design software required. Built by [Morfe](https://github.com/morfemartin), a branding + textile development agency, to run our own production pipeline in the open.

> Turn a brand's parts list, colorways, and embroidery specs into a multi-page, artboard-ready technical sheet in minutes, in Spanish, English and/or Chinese.

---

## Índice

- [Sobre el proyecto](#sobre-el-proyecto)
- [Características](#características)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Arquitectura multi-prenda](#arquitectura-multi-prenda)
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
- Cada página se genera como un SVG independiente, descargable o copiable — pensado para abrir como artboards separados en Illustrator.
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
- Claude API (Anthropic) para traducción y extracción de datos de PDF — opcional

## ¿Necesitás la ficha técnica de tu marca ya armada, no la herramienta?

Este repo es la base open source que usamos en [Morfe](https://github.com/morfemartin) para nuestro propio pipeline de lanzamiento de marcas de ropa (branding, desarrollo textil, fichas técnicas y web). Si preferís que te lo hagamos nosotros de punta a punta, [contactanos](https://github.com/morfemartin).

## Licencia

MIT — ver [LICENSE](LICENSE).
