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

// Which questions become moot once THIS one is answered "none" - e.g. once
// the user says "no lleva botones", the walker must stop asking button
// color/count/ojales, not plow through them anyway (observed live: the chat
// visibly ignored a direct answer and kept interrogating a closed topic).
// Each topic's `subject` matches BOTH the answered field (to find which
// topic it belongs to) and every OTHER still-pending field in that same
// topic (to find what becomes moot) - so answering ANY question inside a
// topic with a "none"-shaped value silences the rest of that same topic.
// Deliberately narrow and offline: no AI call, no risk of over-pruning a
// genuine follow-up question outside the topic.
// "ningun" has no trailing \b - Spanish inflects it ("ninguno", "ninguna",
// "ningunos"). The rest are fixed word-forms in this context, so they keep
// both boundaries for precision (no false match inside a longer word).
const NONE_VALUE = /\b(sin|no lleva|no tiene|no aplica|none|not applicable)\b|\bningun/
// No trailing \b on purpose - Spanish inflects ("boton" -> "botones",
// "capuch" -> "capucha"), so anchoring only the START (matching this file's
// existing IMPOSSIBLE_PARTS style) is what actually matches real labels.
const MOOT_TOPICS = [
  { subject: /\b(cierre|closure|zipper|cremallera|boton|button|ojal|buttonhole|tapeta|placket|broche|snap|velcro|bragueta|\bfly\b)/ },
  { subject: /\b(bolsillo|pocket)/ },
  { subject: /\b(capuch|hood)/ },
  { subject: /\b(forro|lining|entretela)/ },
  { subject: /\b(cordon|drawcord|drawstring)/ },
  { subject: /\b(hebilla|buckle|herraje|hardware|remache|rivet)/ },
  { subject: /\b(etiqueta|label|marquilla|hangtag)/ },
  { subject: /\b(logo|bordado|embroider|estampa|print|serigraf|aplique|applique|parche|patch)/ },
]

// Returns the keys of other still-pending ("ask") fields made moot by
// answering `answeredField` with `value` - empty array if the answer does
// not say "none" or the field does not belong to a recognized topic. Never
// touches design fields or fields already known/assumed.
export function mootFieldsFromAnswer(fields, answeredField, value) {
  if (!answeredField || !NONE_VALUE.test(normalize(value))) return []
  const answeredSubject = fieldSubject(answeredField)
  const topic = MOOT_TOPICS.find((t) => t.subject.test(answeredSubject))
  if (!topic) return []
  return (fields || [])
    .filter((f) => f && f.key !== answeredField.key && f.category === "general" && f.status === "ask" && topic.subject.test(fieldSubject(f)))
    .map((f) => f.key)
}

// The design round (analyzeDesignExpression) had NO deterministic guard at
// all - unlike the general round, which has dropIncoherentFields. So a
// design element the user had ALREADY denied in the questionnaire came right
// back as its own design page: answer "sin cierre", then get asked for the
// zipper's artwork anyway. The general facts were in the prompt; nothing
// enforced them, and prompting alone is exactly what kept failing.
//
// `generalFacts` is reqsToParts()' output ({label, val}) - already-resolved
// construction answers. Any fact whose VALUE reads as a negation ("Sin
// cierre", "No aplica (no lleva botones)", "Ninguno") closes its whole topic:
// every design field in a slot touching that topic is dropped, because a
// design slot IS one element - if the element does not exist, none of its
// sub-questions do either.
//
// Never drops a slot the facts don't contradict, and never reads a fact whose
// value is affirmative - a garment that HAS a zipper still gets its zipper
// design page.
export function dropContradictedDesignFields(designFields, generalFacts) {
  const fields = Array.isArray(designFields) ? designFields : []
  const negatedTopics = MOOT_TOPICS.filter((topic) =>
    (Array.isArray(generalFacts) ? generalFacts : []).some((fact) => {
      if (!fact) return false
      const value = normalize(fact.val != null ? fact.val : fact.value)
      if (!value || !NONE_VALUE.test(value)) return false
      return topic.subject.test(normalize(fact.label))
    })
  )
  if (negatedTopics.length === 0) return { fields, droppedSlots: [] }

  const contradicted = (field) => negatedTopics.some((topic) => topic.subject.test(fieldSubject(field)))
  // Resolve at SLOT granularity: one contradicted field condemns its whole
  // element, so a slot never survives as a half-element with its identity
  // question gone.
  const doomedSlots = new Set(fields.filter((f) => f && f.designSlot && contradicted(f)).map((f) => f.designSlot))
  if (doomedSlots.size === 0) return { fields, droppedSlots: [] }
  return {
    fields: fields.filter((f) => !(f && f.designSlot && doomedSlots.has(f.designSlot))),
    droppedSlots: [...doomedSlots],
  }
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
