import { extractStructured } from "./deepseekClient.js"
import { LANGUAGE_NAMES } from "./languageConfig.js"
import { T } from "./i18n.js"

const TECH_TOKEN = /(?:%\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?(?:\s?(?:g\/m2|gsm|kg|mm|cm|in|pt\.?|m|g|%))?|#[0-9a-f]{3,8}|\b(?:PANTONE|MADEIRA|DIM|D|V|P)[- .]?\d+[a-z0-9-]*\b)/gi
const TECH_PLACEHOLDER = /__TECH_[A-Z]+__/g

function normalizeTechnicalToken(token) {
  const compact = token.toUpperCase().replace(/\s+/g, "")
  const localizedPercent = compact.match(/^%(\d+(?:[.,]\d+)?)$/)
  return localizedPercent ? localizedPercent[1] + "%" : compact
}

function technicalTokens(value) {
  return JSON.stringify(value).match(TECH_TOKEN)?.map(normalizeTechnicalToken) || []
}

function sameTokens(source, translated) {
  return technicalTokens(source).sort().join("|") === technicalTokens(translated).sort().join("|")
}

function alphabeticIndex(index) {
  let value = index + 1
  let result = ""
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function maskTechnicalTokens(text) {
  const tokens = []
  const maskedText = String(text).replace(TECH_TOKEN, (token) => {
    const marker = "__TECH_" + alphabeticIndex(tokens.length) + "__"
    tokens.push({ marker, token })
    return marker
  })
  return { text: maskedText, tokens }
}

function technicalPlaceholders(text) {
  return String(text).match(TECH_PLACEHOLDER) || []
}

function sameTechnicalPlaceholders(source, translated) {
  return technicalPlaceholders(source).join("|") === technicalPlaceholders(translated).join("|")
}

function restoreTechnicalTokens(text, tokens) {
  let restored = String(text)
  for (const token of tokens) restored = restored.replace(token.marker, token.token)
  return restored
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

export function buildTranslationPayload(hdr, parts, designs, sourceLang = "ES", fabricColors = [], sizeChart = null, partLabels = []) {
  const activeParts = (parts || []).filter((part) => part && part.on !== false)
  return {
    pname: (hdr && hdr.pname) || "",
    parts: activeParts.map((part) => String(part.val || "")),
    partLabels: activeParts.map((_, index) => String(partLabels[index] || "")),
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
  if (!Array.isArray(translated.partLabels) || translated.partLabels.length !== source.partLabels.length || translated.partLabels.some((label) => typeof label !== "string")) return false
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
    partLabels: first.partLabels.map((_, index) => combineValue(translations, selected, (translation) => translation.partLabels[index])),
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

function setPath(target, path, value) {
  let cursor = target
  for (let index = 0; index < path.length - 1; index++) cursor = cursor[path[index]]
  cursor[path[path.length - 1]] = value
}

function translationCatalog(source, targetLang) {
  const target = structuredClone(source)
  const items = []
  function add(id, path, text) {
    if (typeof text !== "string" || text.length === 0) return
    items.push({ id, path, text })
  }

  add("pname", ["pname"], source.pname)
  source.parts.forEach((text, index) => add("part-value:" + index, ["parts", index], text))
  source.partLabels.forEach((text, index) => add("part-label:" + index, ["partLabels", index], text))
  source.designs.forEach((design, index) => {
    for (const key of ["name", "pos", "posDetail", "technique", "illustrationBrief"]) {
      add("design:" + index + ":" + key, ["designs", index, key], design[key])
    }
    design.colors.forEach((color, colorIndex) => add("design:" + index + ":color:" + colorIndex, ["designs", index, "colors", colorIndex, "name"], color.name))
  })
  source.fabricColors.forEach((color, index) => add("fabric-color:" + index, ["fabricColors", index, "name"], color.name))
  source.sizeChart.poms.forEach((pom, index) => {
    add("pom:" + index + ":label", ["sizeChart", "poms", index, "label"], pom.label)
    add("pom:" + index + ":measure", ["sizeChart", "poms", index, "howToMeasure"], pom.howToMeasure)
  })
  source.sizeChart.constants.forEach((constant, index) => add("constant:" + index, ["sizeChart", "constants", index, "label"], constant.label))

  const trustedLexicon = T[targetLang]
  if (trustedLexicon && fragmentContract(source.lexicon, trustedLexicon)) {
    target.lexicon = structuredClone(trustedLexicon)
  } else {
    for (const [key, value] of Object.entries(source.lexicon)) {
      if (Array.isArray(value)) value.forEach((text, index) => add("lexicon:" + key + ":" + index, ["lexicon", key, index], text))
      else add("lexicon:" + key, ["lexicon", key], value)
    }
  }
  return { target, items }
}

function validCatalogAnswer(sourceItems, result) {
  if (!result || typeof result !== "object" || !sameKeys(result, { items: [] }) || !Array.isArray(result.items)) return false
  if (result.items.length !== sourceItems.length) return false
  return sourceItems.every((source, index) => {
    const translated = result.items[index]
    return translated && typeof translated === "object" && sameKeys(translated, { id: "", text: "" }) &&
      translated.id === source.id && typeof translated.text === "string" && sameTechnicalPlaceholders(source.text, translated.text)
  })
}

async function translateCatalogBatch(items, sourceName, targetName, signal) {
  let lastError = null
  const maskedItems = items.map(({ id, text }) => ({ id, ...maskTechnicalTokens(text) }))
  const payload = { items: maskedItems.map(({ id, text }) => ({ id, text })) }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await extractStructured({
        instructions:
          "Translate the text values in this garment technical-data catalog from " + sourceName + " to " + targetName + ". " +
          "Return one top-level object with exactly one key named items. Keep every item id, item order and item count exactly. " +
          "Each item must contain exactly id and text. Translate text only. Tokens such as __TECH_A__ protect production data: copy every such token exactly once, character-for-character, in its original position. Never translate, edit, remove or reorder a __TECH_*__ token. " +
          (attempt === 2 ? "The previous response failed the contract. Rebuild this small batch from the source." : ""),
        content: JSON.stringify(payload),
        maxTokens: 2400,
        signal,
      })
      if (validCatalogAnswer(payload.items, result)) {
        return result.items.map((translated, index) => ({
          ...translated,
          text: restoreTechnicalTokens(translated.text, maskedItems[index].tokens),
        }))
      }
      lastError = new Error("The model changed catalog ids, cardinality or protected technical placeholders")
    } catch (error) {
      lastError = error
    }
  }
  const error = new Error("Translation catalog batch failed: " + items.map((item) => item.id).join(", "))
  error.cause = lastError
  error.items = items.map((item) => item.id)
  throw error
}

async function translateCatalogBatchResilient(items, sourceName, targetName, signal) {
  try {
    return await translateCatalogBatch(items, sourceName, targetName, signal)
  } catch (error) {
    if (items.length <= 1 || (signal && signal.aborted)) throw error
    const middle = Math.ceil(items.length / 2)
    const left = await translateCatalogBatchResilient(items.slice(0, middle), sourceName, targetName, signal)
    const right = await translateCatalogBatchResilient(items.slice(middle), sourceName, targetName, signal)
    return [...left, ...right]
  }
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

async function translateCatalog(source, sourceName, targetName, targetLang, { signal: externalSignal, onProgress } = {}) {
  const { target, items } = translationCatalog(source, targetLang)
  if (items.length === 0) return target
  const batches = chunk(items, 24)
  const controller = new AbortController()
  const abortFromExternal = () => controller.abort(externalSignal.reason)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), 120000)
  let completed = 0
  let translatedBatches
  try {
    translatedBatches = await mapWithConcurrency(batches, 2, async (batch) => {
      const result = await translateCatalogBatchResilient(batch.values, sourceName, targetName, controller.signal)
      completed += batch.values.length
      if (onProgress) onProgress({ completed, total: items.length })
      return result
    })
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal)
  }
  const byId = new Map(translatedBatches.flat().map((item) => [item.id, item.text]))
  for (const item of items) setPath(target, item.path, byId.get(item.id))
  if (!validTranslation(source, target)) throw new Error("Translated catalog does not satisfy the complete document contract")
  return target
}

export async function translateContent(hdr, parts, designs, targetLang, options = {}) {
  const sourceLang = options.sourceLang || "ES"
  const source = buildTranslationPayload(hdr, parts, designs, sourceLang, options.fabricColors, options.sizeChart, options.partLabels)
  if (targetLang === sourceLang) return source

  const targetName = LANGUAGE_NAMES[targetLang]
  const sourceName = LANGUAGE_NAMES[sourceLang]
  if (!targetName || !sourceName) throw new Error("Unsupported document language: " + targetLang)

  try {
    return await translateCatalog(source, sourceName, targetName, targetLang, options)
  } catch (cause) {
    const error = new Error("La traduccion no cumple el contrato tecnico para " + targetName + ".")
    error.code = "translation_contract_failed"
    error.language = targetLang
    error.cause = cause
    error.translationItems = Array.isArray(cause && cause.items) ? cause.items : []
    throw error
  }
}
