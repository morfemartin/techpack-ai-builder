import { extractStructured } from "./deepseekClient.js"
import { LANGUAGE_NAMES } from "./languageConfig.js"
import { T } from "./i18n.js"

const TECH_TOKEN = /(?:\d+(?:[.,]\d+)?(?:\s?(?:mm|cm|m|in|g|kg|gsm|g\/m2|%|pt\.?))?|#[0-9a-f]{3,8}|\b(?:PANTONE|MADEIRA|DIM|D|V|P)[- .]?\d+[a-z0-9-]*\b)/gi

function technicalTokens(value) {
  return JSON.stringify(value).match(TECH_TOKEN)?.map((token) => token.toUpperCase().replace(/\s+/g, "")) || []
}

function sameTokens(source, translated) {
  return technicalTokens(source).sort().join("|") === technicalTokens(translated).sort().join("|")
}

function sameKeys(source, translated) {
  return Object.keys(source).sort().join("|") === Object.keys(translated).sort().join("|")
}

const IMMUTABLE_TRANSLATION_KEYS = new Set(["hex", "pantoneApprox", "pantoneStatus", "source", "madeiraCode"])

function validFragment(source, translated, key = "") {
  if (Array.isArray(source)) {
    return Array.isArray(translated) && translated.length === source.length &&
      source.every((value, index) => validFragment(value, translated[index], key))
  }
  if (source && typeof source === "object") {
    return translated && typeof translated === "object" && !Array.isArray(translated) &&
      sameKeys(source, translated) &&
      Object.keys(source).every((childKey) => validFragment(source[childKey], translated[childKey], childKey))
  }
  if (IMMUTABLE_TRANSLATION_KEYS.has(key)) return translated === source
  if (typeof source === "string") return typeof translated === "string"
  return translated === source
}

function fragmentContract(source, translated) {
  return validFragment(source, translated) && sameTokens(source, translated)
}

function validColorTranslation(source, translated) {
  if (!translated || typeof translated !== "object" || !sameKeys(source, translated)) return false
  if (typeof translated.name !== "string") return false
  return ["hex", "pantoneApprox", "pantoneStatus", "source", "madeiraCode"].every((key) => translated[key] === source[key])
}

function colorPayload(color) {
  return {
    name: String((color && color.name) || ""),
    hex: String((color && color.hex) || ""),
    pantoneApprox: String((color && color.pantoneApprox) || ""),
    pantoneStatus: String((color && color.pantoneStatus) || "pending"),
    source: String((color && color.source) || ""),
    madeiraCode: String((color && color.madeira && color.madeira.code) || ""),
  }
}

// Labels only - NEVER a POM's values, tolerance or unit. A translation
// round-trip corrupting a size number is not a cosmetic bug, it is a
// garment cut wrong; keeping the numbers physically out of this payload
// means they cannot be corrupted here even if the model or the network
// misbehaves - there is nothing to corrupt.
function sizeChartPayload(chart) {
  const safe = chart && typeof chart === "object" ? chart : {}
  const poms = Array.isArray(safe.poms) ? safe.poms : []
  const constants = Array.isArray(safe.constants) ? safe.constants : []
  return {
    poms: poms.map((pom) => ({ label: String((pom && pom.label) || ""), howToMeasure: String((pom && pom.howToMeasure) || "") })),
    constants: constants.map((c) => ({ label: String((c && c.label) || "") })),
  }
}

export function buildTranslationPayload(hdr, parts, designs, sourceLang = "ES", fabricColors = [], sizeChart = null) {
  return {
    pname: (hdr && hdr.pname) || "",
    parts: (parts || []).filter((part) => part && part.on !== false).map((part) => String(part.val || "")),
    designs: (designs || []).map((design) => ({
      name: String((design && design.name) || ""),
      pos: String((design && design.pos) || ""),
      posDetail: String((design && design.posDetail) || ""),
      technique: String((design && design.tec) || ""),
      illustrationBrief: String((design && design.illustrationBrief) || ""),
      colors: Array.isArray(design && design.colors) ? design.colors.map(colorPayload) : [],
    })),
    fabricColors: Array.isArray(fabricColors) ? fabricColors.map(colorPayload) : [],
    sizeChart: sizeChartPayload(sizeChart),
    lexicon: T[sourceLang] || T.ES,
  }
}

function validSizeChartTranslation(source, translated) {
  if (!translated || typeof translated !== "object" || !sameKeys(source, translated)) return false
  if (!Array.isArray(translated.poms) || translated.poms.length !== source.poms.length) return false
  if (!Array.isArray(translated.constants) || translated.constants.length !== source.constants.length) return false
  if (translated.poms.some((pom, i) => !pom || typeof pom !== "object" || !sameKeys(source.poms[i], pom) || typeof pom.label !== "string" || typeof pom.howToMeasure !== "string")) return false
  if (translated.constants.some((c, i) => !c || typeof c !== "object" || !sameKeys(source.constants[i], c) || typeof c.label !== "string")) return false
  return true
}

export function validTranslation(source, translated) {
  if (!translated || typeof translated !== "object" || !sameKeys(source, translated)) return false
  if (typeof translated.pname !== "string") return false
  if (!Array.isArray(translated.parts) || translated.parts.length !== source.parts.length) return false
  if (!Array.isArray(translated.designs) || translated.designs.length !== source.designs.length) return false
  if (!Array.isArray(translated.fabricColors) || translated.fabricColors.length !== source.fabricColors.length) return false
  if (!translated.lexicon || typeof translated.lexicon !== "object") return false
  if (!sameKeys(source.lexicon, translated.lexicon)) return false
  if (Object.keys(source.lexicon).some((key) => {
    const sourceValue = source.lexicon[key]
    const translatedValue = translated.lexicon[key]
    if (Array.isArray(sourceValue)) return !Array.isArray(translatedValue) || sourceValue.length !== translatedValue.length || translatedValue.some((value) => typeof value !== "string")
    return typeof sourceValue === "string" && typeof translatedValue !== "string"
  })) return false
  if (translated.designs.some((design, index) => {
    const sourceDesign = source.designs[index]
    return !design || typeof design !== "object" || !sameKeys(sourceDesign, design) ||
      ["name", "pos", "posDetail", "technique", "illustrationBrief"].some((key) => typeof design[key] !== "string") ||
      !Array.isArray(design.colors) || design.colors.length !== sourceDesign.colors.length ||
      design.colors.some((color, colorIndex) => !validColorTranslation(sourceDesign.colors[colorIndex], color))
  })) return false
  if (translated.fabricColors.some((color, index) => !validColorTranslation(source.fabricColors[index], color))) return false
  if (!validSizeChartTranslation(source.sizeChart, translated.sizeChart)) return false
  return sameTokens(source, translated)
}

function combineValue(translations, languages, getter) {
  return languages.map((language) => language + ": " + String(getter(translations[language]) || "")).join(" / ")
}

export function combineTranslations(translations, languages) {
  const selected = (languages || []).filter((language) => translations && translations[language])
  if (!selected.length) return null
  const first = translations[selected[0]]
  return {
    pname: combineValue(translations, selected, (translation) => translation.pname),
    parts: first.parts.map((_, index) => combineValue(translations, selected, (translation) => translation.parts[index])),
    designs: first.designs.map((_, index) => ({
      name: combineValue(translations, selected, (translation) => translation.designs[index].name),
      pos: combineValue(translations, selected, (translation) => translation.designs[index].pos),
      posDetail: combineValue(translations, selected, (translation) => translation.designs[index].posDetail),
      technique: combineValue(translations, selected, (translation) => translation.designs[index].technique),
      illustrationBrief: combineValue(translations, selected, (translation) => translation.designs[index].illustrationBrief),
      colors: first.designs[index].colors.map((color, colorIndex) => ({
        ...color,
        name: combineValue(translations, selected, (translation) => translation.designs[index].colors[colorIndex].name),
      })),
    })),
    fabricColors: first.fabricColors.map((color, index) => ({
      ...color,
      name: combineValue(translations, selected, (translation) => translation.fabricColors[index].name),
    })),
    sizeChart: {
      poms: first.sizeChart.poms.map((_, index) => ({
        label: combineValue(translations, selected, (translation) => translation.sizeChart.poms[index].label),
        howToMeasure: combineValue(translations, selected, (translation) => translation.sizeChart.poms[index].howToMeasure),
      })),
      constants: first.sizeChart.constants.map((_, index) => ({
        label: combineValue(translations, selected, (translation) => translation.sizeChart.constants[index].label),
      })),
    },
    lexicon: Object.fromEntries(Object.keys(first.lexicon).map((key) => {
      const value = first.lexicon[key]
      if (Array.isArray(value)) {
        return [key, value.map((_, index) => combineValue(translations, selected, (translation) => translation.lexicon[key][index]))]
      }
      if (typeof value !== "string") return [key, value]
      return [key, combineValue(translations, selected, (translation) => translation.lexicon[key])]
    })),
    languages: selected,
    outputMode: "multilingual",
  }
}

function chunk(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push({ index, values: values.slice(index, index + size) })
  return result
}

function needsChunkedTranslation(source) {
  return source.parts.length > 24 || source.designs.length > 4 || JSON.stringify(source).length > 24000
}

function buildTranslationFragments(source, targetLang) {
  const fragments = []
  const partChunks = chunk(source.parts, 24)
  if (!partChunks.length) fragments.push({ type: "core", index: 0, source: { pname: source.pname, parts: [] } })
  partChunks.forEach((entry, position) => fragments.push({
    type: "core",
    index: entry.index,
    source: position === 0 ? { pname: source.pname, parts: entry.values } : { parts: entry.values },
  }))
  chunk(source.designs, 3).forEach((entry) => fragments.push({ type: "designs", index: entry.index, source: { designs: entry.values } }))
  chunk(source.fabricColors, 12).forEach((entry) => fragments.push({ type: "fabricColors", index: entry.index, source: { fabricColors: entry.values } }))
  chunk(source.sizeChart.poms, 10).forEach((entry) => fragments.push({ type: "poms", index: entry.index, source: { poms: entry.values } }))
  chunk(source.sizeChart.constants, 16).forEach((entry) => fragments.push({ type: "constants", index: entry.index, source: { constants: entry.values } }))

  const trustedLexicon = T[targetLang]
  if (!trustedLexicon || !fragmentContract(source.lexicon, trustedLexicon)) {
    chunk(Object.entries(source.lexicon), 36).forEach((entry) => fragments.push({
      type: "lexicon",
      index: entry.index,
      source: { lexicon: Object.fromEntries(entry.values) },
    }))
  }
  return { fragments, trustedLexicon: trustedLexicon && fragmentContract(source.lexicon, trustedLexicon) ? trustedLexicon : null }
}

async function translateFragment(fragment, sourceName, targetName, signal) {
  let previous = null
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const repairing = attempt === 2
    const content = repairing && previous
      ? { documentToTranslate: fragment.source, invalidPreviousAttempt: previous }
      : fragment.source
    try {
      const result = await extractStructured({
        instructions:
          "Translate this small section of a garment technical document from " + sourceName + " to " + targetName + ". " +
          "Return EXACTLY the same JSON keys, arrays and item order as the input document; do not add a wrapper. " +
          "Translate human-readable text only. Preserve every number, measurement, unit, ID, brand, file name, Pantone/Madeira reference, hexadecimal color and status value exactly. " +
          (repairing ? "The previous answer was rejected; repair its shape and invariants." : ""),
        content: JSON.stringify(content),
        maxTokens: 3200,
        signal,
      })
      if (fragmentContract(fragment.source, result)) return result
      previous = result
      lastError = null
    } catch (error) {
      lastError = error
      previous = error && error.cause && error.cause.raw ? error.cause.raw : null
    }
  }
  const error = new Error("Translation fragment failed: " + fragment.type)
  error.cause = lastError
  throw error
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

async function translateContentInFragments(source, sourceName, targetName, targetLang, externalSignal) {
  const { fragments, trustedLexicon } = buildTranslationFragments(source, targetLang)
  const controller = new AbortController()
  const abortFromExternal = () => controller.abort(externalSignal.reason)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), 120000)
  let translatedFragments
  try {
    translatedFragments = await mapWithConcurrency(fragments, 2, (fragment) => translateFragment(fragment, sourceName, targetName, controller.signal))
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal)
  }
  const translated = {
    pname: source.pname,
    parts: [],
    designs: [],
    fabricColors: [],
    sizeChart: { poms: [], constants: [] },
    lexicon: trustedLexicon || {},
  }
  translatedFragments.forEach((result, fragmentIndex) => {
    const fragment = fragments[fragmentIndex]
    if (fragment.type === "core") {
      if (typeof result.pname === "string") translated.pname = result.pname
      translated.parts.splice(fragment.index, 0, ...result.parts)
    } else if (fragment.type === "designs") translated.designs.splice(fragment.index, 0, ...result.designs)
    else if (fragment.type === "fabricColors") translated.fabricColors.splice(fragment.index, 0, ...result.fabricColors)
    else if (fragment.type === "poms") translated.sizeChart.poms.splice(fragment.index, 0, ...result.poms)
    else if (fragment.type === "constants") translated.sizeChart.constants.splice(fragment.index, 0, ...result.constants)
    else if (fragment.type === "lexicon") Object.assign(translated.lexicon, result.lexicon)
  })
  if (!validTranslation(source, translated)) throw new Error("Translated fragments do not satisfy the complete document contract")
  return translated
}

export async function translateContent(hdr, parts, designs, targetLang, options = {}) {
  const sourceLang = options.sourceLang || "ES"
  const source = buildTranslationPayload(hdr, parts, designs, sourceLang, options.fabricColors, options.sizeChart)
  if (targetLang === sourceLang) return source

  const targetName = LANGUAGE_NAMES[targetLang]
  const sourceName = LANGUAGE_NAMES[sourceLang]
  if (!targetName || !sourceName) throw new Error("Unsupported document language: " + targetLang)

  if (needsChunkedTranslation(source)) {
    try {
      return await translateContentInFragments(source, sourceName, targetName, targetLang, options.signal)
    } catch (cause) {
      const error = new Error("La traduccion no cumple el contrato tecnico para " + targetName + ".")
      error.code = "translation_contract_failed"
      error.language = targetLang
      error.cause = cause
      throw error
    }
  }

  let previous = null
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const repair = attempt === 2
      ? " The previous answer failed validation. Repair it: keep every key and array item, and preserve every number, unit, code, Pantone/Madeira reference, DIM/D/V identifier and hexadecimal value exactly."
      : attempt === 3
        ? " Start a fresh complete translation. The two previous structures were invalid; rebuild the whole JSON from the source and preserve every invariant exactly."
        : ""
    // Only wrap the payload in an envelope when there is a previous invalid
    // answer worth showing (repair attempt). Verified live against Mistral:
    // wrapping it EVERY attempt (even as {source, previousInvalidAnswer:
    // null}) made the model mirror that wrapper back - 3/3 real translations
    // came back perfectly translated but nested under a "source" key, so
    // validTranslation's sameKeys() check failed on every attempt before the
    // content was ever inspected. The instructions now also say the exact
    // top-level keys expected, since "return the exact same structure" left
    // it ambiguous whether that meant the envelope's structure or the
    // document's.
    const showPrevious = attempt === 2 && previous
    const envelope = showPrevious ? { documentToTranslate: source, invalidPreviousAttempt: previous } : source
    try {
      const result = await extractStructured({
        instructions:
          "Translate a garment technical document from " + sourceName + " to " + targetName + ". " +
          "Respond with a JSON object containing EXACTLY these top-level keys, translated: pname, parts, designs, fabricColors, sizeChart, lexicon. " +
          "Do not wrap your answer in any other key (no 'source', no 'translation', no 'documentToTranslate') - your entire response IS that object, at the top level. " +
          (showPrevious
            ? "The input below has two keys: documentToTranslate (translate this one) and invalidPreviousAttempt (a rejected prior answer, shown so you can avoid its mistake - keep every key and array item, and preserve every number, unit, code, Pantone/Madeira reference, DIM/D/V identifier and hexadecimal value exactly). "
            : "") +
          "Translate human-readable text only. Never translate, remove, reorder or alter numbers, measurements, units, IDs, brand names, file names, Pantone references, Madeira codes or hexadecimal colors." + repair,
        content: JSON.stringify(envelope),
        // Was 4200. sizeChart added a 6th top-level key the model has to
        // reproduce in full (every POM's label + howToMeasure, every
        // constant) on top of everything already being translated - a
        // document with a real size chart (up to 12 POMs) plus several
        // pieces/designs can now legitimately exceed 4200 output tokens.
        // extractStructured's repairTruncatedJSON salvages a cut-off
        // response by DROPPING whatever array item was mid-write, so a
        // truncated answer correctly fails validSizeChartTranslation's
        // length check (fewer poms than the source) - not a validator bug,
        // just not enough room to finish. Raised with margin rather than
        // tuned to the observed failure, since a bigger document (more
        // parts, more designs) hits the same ceiling.
        maxTokens: 6400,
      })
      if (validTranslation(source, result)) return result
      previous = result
      lastError = null
    } catch (error) {
      // A formatting miss is one invalid attempt, not the end of the language
      // workflow. The following pass starts again from the intact source.
      lastError = error
      previous = error && error.cause && error.cause.raw ? error.cause.raw : null
    }
  }
  const error = new Error("La traduccion no cumple el contrato tecnico para " + targetName + ".")
  error.code = "translation_contract_failed"
  error.language = targetLang
  error.cause = lastError
  throw error
}
