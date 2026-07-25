// Deterministic disambiguation for Spanish garment terms that have more than
// one common, unrelated meaning. Resolved with ONE explicit user question
// BEFORE any model call, so the model is never left to silently pick a
// meaning on its own - which is exactly how a typed "franela" turned into a
// lumberjack flannel shirt (canesu, tela de trama) instead of a knit tee: in
// Venezuela/Cuba "franela" means a t-shirt; elsewhere it names the brushed-
// flannel FABRIC, most often heard describing a flannel ("lenador") shirt.
// Same word, two unrelated garments - a weak model guesses; this asks.
//
// Each option's `resolvedType` is an UNAMBIGUOUS string that replaces the
// user's raw text from that point on. It feeds both the model prompt
// (analyzeRequirements's garmentType) and garmentAnatomy.classifyGarmentFamily(),
// so nothing downstream ever has to know the term was ambiguous. Kept to
// genuinely dual-meaning terms on purpose (not regionalisms like remera/
// playera/polera, which are just synonyms for the same garment and need no
// question) - see requirementLayers.js's sortFieldsForIntake for the same
// "stay coarse, do not overfit" discipline applied to question ordering.

function normalize(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// `resolvedType` is NOT display text - it is the literal string fed to
// analyzeRequirements()'s garmentType prompt AND to
// garmentAnatomy.classifyGarmentFamily(), whose keyword regexes are Spanish
// ("camiseta", "camisa", "franela"...). It must stay this exact Spanish
// vocabulary regardless of the app's UI language, or a resolved English
// label would silently fall through classifyGarmentFamily as "unknown" and
// skip the anatomy coherence guard entirely. Only `question`/`label` - what
// the user actually reads - are translated; see ambiguousGarmentTerm below.
const AMBIGUOUS_TERMS = [
  {
    term: "franela",
    match: /\bfranela\b/,
    question: { ES: '¿A qué te referís con "franela"?', EN: 'What do you mean by "franela"?' },
    options: [
      {
        label: { ES: "Camiseta de punto (remera/t-shirt)", EN: "Knit t-shirt (remera/tee)" },
        resolvedType: "Camiseta de punto (tipo franela)",
      },
      {
        label: { ES: "Camisa de franela (tejido, tipo leñador)", EN: "Flannel shirt (woven, lumberjack-style)" },
        resolvedType: "Camisa de franela (tejido de trama, tipo leñador)",
      },
    ],
  },
]

// Returns the first matching ambiguity for a typed garment name, or null when
// the term is unambiguous (the common case). Only ever the FIRST match, so a
// name that happens to hit two entries still asks one question at a time.
// `uiLang` only selects which display strings (question/option labels) come
// back - resolvedType is always the same canonical Spanish value.
export function ambiguousGarmentTerm(garmentType, uiLang = "ES") {
  const name = normalize(garmentType)
  if (!name) return null
  const entry = AMBIGUOUS_TERMS.find((candidate) => candidate.match.test(name))
  if (!entry) return null
  const lang = uiLang === "EN" ? "EN" : "ES"
  return {
    term: entry.term,
    question: entry.question[lang],
    options: entry.options.map((opt) => ({ label: opt.label[lang], resolvedType: opt.resolvedType })),
  }
}
