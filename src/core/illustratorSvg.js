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

  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + new XMLSerializer().serializeToString(doc)
}

export function illustratorLayerReport(svg) {
  const doc = parseSvg(svg)
  return ILLUSTRATOR_LAYERS.map((name, index) => {
    const id = "LAYER_" + String(index + 1).padStart(2, "0") + "_" + name
    const node = doc.getElementById(id)
    return { name, id, present: !!node, childCount: node ? Array.from(node.childNodes).filter((child) => child.nodeType === 1).length : 0 }
  })
}
