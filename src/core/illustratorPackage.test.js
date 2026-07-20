import { describe, expect, it } from "vitest"
import JSZip from "jszip"
import { createIllustratorArchive, illustratorPageFilename } from "./illustratorPackage.js"

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1188 840' width='297mm' height='210mm'><rect width='1188' height='840'/></svg>"

describe("Illustrator package", () => {
  it("uses physical order and stable named page files", () => {
    expect(illustratorPageFilename({ title: "Indice de producción" }, 1)).toBe("P02--indice-de-produccion.svg")
  })

  it("contains every editable page, manifest and importer", async () => {
    const archive = await createIllustratorArchive([
      { id: "cover", title: "Portada", svg: SVG },
      { id: "index", title: "Indice", svg: SVG },
    ], "#target illustrator")
    const bytes = await archive.generateAsync({ type: "uint8array" })
    const loaded = await JSZip.loadAsync(bytes)
    expect(Object.keys(loaded.files)).toEqual(expect.arrayContaining([
      "pages/P01--portada.svg",
      "pages/P02--indice.svg",
      "manifest.json",
      "Techpack-Import-Illustrator.jsx",
      "ABRIR-EN-ILLUSTRATOR.txt",
    ]))
    const manifest = JSON.parse(await loaded.file("manifest.json").async("string"))
    expect(manifest.artboardOrder.map((entry) => entry.id)).toEqual(["cover", "index"])
  })
})
