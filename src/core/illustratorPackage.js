import { prepareIllustratorSvg } from "./illustratorSvg.js"
import { loadLazyModule } from "./lazyModule.js"

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

// Techpack-Import-Illustrator.jsx opens each page as its OWN document (Adobe
// scripting works off File/Folder objects, not a single in-memory document
// with everything already merged) and fuses them into one .ai from inside
// Illustrator - that fusion step is what promotes the seven id-tagged groups
// to real native layers. Illustrator discards those ids on straight SVG
// import (confirmed live: opening either the per-page or the single
// multi-artboard SVG directly always collapses to one layer), so the script
// is not an optional extra - it is the only path to native layers at all.
//
// The script needs exactly `pages/*.svg` (self-contained, one per page) plus
// itself next to that folder - nothing else. The package used to also carry
// a manifest.json and an assets/ folder; neither was read by the script, so
// they were just clutter in the unzipped folder.
//
// LEEME.txt is different in kind, not a re-introduction of that clutter: it
// carries the run-the-script instructions for the HUMAN who unzipped this,
// not data for the script to read. The modal shows the same steps while the
// app is open, but the ZIP can sit in a Downloads folder for days before
// someone gets to it - at that point the app's own instructions are gone,
// this file isn't.
function buildReadme(pageCount) {
  return [
    "TechPack AI Builder - paquete para Illustrator",
    "",
    "1. Descomprimi este ZIP (dejando pages/ y este script en la misma carpeta).",
    "2. En Illustrator: Archivo > Secuencias de comandos > Otra secuencia de comandos... y elegi Techpack-Import-Illustrator.jsx.",
    "3. El script arma un solo archivo Techpack-complete.ai con las " + pageCount + " paginas como mesas de trabajo nombradas y las 7 capas nativas reales.",
    "",
    "Affinity: no hace falta el script - abri directamente cualquier SVG de pages/.",
  ].join("\n")
}

export async function createIllustratorArchive(pages, importerScript) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("Illustrator package requires at least one page")
  const { default: JSZip } = await loadLazyModule(() => import("jszip"), { moduleName: "el exportador ZIP" })
  const zip = new JSZip()
  const folder = zip.folder("pages")
  pages.forEach((page, index) => {
    const file = illustratorPageFilename(page, index)
    const prepared = prepareIllustratorSvg(page.svg, { ...page, pageNumber: index + 1, totalPages: pages.length })
    folder.file(file, prepared)
  })
  zip.file("Techpack-Import-Illustrator.jsx", importerScript)
  zip.file("LEEME.txt", buildReadme(pages.length))
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
