import { describe, expect, it } from "vitest"
import { effectiveParts, partsCapacityForHeight, partsRowMetrics, partsTableLayout, partsTableMetrics, sizeChartTableLayout, sizeChartCapacityForHeight } from "./tableMetrics.js"
import { newPom, newSizeChart } from "../core/sizeChart.js"

describe("width-aware BOM metrics", () => {
  const parts = [
    { id: "body", val: "Nylon ripstop de alta densidad con recubrimiento impermeable", on: true },
    { id: "zip", val: "YKK Vislon #8 doble cursor", on: true },
  ]

  it("wraps technical copy and grows the row instead of overflowing its cell", () => {
    const narrow = partsRowMetrics({ parts, partLabels: { body: "Shell exterior tres capas" }, width: 414 })
    const wide = partsRowMetrics({ parts, partLabels: { body: "Shell exterior tres capas" }, width: 556 })
    expect(narrow[0].valueLines.length).toBeGreaterThan(1)
    expect(narrow[0].height).toBeGreaterThanOrEqual(wide[0].height)
    expect(narrow[0].height).toBeGreaterThanOrEqual(18)
  })

  it("keeps single-line rows dense and gives details most of the width", () => {
    const [row] = partsRowMetrics({
      parts: [{ id: "zip", val: "YKK #5", on: true }],
      partLabels: { zip: "Cierre" },
      width: 414,
    })
    expect(row.height).toBe(18)
    expect(row.nameLines).toEqual(["Cierre"])
    expect(row.valueLines).toEqual(["YKK #5"])
  })

  it("chooses the column split that minimizes wrapped table height", () => {
    const layout = partsTableLayout({ parts, partLabels: { body: "Shell exterior tres capas", zip: "Cierre" }, width: 414 })
    expect(layout.columns.value).toBeGreaterThanOrEqual(0.3)
    expect(layout.columns.value).toBeLessThanOrEqual(0.48)
    expect(layout.columns.value).toBe(0.35)
    expect(layout.height).toBe(62)
  })

  it("computes pagination capacity from the exact wrapped row heights", () => {
    const table = partsTableMetrics({ parts, width: 414 })
    const firstOnly = 20 + table.rows[0].height
    expect(partsCapacityForHeight({ parts, width: 414 }, firstOnly)).toBe(1)
    expect(partsCapacityForHeight({ parts, width: 414 }, table.height)).toBe(2)
  })

  it("measures only the pieces assigned to the page", () => {
    expect(effectiveParts(parts, { pieces: ["zip"] }).map((part) => part.id)).toEqual(["zip"])
  })

  // The translated values arrive as ONE flat array covering the whole
  // document (translate.js only ever sends/receives `val` strings, no ids),
  // but a semantic page shows a SUBSET of the BOM. Reading that array by the
  // row's position inside the page therefore pairs a page-specific label with
  // whatever value happens to sit at that index of the FULL document - which
  // is how a real Polo tech pack ended up printing "Marca: Morfe Studio" and
  // "Botones: Polo manga corta". The label already resolves by part.id; the
  // value has to resolve by part.id too.
  it("keeps a translated value with its own part when the page shows a BOM subset", () => {
    const allParts = [
      { id: "body", val: "Nylon ripstop", on: true },
      { id: "zip", val: "YKK Vislon #8", on: true },
      { id: "cuff", val: "Puno elastico", on: true },
    ]
    const txPartsById = new Map([
      ["body", "Ripstop nylon"],
      ["zip", "YKK Vislon #8 slider"],
      ["cuff", "Elastic cuff"],
    ])
    const [row] = partsRowMetrics({
      parts: effectiveParts(allParts, { pieces: ["cuff"] }),
      partLabels: { cuff: "Puno" },
      txPartsById,
      width: 414,
    })
    expect(row.name).toBe("Puno")
    expect(row.value).toBe("Elastic cuff")
  })

  it("still accepts a positional translation array when the page shows the whole BOM", () => {
    const rows = partsRowMetrics({ parts, partLabels: { body: "Shell", zip: "Cierre" }, txParts: ["Shell fabric", "Zipper"], width: 414 })
    expect(rows.map((row) => row.value)).toEqual(["Shell fabric", "Zipper"])
  })
})

describe("sizeChartTableLayout - the real Polo POM table", () => {
  const chart = newSizeChart({
    baseSize: "M",
    poms: [
      newPom({ label: "Medio pecho", unit: "cm", tolerance: 1, values: { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 } }),
      newPom({ label: "Largo de cuerpo", unit: "cm", tolerance: 1, values: { XS: 68, S: 70, M: 72, L: 74, XL: 76, XXL: 78 } }),
    ],
  })

  it("produces one cell per size plus a formatted tolerance, fed by the SAME layout measure.js and buildPages.js both read", () => {
    const layout = sizeChartTableLayout({ chart, outUnit: "cm", width: 700 })
    expect(layout.rows).toHaveLength(2)
    expect(layout.rows[0].cells.map((c) => c.text)).toEqual(["48cm", "51cm", "54cm", "57cm", "60cm", "63cm"])
    expect(layout.rows[0].toleranceText).toBe("±1 cm")
  })

  it("marks an empty cell as pending without inventing a value", () => {
    const sparse = newSizeChart({ poms: [newPom({ label: "Ancho hombros", unit: "cm", values: { M: 47 } })] })
    const layout = sizeChartTableLayout({ chart: sparse, outUnit: "cm", width: 700 })
    const cells = layout.rows[0].cells
    expect(cells.find((c) => c.text === "47cm").pending).toBe(false)
    expect(cells.filter((c) => c.empty)).toHaveLength(sparse.sizes.length - 1)
    expect(cells.filter((c) => c.empty).every((c) => c.pending)).toBe(true)
  })

  it("marks every cell of a derived-unverified row as pending even though every cell is filled", () => {
    const derived = newSizeChart({ poms: [newPom({ label: "Medio pecho", unit: "cm", source: "derived", verified: false, values: { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 } })] })
    const layout = sizeChartTableLayout({ chart: derived, outUnit: "cm", width: 700 })
    expect(layout.rows[0].cells.every((c) => c.pending)).toBe(true)
    expect(layout.rows[0].cells.every((c) => !c.empty)).toBe(true)
  })

  it("marks a suggested-unverified row (an AI-proposed base value) as pending too - held to the same bar as derived", () => {
    const suggested = newSizeChart({ poms: [newPom({ label: "Medio pecho", unit: "cm", source: "suggested", verified: false, values: { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 } })] })
    const layout = sizeChartTableLayout({ chart: suggested, outUnit: "cm", width: 700 })
    expect(layout.rows[0].cells.every((c) => c.pending)).toBe(true)
  })

  it("a verified suggested row prints clean, exactly like a verified derived row", () => {
    const verified = newSizeChart({ poms: [newPom({ label: "Medio pecho", unit: "cm", source: "suggested", verified: true, values: { XS: 48, S: 51, M: 54, L: 57, XL: 60, XXL: 63 } })] })
    const layout = sizeChartTableLayout({ chart: verified, outUnit: "cm", width: 700 })
    expect(layout.rows[0].cells.every((c) => !c.pending)).toBe(true)
  })

  it("converts to the requested output unit, never rewriting the stored value", () => {
    const layout = sizeChartTableLayout({ chart, outUnit: "in", width: 700 })
    // 54cm -> 21.26in
    expect(layout.rows[0].cells[2].text).toBe("21.26in")
    // The source chart itself is untouched.
    expect(chart.poms[0].values.M).toBe(54)
  })

  it("uses fixed equal-width numeric columns - only the label column is content-aware", () => {
    const wide = sizeChartTableLayout({ chart, width: 800 })
    const narrow = sizeChartTableLayout({ chart, width: 400 })
    expect(wide.numericWidth).toBeGreaterThan(narrow.numericWidth)
  })

  it("carries constants (non-graded measurements) through untouched", () => {
    const withConstants = newSizeChart({ poms: chart.poms, constants: [{ label: "Altura del cuello", value: 3.5, unit: "cm" }] })
    const layout = sizeChartTableLayout({ chart: withConstants, width: 700 })
    expect(layout.constants).toHaveLength(1)
    expect(layout.constants[0].label).toBe("Altura del cuello")
  })
})

describe("sizeChartCapacityForHeight", () => {
  const chart = newSizeChart({
    poms: [
      newPom({ label: "Medio pecho", values: { M: 54 } }),
      newPom({ label: "Largo de cuerpo", values: { M: 72 } }),
      newPom({ label: "Ancho hombros", values: { M: 47 } }),
    ],
  })

  it("computes row capacity from the exact wrapped row heights, same contract as partsCapacityForHeight", () => {
    const layout = sizeChartTableLayout({ chart, width: 700 })
    const firstOnly = 20 + layout.rows[0].height
    expect(sizeChartCapacityForHeight({ chart, width: 700 }, firstOnly)).toBe(1)
    expect(sizeChartCapacityForHeight({ chart, width: 700 }, layout.height)).toBe(3)
  })
})
