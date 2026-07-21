import { describe, expect, it } from "vitest"
import { ILLUSTRATOR_LAYERS, buildMultiArtboardSvg, illustratorLayerReport, prepareIllustratorSvg, prepareIllustratorSvgWithAssets } from "./illustratorSvg.js"

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

  it("removes redundant clip paths that block Illustrator batch import", () => {
    const clipped = SOURCE.replace("<g id='ARTWORK'>", "<defs><clipPath id='clip'><rect width='10' height='10'/></clipPath></defs><g id='ARTWORK' clip-path='url(#clip)'>")
    const result = prepareIllustratorSvg(clipped)
    expect(result).not.toContain("clipPath")
    expect(result).not.toContain("clip-path")
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

  it("can externalize embedded images into named package assets", () => {
    const withImages = SOURCE
      .replace("<g id='ARTWORK'>", "<g id='ARTWORK'><image id='REFERENCE__LOGO_HEADER' data-asset-role='logo' data-asset-label='logo-header' href='data:image/png;base64,QUJD'/>")
      .replace("</svg>", "<image data-asset-role='reference' data-asset-label='Logo pecho.png' href='data:image/svg+xml;base64,PHN2Zy8+'/></svg>")
    const result = prepareIllustratorSvgWithAssets(withImages, { id: "p1", title: "Logo Pecho", pageNumber: 9, totalPages: 11 })
    expect(result.assets.map((asset) => asset.file)).toEqual([
      "assets/P09--logo-pecho--logo--logo-header-01.png",
      "assets/P09--logo-pecho--reference--logo-pecho-png-02.svg",
    ])
    expect(result.svg).toContain('href="../assets/P09--logo-pecho--logo--logo-header-01.png"')
    expect(result.svg).toContain('"linkedAssets"')
    expect(result.svg).not.toContain("data:image/png;base64")
  })
})

describe("XML declaration (Illustrator rejects a malformed prolog)", () => {
  const page = { id: "p1", title: "Pagina", pageNumber: 1, totalPages: 1 }
  const source = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g id='TECH_DATA_X'><rect x='1' y='1' width='2' height='2'/></g></svg>"

  it("emits exactly one declaration, at the very start", () => {
    for (const svg of [prepareIllustratorSvg(source, page), prepareIllustratorSvgWithAssets(source, page).svg]) {
      expect(svg.match(/<\?xml/g)).toHaveLength(1)
      expect(svg.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true)
    }
  })

  // The regression itself: prepareIllustratorSvgWithAssets re-parses the
  // output of prepareIllustratorSvg, which already declares. Keeping the
  // inherited declaration AND prepending a new one produced
  // "<?xml?><?xml?><svg>", which is not well-formed - Illustrator refused
  // every page of the export package with a flat "invalid SVG".
  it("does not inherit a second declaration when re-preparing prepared output", () => {
    const once = prepareIllustratorSvg(source, page)
    const twice = prepareIllustratorSvgWithAssets(once, page).svg
    expect(twice.match(/<\?xml/g)).toHaveLength(1)
  })
})

describe("buildMultiArtboardSvg (one file, every page)", () => {
  const page = (n) => ({
    id: "p" + n,
    title: "Pagina " + n,
    svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1188 840'>" +
      "<g id='TECH_DATA_" + n + "'><rect x='10' y='10' width='100' height='50'/></g>" +
      "<g id='PAGE_CHROME_" + n + "'><rect x='0' y='0' width='60' height='20'/></g></svg>",
  })
  const pages = [page(1), page(2), page(3)]

  it("lays the pages out as a grid, not one long strip", () => {
    // 3 pages -> 2 columns x 2 rows: 2*1188 + 80 wide, 2*840 + 80 tall.
    // A single row of 11 pages is a 13868px canvas that opens unreadably
    // zoomed out; a grid keeps a workable aspect ratio.
    const svg = buildMultiArtboardSvg(pages, { gap: 80 })
    expect(svg).toContain('viewBox="0 0 2456 1760"')
    expect(svg.match(/<\?xml/g)).toHaveLength(1)
  })

  it("honours an explicit column count", () => {
    const svg = buildMultiArtboardSvg(pages, { gap: 80, columns: 3 })
    expect(svg).toContain('viewBox="0 0 3724 840"')
  })

  it("hoists the semantic layers to document level, spanning every page", () => {
    const report = illustratorLayerReport(buildMultiArtboardSvg(pages))
    const techData = report.find((l) => l.name === "TECH_DATA")
    // one holder group per page inside the single document-level layer
    expect(techData.present).toBe(true)
    expect(techData.childCount).toBe(3)
    // and the layer appears once, not once per page
    expect(report.filter((l) => l.name === "TECH_DATA")).toHaveLength(1)
  })

  it("offsets each page into its grid cell and emits one artboard rectangle per page", () => {
    const svg = buildMultiArtboardSvg(pages, { gap: 80 })
    expect(svg.match(/id="ARTBOARD_\d+"/g)).toHaveLength(3)
    expect(svg).toContain('translate(0 0)')      // row 1, col 1
    expect(svg).toContain('translate(1268 0)')   // row 1, col 2
    expect(svg).toContain('translate(0 920)')    // row 2, col 1
  })

  it("keeps the artboard rectangles selectable so they can be converted", () => {
    // fill:none would make them unpickable and "Convert to Artboards" would
    // have nothing to act on.
    const svg = buildMultiArtboardSvg(pages)
    expect(svg).toMatch(/id="ARTBOARD_01"[^>]*fill="#FFFFFF"/)
    expect(svg).toMatch(/id="ARTBOARD_01"[^>]*fill-opacity="0"/)
  })

  it("refuses to build from nothing rather than emitting an empty document", () => {
    expect(() => buildMultiArtboardSvg([])).toThrow(/at least one page/i)
  })
})
