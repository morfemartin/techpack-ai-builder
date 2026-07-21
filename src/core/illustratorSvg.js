import { DOMParser, XMLSerializer } from "@xmldom/xmldom"

const SVG_NS = "http://www.w3.org/2000/svg"
const XLINK_NS = "http://www.w3.org/1999/xlink"
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"

export const ILLUSTRATOR_LAYERS = [
  "PAGE_BACKGROUND",
  "ARTWORK",
  "REFERENCES",
  "TECH_DATA",
  "DESIGNER_COMMUNICATION",
  "CALLOUTS",
  "PAGE_CHROME",
]

function layerFor(node) {
  const id = String(node.getAttribute && node.getAttribute("id") || "").toUpperCase()
  if (node.nodeName === "rect" && !id) return "PAGE_BACKGROUND"
  if (id.startsWith("PAGE_CHROME")) return "PAGE_CHROME"
  if (id.startsWith("ARTWORK")) return "ARTWORK"
  if (id.startsWith("REFERENCE")) return "REFERENCES"
  if (id.startsWith("TECH_DATA")) return "TECH_DATA"
  if (id.startsWith("DESIGNER_COMMUNICATION") || id.startsWith("ILLUSTRATOR_INSTRUCTIONS")) return "DESIGNER_COMMUNICATION"
  if (id.startsWith("CALLOUT")) return "CALLOUTS"
  return "TECH_DATA"
}

function collectElements(root, tagName) {
  return Array.from(root.getElementsByTagName(tagName))
}

function explicitBaselineOffset(fontFamily, fontSize) {
  const mono = /ui-monospace|menlo|consolas|courier/i.test(String(fontFamily || ""))
  return fontSize * (mono ? 0.35 : 0.36)
}

function slug(value) {
  return String(value || "asset")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "asset"
}

function extensionForMime(mime) {
  if (/svg\+xml/i.test(mime)) return "svg"
  if (/jpe?g/i.test(mime)) return "jpg"
  if (/webp/i.test(mime)) return "webp"
  if (/gif/i.test(mime)) return "gif"
  return "png"
}

// Exactly one XML declaration, always at the very start of the file.
//
// prepareIllustratorSvgWithAssets re-parses prepareIllustratorSvg's output,
// which already carries a declaration; the serializer kept it and the caller
// prepended a second one. Two declarations is not well-formed XML, so
// Illustrator refused every page in the export package with a flat "invalid
// SVG" - while the single-file path, which only declares once, opened fine.
const XML_DECLARATION = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"

function withXmlDeclaration(serialized) {
  return XML_DECLARATION + String(serialized).replace(/^\s*(?:<\?xml[^>]*\?>\s*)+/i, "")
}

function parseSvg(svg) {
  const errors = []
  const doc = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(svg, "image/svg+xml")
  if (errors.length || !doc.documentElement || doc.documentElement.nodeName !== "svg") {
    throw new Error("Invalid SVG XML: " + (errors[0] || "missing svg root"))
  }
  return doc
}

function prepend(root, node) {
  root.insertBefore(node, root.firstChild)
}

export function prepareIllustratorSvg(svg, page = {}) {
  const doc = parseSvg(svg)
  const root = doc.documentElement
  root.setAttribute("version", "1.1")
  root.setAttribute("baseProfile", "full")
  root.setAttribute("xml:space", "preserve")
  root.setAttribute("xmlns:xlink", XLINK_NS)
  root.setAttribute("xmlns:inkscape", INKSCAPE_NS)
  root.setAttribute("data-export-profile", "illustrator-2026")

  collectElements(root, "metadata").forEach((node) => node.parentNode.removeChild(node))
  collectElements(root, "title").forEach((node) => node.parentNode.removeChild(node))
  collectElements(root, "desc").forEach((node) => node.parentNode.removeChild(node))

  const title = doc.createElementNS(SVG_NS, "title")
  title.setAttribute("id", "DOCUMENT_TITLE")
  title.appendChild(doc.createTextNode(page.title || page.name || "Tech pack page"))
  prepend(root, title)

  const desc = doc.createElementNS(SVG_NS, "desc")
  desc.setAttribute("id", "DOCUMENT_DESCRIPTION")
  desc.appendChild(doc.createTextNode("A4 landscape technical document prepared for Adobe Illustrator 2026."))
  root.insertBefore(desc, title.nextSibling)

  const metadata = doc.createElementNS(SVG_NS, "metadata")
  metadata.setAttribute("id", "TECHPACK_METADATA")
  metadata.appendChild(doc.createCDATASection(JSON.stringify({
    schema: "techpack-ai-builder/illustrator-svg/v1",
    id: page.id || null,
    title: page.title || null,
    purpose: page.purpose || null,
    pageNumber: page.pageNumber || 1,
    totalPages: page.totalPages || 1,
    physicalSize: "297mm x 210mm",
    viewBox: root.getAttribute("viewBox"),
    layers: ILLUSTRATOR_LAYERS,
  })))
  root.insertBefore(metadata, desc.nextSibling)

  collectElements(root, "text").forEach((node) => {
    if (node.getAttribute("dominant-baseline") !== "central") return
    const y = Number(node.getAttribute("y"))
    const fontSize = Number(node.getAttribute("font-size"))
    if (!Number.isFinite(y) || !Number.isFinite(fontSize)) return
    const baseline = y + explicitBaselineOffset(node.getAttribute("font-family"), fontSize)
    node.setAttribute("y", String(Math.round(baseline * 100) / 100))
    node.setAttribute("data-source-baseline", "central")
    node.removeAttribute("dominant-baseline")
  })

  collectElements(root, "image").forEach((node) => {
    const href = node.getAttribute("href")
    if (href) node.setAttributeNS(XLINK_NS, "xlink:href", href)
  })

  // Illustrator 30.4 presents a blocking TinySVG warning for every clipPath.
  // Layout text is already measured and wrapped inside its artboard, so the
  // Adobe interchange profile removes these redundant import-time clips.
  collectElements(root, "g").forEach((node) => node.removeAttribute("clip-path"))
  collectElements(root, "clipPath").forEach((node) => node.parentNode.removeChild(node))
  collectElements(root, "defs").forEach((node) => {
    if (!Array.from(node.childNodes).some((child) => child.nodeType === 1)) node.parentNode.removeChild(node)
  })

  const defs = Array.from(root.childNodes).filter((node) => node.nodeType === 1 && node.nodeName === "defs")
  const promoted = collectElements(root, "g").filter((node) => {
    const category = layerFor(node)
    return category === "DESIGNER_COMMUNICATION" || category === "REFERENCES" || category === "CALLOUTS"
  }).filter((node) => {
    let parent = node.parentNode
    while (parent && parent !== root) {
      if (parent.nodeName === "g" && layerFor(parent) === layerFor(node)) return false
      parent = parent.parentNode
    }
    return parent === root
  })
  const content = Array.from(root.childNodes).filter((node) => {
    if (node.nodeType !== 1) return false
    return !["title", "desc", "metadata", "defs"].includes(node.nodeName)
  })
  const wrappers = new Map()
  ILLUSTRATOR_LAYERS.forEach((name, index) => {
    const group = doc.createElementNS(SVG_NS, "g")
    group.setAttribute("id", "LAYER_" + String(index + 1).padStart(2, "0") + "_" + name)
    group.setAttribute("data-layer-name", name)
    group.setAttribute("inkscape:groupmode", "layer")
    group.setAttribute("inkscape:label", String(index + 1).padStart(2, "0") + " " + name)
    wrappers.set(name, group)
  })

  promoted.forEach((node) => wrappers.get(layerFor(node)).appendChild(node))
  content.forEach((node) => wrappers.get(layerFor(node)).appendChild(node))
  defs.forEach((node) => root.appendChild(node))
  ILLUSTRATOR_LAYERS.forEach((name) => root.appendChild(wrappers.get(name)))

  let groupIndex = 1
  collectElements(root, "g").forEach((node) => {
    if (!node.getAttribute("id")) {
      node.setAttribute("id", "OBJECT_GROUP_" + String(groupIndex).padStart(3, "0"))
      groupIndex++
    }
  })

  return withXmlDeclaration(new XMLSerializer().serializeToString(doc))
}

export function prepareIllustratorSvgWithAssets(svg, page = {}, options = {}) {
  const doc = parseSvg(prepareIllustratorSvg(svg, page))
  const root = doc.documentElement
  const assetPathPrefix = options.assetPathPrefix || "../assets/"
  const pageNumber = String(page.pageNumber || options.pageNumber || 1).padStart(2, "0")
  const pageSlug = slug(page.title || page.name || page.id || "page")
  const assets = []

  collectElements(root, "image").forEach((node, index) => {
    const href = node.getAttribute("href") || node.getAttributeNS(XLINK_NS, "href") || ""
    const match = href.match(/^data:([^;,]+)(?:;[^,]*)?,([A-Za-z0-9+/=\s]+)$/)
    if (!match) {
      const existing = node.getAttribute("data-asset-label") || node.getAttribute("id") || "linked-image"
      node.setAttribute("data-asset-name", existing)
      return
    }
    const mime = match[1]
    const base64 = match[2].replace(/\s+/g, "")
    const role = slug(node.getAttribute("data-asset-role") || "image")
    const label = slug(node.getAttribute("data-asset-label") || node.getAttribute("id") || ("image-" + (index + 1)))
    const filename = "P" + pageNumber + "--" + pageSlug + "--" + role + "--" + label + "-" + String(assets.length + 1).padStart(2, "0") + "." + extensionForMime(mime)
    const hrefValue = assetPathPrefix + filename
    node.setAttribute("href", hrefValue)
    node.setAttributeNS(XLINK_NS, "xlink:href", hrefValue)
    node.setAttribute("data-asset-name", filename)
    node.setAttribute("data-asset-mime", mime)
    assets.push({ file: "assets/" + filename, filename, mime, base64 })
  })

  const metadata = root.getElementsByTagName("metadata")[0]
  if (metadata) {
    while (metadata.firstChild) metadata.removeChild(metadata.firstChild)
    metadata.appendChild(doc.createCDATASection(JSON.stringify({
      schema: "techpack-ai-builder/illustrator-svg/v1",
      id: page.id || null,
      title: page.title || null,
      purpose: page.purpose || null,
      pageNumber: page.pageNumber || 1,
      totalPages: page.totalPages || 1,
      physicalSize: "297mm x 210mm",
      viewBox: root.getAttribute("viewBox"),
      layers: ILLUSTRATOR_LAYERS,
      linkedAssets: assets.map((asset) => ({ file: asset.file, mime: asset.mime })),
    })))
  }

  return {
    svg: withXmlDeclaration(new XMLSerializer().serializeToString(doc)),
    assets,
  }
}

export function illustratorLayerReport(svg) {
  const doc = parseSvg(svg)
  return ILLUSTRATOR_LAYERS.map((name, index) => {
    const id = "LAYER_" + String(index + 1).padStart(2, "0") + "_" + name
    const node = doc.getElementById(id)
    return { name, id, present: !!node, childCount: node ? Array.from(node.childNodes).filter((child) => child.nodeType === 1).length : 0 }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE FILE, EVERY PAGE — the single-document export.
//
// SVG has no native artboards; only .ai and PDF do. So a single .svg cannot
// literally carry N artboards. What it CAN carry - and what both Illustrator
// and Affinity read correctly - is every page laid out side by side on one
// canvas, with the seven semantic layers hoisted to document level so each one
// spans all pages (instead of seven layers repeated per page), plus one
// explicit rectangle per page so the artboards can be created in a single
// step: Illustrator "Object > Artboards > Convert to Artboards", Affinity
// "Document > Add artboard from selection".
//
// Layer order and naming match the per-page contract exactly, so a document
// assembled this way is indistinguishable, layer-wise, from the package the
// JSX importer produces.
// ─────────────────────────────────────────────────────────────────────────────

const ARTBOARD_GAP = 80

function pageViewBox(root) {
  const raw = String(root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number)
  const width = Number.isFinite(raw[2]) && raw[2] > 0 ? raw[2] : 1188
  const height = Number.isFinite(raw[3]) && raw[3] > 0 ? raw[3] : 840
  return { width, height }
}

export function buildMultiArtboardSvg(pages, options = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter((page) => page && typeof page.svg === "string" && page.svg.trim())
  if (list.length === 0) throw new Error("Single-file export requires at least one page")
  const gap = Number.isFinite(options.gap) ? options.gap : ARTBOARD_GAP

  const prepared = list.map((page, index) => {
    const svg = prepareIllustratorSvg(page.svg, { ...page, pageNumber: index + 1, totalPages: list.length })
    const doc = parseSvg(svg)
    return { doc, root: doc.documentElement, page, index, size: pageViewBox(doc.documentElement) }
  })

  const pageWidth = Math.max(...prepared.map((item) => item.size.width))
  const pageHeight = Math.max(...prepared.map((item) => item.size.height))
  const totalWidth = prepared.length * pageWidth + (prepared.length - 1) * gap

  const out = parseSvg(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"" + XLINK_NS + "\" xmlns:inkscape=\"" + INKSCAPE_NS + "\"" +
    " viewBox=\"0 0 " + totalWidth + " " + pageHeight + "\" width=\"" + totalWidth + "\" height=\"" + pageHeight + "\"" +
    " version=\"1.1\" baseProfile=\"full\" xml:space=\"preserve\" data-export-profile=\"illustrator-2026-single-file\"></svg>"
  )
  const outRoot = out.documentElement

  const title = out.createElementNS(SVG_NS, "title")
  title.setAttribute("id", "DOCUMENT_TITLE")
  title.appendChild(out.createTextNode(options.title || "Tech pack"))
  outRoot.appendChild(title)

  const metadata = out.createElementNS(SVG_NS, "metadata")
  metadata.setAttribute("id", "TECHPACK_METADATA")
  metadata.appendChild(out.createCDATASection(JSON.stringify({
    schema: "techpack-ai-builder/illustrator-svg-single-file/v1",
    totalPages: prepared.length,
    pageSize: { width: pageWidth, height: pageHeight, physical: "297mm x 210mm" },
    gap,
    layers: ILLUSTRATOR_LAYERS,
    artboards: prepared.map((item, i) => ({
      index: i + 1,
      id: "ARTBOARD_" + String(i + 1).padStart(2, "0"),
      name: item.page.title || item.page.name || item.page.id || "Pagina " + (i + 1),
      x: i * (pageWidth + gap),
      y: 0,
      width: pageWidth,
      height: pageHeight,
    })),
  })))
  outRoot.appendChild(metadata)

  // Defs from every page are hoisted once, id-prefixed per page so gradients
  // and patterns from different pages can never collide.
  const defs = out.createElementNS(SVG_NS, "defs")
  defs.setAttribute("id", "DOCUMENT_DEFS")
  prepared.forEach((item) => {
    collectElements(item.root, "defs").forEach((node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType !== 1) return
        const imported = out.importNode(child, true)
        const id = imported.getAttribute && imported.getAttribute("id")
        if (id) imported.setAttribute("id", "P" + String(item.index + 1).padStart(2, "0") + "_" + id)
        defs.appendChild(imported)
      })
    })
  })
  if (defs.childNodes.length > 0) outRoot.appendChild(defs)

  // One document-level layer per semantic role, holding that role's content
  // from every page - this is what makes the whole document readable as seven
  // layers instead of seven times N.
  ILLUSTRATOR_LAYERS.forEach((name, layerIndex) => {
    const layer = out.createElementNS(SVG_NS, "g")
    const code = String(layerIndex + 1).padStart(2, "0")
    layer.setAttribute("id", "LAYER_" + code + "_" + name)
    layer.setAttribute("data-layer-name", name)
    layer.setAttribute("inkscape:groupmode", "layer")
    layer.setAttribute("inkscape:label", code + " " + name)

    prepared.forEach((item) => {
      const source = item.doc.getElementById("LAYER_" + code + "_" + name)
      if (!source || !Array.from(source.childNodes).some((child) => child.nodeType === 1)) return
      const holder = out.createElementNS(SVG_NS, "g")
      const pageCode = "P" + String(item.index + 1).padStart(2, "0")
      holder.setAttribute("id", pageCode + "_" + name)
      holder.setAttribute("data-page", String(item.index + 1))
      holder.setAttribute("transform", "translate(" + item.index * (pageWidth + gap) + " 0)")
      Array.from(source.childNodes).forEach((child) => {
        if (child.nodeType === 1) holder.appendChild(out.importNode(child, true))
      })
      layer.appendChild(holder)
    })

    if (layer.childNodes.length > 0) outRoot.appendChild(layer)
  })

  // Artboard guides, last so they sit on top and are easy to select.
  const guides = out.createElementNS(SVG_NS, "g")
  guides.setAttribute("id", "ARTBOARD_GUIDES")
  guides.setAttribute("data-layer-name", "ARTBOARD_GUIDES")
  guides.setAttribute("inkscape:groupmode", "layer")
  guides.setAttribute("inkscape:label", "00 ARTBOARD_GUIDES")
  prepared.forEach((item, i) => {
    const rect = out.createElementNS(SVG_NS, "rect")
    rect.setAttribute("id", "ARTBOARD_" + String(i + 1).padStart(2, "0"))
    rect.setAttribute("data-artboard-name", item.page.title || item.page.name || item.page.id || "Pagina " + (i + 1))
    rect.setAttribute("x", String(i * (pageWidth + gap)))
    rect.setAttribute("y", "0")
    rect.setAttribute("width", String(pageWidth))
    rect.setAttribute("height", String(pageHeight))
    rect.setAttribute("fill", "none")
    rect.setAttribute("stroke", "none")
    rect.setAttribute("pointer-events", "none")
    guides.appendChild(rect)
  })
  outRoot.appendChild(guides)

  return withXmlDeclaration(new XMLSerializer().serializeToString(out))
}
