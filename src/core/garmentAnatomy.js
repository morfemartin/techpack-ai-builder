// Deterministic garment-part coherence guard.
//
// The live intake is model-owned: analyzeRequirements() asks the local model to
// reason about a garment and returns whatever fields it produces. The prompt
// tells it "una remera no lleva capucha", but a weak model (Qwen 8B 4bit)
// ignores that and invents structural parts the garment cannot have - a franela
// coming back with "Cierre", "Capucha" and "Forro" questions/facts.
//
// The existing quality validator guards OMISSIONS (too few questions, missing
// options). Nothing guarded COMMISSIONS: parts asserted or asked about that the
// identified garment provably does not have. This module is that missing guard.
//
// It is not a template and it never ADDS a question - it only removes a field
// whose subject is anatomically impossible for the identified garment family.
// When the family is unknown it does nothing, so an unrecognized garment is
// never silently trimmed.

function normalize(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// Canonical garment family from the free-text type the vision/model produced.
// Order matters: the more specific / hood-bearing families are tested BEFORE
// the tee family, so "sudadera con capucha" resolves to hoodie and only a
// genuine light knit top ("franela", "camiseta", "remera") resolves to tee.
export function classifyGarmentFamily(garmentType) {
  const name = normalize(garmentType)
  if (!name) return "unknown"
  if (/\b(pantalon|jean|jeans|short|bermuda|jogger|legging|falda|pollera|trouser|pant|skirt|boardshort|swim trunk)\b/.test(name)) return "bottom"
  if (/\b(vestido|dress|enterito|jumpsuit|overol|overall)\b/.test(name)) return "dress"
  if (/\b(campera|chaqueta|abrigo|jacket|coat|parka|blazer|windbreaker|anorak|bomber)\b/.test(name)) return "jacket"
  if (/\b(hoodie|sudadera|buzo|capucha|hooded)\b/.test(name)) return "hoodie"
  if (/\b(sweatshirt|sweater|jersey de lana|pullover|crewneck sweat|buzo sin capucha)\b/.test(name)) return "sweatshirt"
  if (/\bpolo\b/.test(name)) return "polo"
  if (/\b(camisa|shirt formal|blusa|blouse|button up|button down|oxford)\b/.test(name)) return "shirt"
  if (/\b(franela|camiseta|remera|playera|polera|t shirt|tshirt|tee|musculosa|tank|esqueleto|top basico|crop top)\b/.test(name)) return "tee"
  return "unknown"
}

// Parts that CANNOT exist on a given family. Each entry is a matcher against a
// field's normalized subject (label + key). Kept per-family and explicit so the
// set is easy to audit and tune - never a blanket "strip anything technical".
//
// Only the tee family is currently restricted, because it is the one the model
// most often over-builds and the one whose impossibilities are unambiguous: a
// knit pullover tee has no hood, no lining, no front closure hardware, no
// waistband and no drawcord. Pockets are intentionally NOT here - a chest-pocket
// tee is real, so that stays a legitimate (optional) question.
const IMPOSSIBLE_PARTS = {
  tee: [
    { part: "capucha", match: /\b(capuch|hood)/ },
    { part: "forro", match: /\b(forro|lining|entretela)/ },
    { part: "cierre", match: /\b(cierre|closure|zipper|cremallera|placket|tapeta|bragueta|fly|broche|snap)/ },
    { part: "pretina", match: /\b(pretina|waistband)/ },
    { part: "cordon", match: /\b(cordon|drawcord|drawstring)/ },
  ],
}

function fieldSubject(field) {
  return normalize((field && field.label) || "") + " " + normalize((field && field.key) || "")
}

// Which impossible part (if any) a field describes, given the family's rules.
export function incoherentPart(field, family) {
  const rules = IMPOSSIBLE_PARTS[family]
  if (!rules) return null
  const subject = fieldSubject(field)
  const hit = rules.find((rule) => rule.match.test(subject))
  return hit ? hit.part : null
}

// Removes model-generated general fields that describe a part the identified
// garment cannot have. Returns the trimmed reqs plus the human-readable list of
// what was dropped (so a caller can log it or show "descarté: capucha, cierre").
//
// KNOWN fields are left untouched: a KNOWN value came from the vision seed, a
// CSV or an answer the user already gave, and silently deleting confirmed data
// would hide a real conflict rather than fix a hallucination. Only the model's
// own guesses - ASK questions and ASSUMED defaults - are subject to the guard.
export function dropIncoherentFields(reqs) {
  const fields = reqs && Array.isArray(reqs.fields) ? reqs.fields : []
  const family = classifyGarmentFamily(reqs && reqs.garmentType)
  if (!IMPOSSIBLE_PARTS[family]) return { ...reqs, fields, droppedParts: [] }

  const droppedParts = []
  const kept = fields.filter((field) => {
    if (!field || field.category !== "general") return true
    if (field.status === "known") return true
    const part = incoherentPart(field, family)
    if (part) {
      droppedParts.push(part)
      return false
    }
    return true
  })
  return { ...reqs, fields: kept, droppedParts }
}
