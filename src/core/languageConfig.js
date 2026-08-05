export const TEXTILE_LANGUAGES = [
  { code: "DE", labels: { ES: "Aleman", EN: "German" } },
  { code: "BN", labels: { ES: "Bengali", EN: "Bengali" } },
  { code: "ZH", labels: { ES: "Chino simplificado", EN: "Simplified Chinese" } },
  { code: "ES", labels: { ES: "Espanol", EN: "Spanish" } },
  { code: "FR", labels: { ES: "Frances", EN: "French" } },
  { code: "EN", labels: { ES: "Ingles", EN: "English" } },
  { code: "IT", labels: { ES: "Italiano", EN: "Italian" } },
  { code: "PT", labels: { ES: "Portugues", EN: "Portuguese" } },
  { code: "TR", labels: { ES: "Turco", EN: "Turkish" } },
  { code: "VI", labels: { ES: "Vietnamita", EN: "Vietnamese" } },
]

export const LANGUAGE_NAMES = {
  DE: "German",
  BN: "Bengali",
  ZH: "Simplified Chinese",
  ES: "Spanish",
  FR: "French",
  EN: "English",
  IT: "Italian",
  PT: "Portuguese",
  TR: "Turkish",
  VI: "Vietnamese",
}

const LANGUAGE_CODES = new Set(TEXTILE_LANGUAGES.map((language) => language.code))

export function languageLabel(code, uiLang = "ES") {
  const language = TEXTILE_LANGUAGES.find((item) => item.code === code)
  if (!language) return code
  return language.labels[uiLang] || language.labels.ES
}

export function sortedTextileLanguages(uiLang = "ES") {
  return TEXTILE_LANGUAGES.slice().sort((a, b) =>
    languageLabel(a.code, uiLang).localeCompare(languageLabel(b.code, uiLang), uiLang === "EN" ? "en" : "es")
  )
}

export function normalizeLanguageConfig(config = {}) {
  const sourceLanguage = LANGUAGE_CODES.has(config.sourceLanguage) ? config.sourceLanguage : "ES"
  const requested = Array.isArray(config.factoryLanguages) ? config.factoryLanguages : [sourceLanguage]
  const factoryLanguages = Array.from(new Set(requested.filter((code) => LANGUAGE_CODES.has(code))))
  return {
    sourceLanguage,
    factoryLanguages: factoryLanguages.length ? factoryLanguages : [sourceLanguage],
    designerLanguage: LANGUAGE_CODES.has(config.designerLanguage) ? config.designerLanguage : sourceLanguage,
    outputMode: config.outputMode === "multilingual" ? "multilingual" : "separate",
  }
}

export function toggleFactoryLanguage(languages, code) {
  const current = Array.from(new Set((languages || []).filter((item) => LANGUAGE_CODES.has(item))))
  if (!LANGUAGE_CODES.has(code)) return current.length ? current : ["ES"]
  if (current.includes(code)) return current.length === 1 ? current : current.filter((item) => item !== code)
  return [...current, code]
}
