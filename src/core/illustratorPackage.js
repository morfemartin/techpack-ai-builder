import { prepareIllustratorSvg } from "./illustratorSvg.js"

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
// a manifest.json, an assets/ folder and a .txt instructions file; none of
// it was read by the script, so it was just clutter in the unzipped folder.
export async function createIllustratorArchive(pages, importerScript) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("Illustrator package requires at least one page")
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  const folder = zip.folder("pages")
  pages.forEach((page, index) => {
    const file = illustratorPageFilename(page, index)
    const prepared = prepareIllustratorSvg(page.svg, { ...page, pageNumber: index + 1, totalPages: pages.length })
    folder.file(file, prepared)
  })
  zip.file("Techpack-Import-Illustrator.jsx", importerScript)
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
