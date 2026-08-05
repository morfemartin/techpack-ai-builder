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

export function buildTranslationPayload(hdr, parts, designs, sourceLang = "ES", fabricColors = []) {
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
    lexicon: T[sourceLang] || T.ES,
  }
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

export async function translateContent(hdr, parts, designs, targetLang, options = {}) {
  const sourceLang = options.sourceLang || "ES"
  const source = buildTranslationPayload(hdr, parts, designs, sourceLang, options.fabricColors)
  if (targetLang === sourceLang) return source

  const targetName = LANGUAGE_NAMES[targetLang]
  const sourceName = LANGUAGE_NAMES[sourceLang]
  if (!targetName || !sourceName) throw new Error("Unsupported document language: " + targetLang)

  let previous = null
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const repair = attempt === 2
      ? " The previous answer failed validation. Repair it: keep every key and array item, and preserve every number, unit, code, Pantone/Madeira reference, DIM/D/V identifier and hexadecimal value exactly."
      : attempt === 3
        ? " Start a fresh complete translation. The two previous structures were invalid; rebuild the whole JSON from the source and preserve every invariant exactly."
        : ""
    try {
      const result = await extractStructured({
        instructions:
          "Translate a garment technical document from " + sourceName + " to " + targetName + ". " +
          "Return the exact same JSON structure. Translate human-readable text only. Never translate, remove, reorder or alter numbers, measurements, units, IDs, brand names, file names, Pantone references, Madeira codes or hexadecimal colors." + repair,
        content: JSON.stringify({ source, previousInvalidAnswer: attempt === 2 ? previous : null }),
        maxTokens: 4200,
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
