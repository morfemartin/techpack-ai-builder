// ─────────────────────────────────────────────────────────────────────────
// LAYOUT LAB · Fixtures de plan (Fase 1 — sistema de diseño aislado)
//
// Cada fixture fija un PLAN a mano contra un dataset, para aislar y verificar
// UN comportamiento del motor de layout de forma determinística. El campo
// `tests` dice qué estresa; `expected` dice qué debería verse. Esto NO es el
// producto final (ese plan lo hará la IA en Fase 2) — es un banco de pruebas.
// ─────────────────────────────────────────────────────────────────────────

export const FIXTURES = [
  {
    id: "A-split-row",
    dataset: "parka",
    title: "A · Split en FILA (contenido llena la columna)",
    tests: "split[ partsList angosto | ilustración ancha ] con 16 piezas reales.",
    expected: "Dos columnas lado a lado: la tabla llena su alto, sin espacio muerto. NO debe apilar.",
    plan: {
      pages: [
        {
          id: "parka-overview",
          title: "Estructura general",
          purpose: "overview",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "partsList", weight: 34 },
                {
                  type: "illustration",
                  weight: 66,
                  slots: 2,
                  refs: ["Frente cerrado", "Espalda"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "B-split-stack",
    dataset: "bikini",
    title: "B · Split que APILA (contenido corto)",
    tests: "split[ partsList 1-2 filas | ilustración ] — reproduce el caso del bug reportado.",
    expected: "Ilustración arriba a todo el ancho; specs abajo como franja compacta a su alto natural.",
    plan: {
      pages: [
        {
          id: "bikini-label",
          title: "Etiqueta / print",
          purpose: "overview",
          pieces: ["top"],
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "partsList", weight: 30 },
                {
                  type: "illustration",
                  weight: 70,
                  slots: 2,
                  refs: ["Vista frontal plana", "Detalle print engineered"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "C-colorspecs-heavy",
    dataset: "skirt",
    title: "C · colorSpecs pesado (10 colorways) en fila",
    tests: "split[ colorSpecs 10 colores | ilustración ] — columna de color alta.",
    expected: "Fila: la carta de 10 colores ocupa su columna completa junto al plisado. NO apila.",
    plan: {
      pages: [
        {
          id: "skirt-colors",
          title: "Carta de color",
          purpose: "design:Carta de color completa",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "colorSpecs", weight: 38 },
                {
                  type: "illustration",
                  weight: 62,
                  slots: 2,
                  refs: ["Frente plisado", "Vista 3/4"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "C2-colorspecs-short",
    dataset: "skirt",
    title: "C2 · colorSpecs corto (2 colores) → sigue en FILA",
    tests: "misma página que C pero con la cápsula de 2 tonos.",
    expected:
      "Columna lateral con algo de espacio debajo — a propósito. Las cartas de color NO apilan a ancho completo (ver STACKABLE_TYPES); ese es su idioma de ficha.",
    plan: {
      pages: [
        {
          id: "skirt-capsule",
          title: "Cápsula 2 tonos",
          purpose: "design:Cápsula 2 tonos",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "colorSpecs", weight: 38 },
                {
                  type: "illustration",
                  weight: 62,
                  slots: 2,
                  refs: ["Frente plisado", "Vista 3/4"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "D-embspecs-heavy",
    dataset: "hoodie",
    title: "D · embSpecs pesado + ilustración en fila",
    tests: "split[ embSpecs (14 campos + secuencia de 6 paradas) | ilustración ].",
    expected: "Fila: ficha de bordado ocupa su columna completa; se ven las 6 paradas.",
    plan: {
      pages: [
        {
          id: "hoodie-emb",
          title: "Bordado de pecho",
          purpose: "design:Bordado pecho denso",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "embSpecs", weight: 40 },
                {
                  type: "illustration",
                  weight: 60,
                  slots: 1,
                  refs: ["Ubicación bordado"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "E-illustration-grid",
    dataset: "varsity",
    title: "E · Ilustración multi-slot (4 vistas) + specs corto",
    tests: "illustration slots=4 (grilla 2x2) + partsList corto debajo.",
    expected: "Grilla 2x2 de vistas a todo el ancho; tabla corta apilada abajo a su alto natural.",
    plan: {
      pages: [
        {
          id: "varsity-views",
          title: "Vistas técnicas",
          purpose: "overview",
          pieces: ["ribcollar", "ribcuff", "ribhem"],
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "partsList", weight: 28 },
                {
                  type: "illustration",
                  weight: 72,
                  slots: 4,
                  refs: ["Frente", "Espalda", "Manga cuero", "Detalle rib"],
                  note: "",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "F-pagination",
    dataset: "parka",
    title: "F · Paginación de BOM (16 piezas, columna corta)",
    tests: "ilustración grande arriba + partsList en la banda inferior (capacidad ~8 filas).",
    expected: "El BOM se parte en página + '(cont.)', numeración continua 1..16 sin perder filas.",
    plan: {
      pages: [
        {
          id: "parka-bom",
          title: "BOM completo",
          purpose: "structure",
          regions: [
            { type: "header", weight: 8 },
            { type: "titleBar", weight: 5 },
            { type: "illustration", weight: 48, slots: 2, refs: ["Frente", "Espalda"], note: "" },
            { type: "partsList", weight: 31 },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "G-note-block",
    dataset: "bikini",
    title: "G · Bloque note + ilustración (whole-garment)",
    tests: "página con note (instrucción) + ilustración a ancho completo.",
    expected: "Banda de nota con acento amarillo arriba; ilustración grande debajo. Sin split.",
    plan: {
      pages: [
        {
          id: "bikini-note",
          title: "Instrucciones de sublimado",
          purpose: "design:Print all-over sublimado",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 6 },
            { type: "note", note: "Print engineered al molde: el patrón debe continuar sobre las costuras laterales. Zona de forro frontal SIN print. Verificar registro antes de corte.", weight: 14 },
            { type: "illustration", weight: 62, slots: 2, refs: ["Top plano", "Banda inferior"], note: "" },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "H-full-document",
    dataset: "varsity",
    title: "H · Documento completo multi-página (varsity)",
    tests: "4 páginas encadenadas: overview + 3 diseños (parche, letra bordada, label).",
    expected: "Documento coherente página a página; cada diseño usa su propia data (color/emb).",
    plan: {
      pages: [
        {
          id: "varsity-overview",
          title: "Estructura general",
          purpose: "overview",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "partsList", weight: 32 },
                { type: "illustration", weight: 68, slots: 2, refs: ["Frente", "Espalda"], note: "" },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
        {
          id: "varsity-patch",
          title: "Parche chenille espalda",
          purpose: "design:Parche chenille espalda",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "colorSpecs", weight: 32 },
                { type: "illustration", weight: 68, slots: 1, refs: ["Ubicación parche"], note: "" },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
        {
          id: "varsity-letter",
          title: "Letra bordada pecho",
          purpose: "design:Letra bordada pecho",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "embSpecs", weight: 40 },
                { type: "illustration", weight: 60, slots: 1, refs: ["Ubicación letra"], note: "" },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
        {
          id: "varsity-label",
          title: "Label tejida interior",
          purpose: "design:Label tejida interior",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            {
              type: "split",
              weight: 77,
              regions: [
                { type: "colorSpecs", weight: 30 },
                { type: "illustration", weight: 70, slots: 1, refs: ["Detalle cuello interior"], note: "" },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "I-measure-pass",
    dataset: "bikini",
    title: "I · Measure pass · bounded content returns slack",
    tests: "illustration absorber + a one-piece BOM measured at its natural height.",
    expected: "The parts table is a compact bottom strip; all remaining height belongs to the illustration, with no internal dead band.",
    plan: {
      pages: [
        {
          id: "measure-pass",
          title: "Measure pass",
          purpose: "overview",
          pieces: ["top"],
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            { type: "illustration", weight: 70, slots: 2, refs: ["Front", "Back"] },
            { type: "partsList", weight: 10 },
            { type: "disclaimer", weight: 5 },
          ],
        },
      ],
    },
  },

  {
    id: "J-contract-repair",
    dataset: "hoodie",
    title: "J · Contract repair · malformed design page",
    tests: "a design page missing chrome/illustration and incorrectly repeating the BOM.",
    expected: "Diagnostics show dropped partsList plus inserted mandatory regions; the rendered page is contract-clean.",
    contractRepair: true,
    plan: {
      pages: [
        {
          id: "repair-hoodie-emb",
          title: "Bordado pecho denso",
          purpose: "design:Bordado pecho denso",
          regions: [
            { type: "partsList", weight: 35 },
            { type: "embSpecs", weight: 40 },
          ],
        },
      ],
    },
  },

  {
    id: "K-per-slot-briefs",
    dataset: "parka",
    title: "K · Structured briefs · one brief per slot",
    tests: "two illustration slots carry different structured instructions.",
    expected: "Front and close-up boards each show their own view, must-mark checklist, placement and measurement guidance.",
    plan: {
      pages: [
        {
          id: "briefs-parka-print",
          title: "Print espalda topográfico",
          purpose: "design:Print espalda topográfico",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            { type: "colorSpecs", weight: 20 },
            {
              type: "illustration",
              weight: 57,
              slots: 2,
              refs: ["Back placement", "Seam close-up"],
              briefs: [
                {
                  garmentPart: "Back shell",
                  view: "Back placement",
                  mustMark: ["neck seam landmark", "print boundary"],
                  measurements: [{ label: "40mm below neck seam", perSize: false }],
                  placementLandmark: "Centered on back neck seam",
                  factoryNote: "Keep artwork clear of ventilation opening",
                },
                {
                  garmentPart: "Side seam",
                  view: "Seam close-up",
                  mustMark: ["artwork continuation", "registration notch"],
                  measurements: [{ label: "bleed allowance", perSize: false }],
                  placementLandmark: "Match front and back pattern notches",
                  factoryNote: "Approve print registration before cutting",
                },
              ],
            },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },

  {
    id: "L-review-diff",
    dataset: "varsity",
    title: "L · Review diff · omitted design pages",
    tests: "intake truth contains three designs while the sample document only carries cover + overview.",
    expected: "The diagnostic lists every unplaced design before export while confirmed header/BOM data remains summarized.",
    reviewSample: true,
    plan: {
      pages: [
        {
          id: "review-cover",
          title: "Varsity cover",
          purpose: "cover",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            { type: "illustration", weight: 77, slots: 1, refs: ["Hero view"] },
            { type: "disclaimer", weight: 8 },
          ],
        },
        {
          id: "review-overview",
          title: "Varsity overview",
          purpose: "overview",
          regions: [
            { type: "header", weight: 10 },
            { type: "titleBar", weight: 5 },
            { type: "illustration", weight: 50, slots: 2, refs: ["Front", "Back"] },
            { type: "partsList", weight: 27 },
            { type: "disclaimer", weight: 8 },
          ],
        },
      ],
    },
  },
]
