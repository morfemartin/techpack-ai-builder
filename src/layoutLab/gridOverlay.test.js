import { describe, expect, it } from "vitest"
import { GRID, PAGE, PAGE_BODY } from "../design/metrics.js"
import { gridGeometry, renderGridOverlay } from "./gridOverlay.js"

describe("Layout Lab production-grid overlay", () => {
  it("closes exactly across all eight columns and seven gutters", () => {
    const geometry = gridGeometry()
    expect(geometry.columns).toHaveLength(8)
    expect(geometry.gutters).toHaveLength(7)
    geometry.columns.forEach((column) => expect(column.width).toBe(GRID.column))
    geometry.gutters.forEach((gutter) => expect(gutter.width).toBe(GRID.gutter))
    expect(geometry.columns[0].x).toBe(GRID.margin)
    const last = geometry.columns.at(-1)
    expect(last.x + last.width).toBe(PAGE.width - GRID.margin)
  })

  it("uses exact 16-unit baselines and the same body box as the compositor", () => {
    const geometry = gridGeometry()
    geometry.baselines.slice(1).forEach((baseline, index) => {
      expect(baseline.y - geometry.baselines[index].y).toBe(GRID.baseline)
    })
    expect(geometry.body.width).toBe(PAGE_BODY.width)
    expect(geometry.body.height).toBe(PAGE_BODY.height)
    expect(geometry.body.y % GRID.baseline).toBe(0)
  })

  it("renders crisp non-scaling edges for columns, gutters and baselines", () => {
    const svg = renderGridOverlay()
    expect(svg).toContain('data-grid-role="columns"')
    expect(svg).toContain('data-grid-role="baselines"')
    expect(svg).toContain('vector-effect="non-scaling-stroke"')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })
})
