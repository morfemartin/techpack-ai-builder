import { prepareIllustratorSvgWithAssets } from "./illustratorSvg.js"

function slug(value) {
  return String(value || "page")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "page"
}

export function illustratorPageFilename(page, index) {
  const number = String(index + 1).padStart(2, "0")
  return "P" + number + "--" + slug(page.title || page.name || page.id) + ".svg"
}

export async function createIllustratorArchive(pages, importerScript) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("Illustrator package requires at least one page")
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  const folder = zip.folder("pages")
  const assetsFolder = zip.folder("assets")
  const assetEntries = []
  const entries = pages.map((page, index) => {
    const file = illustratorPageFilename(page, index)
    const prepared = prepareIllustratorSvgWithAssets(page.svg, { ...page, pageNumber: index + 1, totalPages: pages.length }, {
      assetPathPrefix: "../assets/",
    })
    folder.file(file, prepared.svg)
    prepared.assets.forEach((asset) => {
      assetsFolder.file(asset.filename, asset.base64, { base64: true })
      assetEntries.push({
        pageFile: "pages/" + file,
        file: asset.file,
        mime: asset.mime,
      })
    })
    return {
      file: "pages/" + file,
      id: page.id,
      title: page.title,
      purpose: page.purpose,
      pageNumber: index + 1,
      totalPages: pages.length,
    }
  })
  zip.file("manifest.json", JSON.stringify({
    schema: "techpack-ai-builder/illustrator-package/v1",
    artboardOrder: entries,
    assets: assetEntries,
    layersBottomToTop: ["PAGE_BACKGROUND", "ARTWORK", "REFERENCES", "TECH_DATA", "DESIGNER_COMMUNICATION", "CALLOUTS", "PAGE_CHROME"],
  }, null, 2) + "\n")
  zip.file("Techpack-Import-Illustrator.jsx", importerScript)
  zip.file("ABRIR-EN-ILLUSTRATOR.txt", [
    "TECHPACK AI BUILDER - PAQUETE ILLUSTRATOR",
    "",
    "1. Descomprime este ZIP completo.",
    "2. En Illustrator abre Archivo > Secuencias de comandos > Otra secuencia de comandos.",
    "3. Selecciona Techpack-Import-Illustrator.jsx.",
    "4. El script crea un solo AI con una mesa nombrada por pagina y siete capas semanticas.",
    "5. Las imagenes se incluyen en assets/ con nombres legibles y el script las incrusta en el AI final.",
    "",
    "Affinity: abre los SVG desde pages/ manteniendo la carpeta assets/ al lado del ZIP descomprimido.",
  ].join("\n"))
  return zip
}

export async function buildIllustratorPackageBlob(pages, importerScript) {
  const archive = await createIllustratorArchive(pages, importerScript)
  return archive.generateAsync({
    type: "blob",
    mimeType: "application/zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
}
