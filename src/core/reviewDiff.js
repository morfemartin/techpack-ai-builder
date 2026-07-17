// ─────────────────────────────────────────────────────────────────────────────
// REVIEW DIFF — the deterministic half of the pre-download review round.
//
// Before the user downloads, the document must be provably faithful to what
// they asked for. buildReviewFindings() walks the intake truth (header,
// active parts, designs and their data blocks) against the generated
// document plan and reports, per datum, whether it has a home:
//
//   confirmed - the datum lands on a page (foundOn = page id)
//   missing   - a required intake datum is empty (the review should ASK)
//   unplaced  - the datum exists but no page carries it (the review should
//               offer to fix the plan or consciously drop it)
//
// findingsToWalkFields() then turns ONLY the problems into the exact field
// shape the intake walker already consumes ({key,label,category,status,
// options,why}) - so the review chat works with numbered options even with
// zero AI availability. An optional DeepSeek pass may rephrase these more
// conversationally, but the guarantee never depends on it.
// ─────────────────────────────────────────────────────────────────────────────

// Header fields worth verifying before a factory sees the document, with
// human labels. sno (style code) matters because factories cross-reference
// everything by it; the dates/factory fields are routinely legitimately
// blank at tech-pack stage, so they're not required.
const REQUIRED_HDR = [
  ["brand", "Marca"],
  ["pname", "Nombre del producto"],
  ["season", "Temporada"],
  ["sno", "Código de estilo"],
  ["fab", "Tela principal"],
]

function pagesOf(document) {
  return (document && Array.isArray(document.pages) ? document.pages : []).filter((p) => p && typeof p === "object")
}

function flatTypes(regions, out) {
  for (const r of Array.isArray(regions) ? regions : []) {
    if (!r || typeof r !== "object") continue
    if (r.type === "split") flatTypes(r.regions, out)
    else if (r.type) out.add(r.type)
  }
  return out
}

function pageTypes(page) {
  return flatTypes(page.regions, new Set())
}

function purposeOf(page) {
  return typeof page.purpose === "string" ? page.purpose.trim() : ""
}

// The page that carries the FULL bill of materials: an overview/structure/
// lining page with a partsList region and no pieces restriction.
function fullBomPage(pages) {
  return (
    pages.find((p) => {
      const fam = purposeOf(p)
      const isBomFamily = fam === "overview" || fam === "structure" || fam === "lining"
      const restricted = Array.isArray(p.pieces) && p.pieces.length > 0
      return isBomFamily && !restricted && pageTypes(p).has("partsList")
    }) || null
  )
}

function designPageFor(pages, name) {
  const needle = String(name).trim().toLowerCase()
  return pages.find((p) => purposeOf(p).toLowerCase() === "design:" + needle) || null
}

export function buildReviewFindings(intake, document) {
  const findings = []
  const safe = intake && typeof intake === "object" ? intake : {}
  const pages = pagesOf(document)

  // ── Header ────────────────────────────────────────────────────────────────
  const hdr = safe.hdr && typeof safe.hdr === "object" ? safe.hdr : {}
  const headerPage = pages.find((p) => pageTypes(p).has("header")) || null
  for (const [key, label] of REQUIRED_HDR) {
    const value = typeof hdr[key] === "string" ? hdr[key].trim() : hdr[key]
    if (!value) {
      findings.push({ kind: "missing", topic: "header", field: key, expected: label, foundOn: null })
    } else {
      findings.push({ kind: "confirmed", topic: "header", field: key, expected: String(value), foundOn: headerPage ? headerPage.id : null })
    }
  }

  // ── Active parts vs the full BOM page ─────────────────────────────────────
  const bomPage = fullBomPage(pages)
  for (const part of Array.isArray(safe.parts) ? safe.parts : []) {
    if (!part || part.on === false) continue
    if (bomPage) {
      findings.push({ kind: "confirmed", topic: "part", field: String(part.id), expected: String(part.val || ""), foundOn: bomPage.id })
    } else {
      findings.push({ kind: "unplaced", topic: "part", field: String(part.id), expected: String(part.val || ""), foundOn: null })
    }
  }

  // ── Designs: own page + data blocks actually carried ─────────────────────
  for (const design of Array.isArray(safe.designs) ? safe.designs : []) {
    if (!design || typeof design.name !== "string" || !design.name.trim()) continue
    const page = designPageFor(pages, design.name)
    if (!page) {
      findings.push({ kind: "unplaced", topic: "design", field: design.name, expected: design.tec || "", foundOn: null })
      continue
    }
    findings.push({ kind: "confirmed", topic: "design", field: design.name, expected: design.tec || "", foundOn: page.id })

    const types = pageTypes(page)
    const hasColors = Array.isArray(design.colors) && design.colors.some((c) => c && c.hex)
    if (hasColors && !types.has("colorSpecs")) {
      findings.push({ kind: "unplaced", topic: "design-colors", field: design.name, expected: design.colors.length + " colores", foundOn: null })
    }
    if (design.emb && !types.has("embSpecs")) {
      findings.push({ kind: "unplaced", topic: "design-emb", field: design.name, expected: "ficha de bordado", foundOn: null })
    }
  }

  return findings
}

// Converts findings into walker fields - ONLY the problems become questions
// (confirmed data would otherwise bury the user in pointless confirmations;
// the chat shows those as a summary line instead).
export function findingsToWalkFields(findings) {
  const fields = []
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f.kind === "missing") {
      fields.push({
        key: "review:" + f.topic + ":" + f.field,
        label: f.expected || f.field,
        category: "review",
        status: "ask",
        value: "",
        options: ["Completar ahora (escribí el valor)", "Dejar vacío a propósito"],
        why: "Este dato está vacío en la ficha; la fábrica suele necesitarlo.",
      })
    } else if (f.kind === "unplaced") {
      const what =
        f.topic === "design" ? "El diseño \"" + f.field + "\"" : f.topic === "design-colors" ? "La carta de color de \"" + f.field + "\"" : f.topic === "design-emb" ? "La ficha de bordado de \"" + f.field + "\"" : "\"" + f.field + "\""
      fields.push({
        key: "review:" + f.topic + ":" + f.field,
        label: what + " no aparece en ninguna página",
        category: "review",
        status: "ask",
        value: "",
        options: ["Agregar la página / bloque que falta", "Quitar ese dato del documento a propósito"],
        why: "Lo pediste en el intake pero el documento generado no lo muestra - así no llega a la fábrica.",
      })
    }
  }
  return fields
}

// One-line summary of the confirmed side, for the review chat's opening
// message ("todo esto ya está en el documento").
export function summarizeConfirmed(findings) {
  const confirmed = (Array.isArray(findings) ? findings : []).filter((f) => f.kind === "confirmed")
  const parts = confirmed.filter((f) => f.topic === "part").length
  const designs = confirmed.filter((f) => f.topic === "design").length
  const header = confirmed.filter((f) => f.topic === "header").length
  return { header, parts, designs, total: confirmed.length }
}
