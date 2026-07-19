import { describe, expect, it } from "vitest"
import { effectiveParts, partsCapacityForHeight, partsRowMetrics, partsTableMetrics } from "./tableMetrics.js"

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
    expect(narrow[0].height).toBeGreaterThanOrEqual(32)
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
