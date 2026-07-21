import { describe, expect, it } from "vitest"
import JSZip from "jszip"
import { createIllustratorArchive, illustratorPageFilename } from "./illustratorPackage.js"

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1188 840' width='297mm' height='210mm'><rect width='1188' height='840'/></svg>"
const SVG_WITH_IMAGE = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1188 840' width='297mm' height='210mm'><image data-asset-role='logo' data-asset-label='brand-logo' href='data:image/png;base64,QUJD'/></svg>"

describe("Illustrator package", () => {
  it("uses physical order and stable named page files", () => {
    expect(illustratorPageFilename({ title: "Indice de producción" }, 1)).toBe("P02--indice-de-produccion.svg")
  })

  // Techpack-Import-Illustrator.jsx opens each page as its own document and
  // fuses them from inside Illustrator - that is the only way the seven
  // id-tagged groups become real native layers (Illustrator discards the ids
  // on a plain SVG import). It needs exactly `pages/*.svg` next to itself;
  // nothing else in the package is read by the script, so nothing else
  // belongs in it.
  it("contains only what the importer script needs: pages/*.svg and the script itself", async () => {
    const archive = await createIllustratorArchive([
      { id: "cover", title: "Portada", svg: SVG_WITH_IMAGE },
      { id: "index", title: "Indice", svg: SVG },
    ], "#target illustrator")
    const bytes = await archive.generateAsync({ type: "uint8array" })
    const loaded = await JSZip.loadAsync(bytes)
    expect(Object.keys(loaded.files).sort()).toEqual([
      "Techpack-Import-Illustrator.jsx",
      "pages/",
      "pages/P01--portada.svg",
      "pages/P02--indice.svg",
    ])
  })

  it("keeps each page self-contained - images embedded inline, no external assets folder to lose", async () => {
    const archive = await createIllustratorArchive([{ id: "cover", title: "Portada", svg: SVG_WITH_IMAGE }], "#target illustrator")
    const bytes = await archive.generateAsync({ type: "uint8array" })
    const loaded = await JSZip.loadAsync(bytes)
    const pageSvg = await loaded.file("pages/P01--portada.svg").async("string")
    expect(pageSvg).toContain("data:image/png;base64")
  })
})
