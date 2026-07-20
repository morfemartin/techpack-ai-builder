import { describe, expect, it } from "vitest"
import { effectiveParts, partsCapacityForHeight, partsRowMetrics, partsTableLayout, partsTableMetrics } from "./tableMetrics.js"

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
})
