import { describe, expect, it } from "vitest"
import { ILLUSTRATOR_LAYERS, illustratorLayerReport, prepareIllustratorSvg } from "./illustratorSvg.js"

const SOURCE = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1188 840' width='297mm' height='210mm'>" +
  "<metadata>{}</metadata><rect width='1188' height='840' fill='#fff'/>" +
  "<g id='ARTWORK'><text x='20' y='20' font-family='ui-monospace, Menlo' font-size='10' dominant-baseline='central'>V1</text></g>" +
  "<g id='TECH_DATA__BOM'><text x='20' y='40' font-family='Arial' font-size='10'>BOM</text></g>" +
  "<g id='PAGE_CHROME__FOOTER'><text x='20' y='820' font-size='10'>P. 01</text></g></svg>"

describe("prepareIllustratorSvg", () => {
  it("creates the complete named layer contract and Illustrator-safe metadata", () => {
    const result = prepareIllustratorSvg(SOURCE, { id: "sample", title: "Sample", pageNumber: 1, totalPages: 1 })
    const report = illustratorLayerReport(result)
    expect(result).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
    expect(result).toContain('data-export-profile="illustrator-2026"')
    expect(result).toContain("techpack-ai-builder/illustrator-svg/v1")
    expect(report.map((entry) => entry.name)).toEqual(ILLUSTRATOR_LAYERS)
    expect(report.every((entry) => entry.present)).toBe(true)
  })

  it("promotes removable designer communication out of the artwork layer", () => {
    const nested = SOURCE.replace("</g><g id='TECH_DATA__BOM'>", "<g id='DESIGNER_COMMUNICATION'><text x='1' y='1'>Brief</text></g></g><g id='TECH_DATA__BOM'>")
    const result = prepareIllustratorSvg(nested)
    const report = illustratorLayerReport(result)
    expect(report.find((entry) => entry.name === "DESIGNER_COMMUNICATION").childCount).toBe(1)
    expect(result.indexOf("LAYER_05_DESIGNER_COMMUNICATION")).toBeLessThan(result.indexOf("LAYER_07_PAGE_CHROME"))
  })

  it("preserves source fonts and uses explicit cross-editor baselines", () => {
    const withImage = SOURCE.replace("</svg>", "<image href='data:image/png;base64,AAAA'/></svg>")
    const result = prepareIllustratorSvg(withImage)
    expect(result).toContain('font-family="ui-monospace, Menlo"')
    expect(result).not.toContain("dominant-baseline")
    expect(result).toContain('data-source-baseline="central"')
    expect(result).toContain('y="23.5"')
    expect(result).toContain('xlink:href="data:image/png;base64,AAAA"')
  })
})
