// AI-assisted half of the tallaje (size chart) feature. Safety decision this
// whole file exists for (see sizeChart.js's header comment for the other
// half): the model NEVER emits a filled matrix. proposePoms returns points of
// measure with EMPTY cells - just what to measure and how. proposeGrading
// returns per-POM grading RULES (an increment per size step), never the
// computed numbers - sizeChart.gradeFromBase is the only thing allowed to do
// that arithmetic, and a human verifies each derived row before it counts as
// confirmed (see chartWarnings). If the AI call fails or nothing survives
// validation, the fallback is empty - hand-grade, nothing invented.

import { deepseekChat, DeepSeekError } from "./deepseekClient.js"
import { HYBRID_TASKS } from "./hybridTasks.js"
import { parseJSONOrRepair } from "./techpackRequirements.js"
import { parseMeasure, convertMeasure } from "./units.js"
import { newPom, gradeFromBase } from "./sizeChart.js"

// Proposes WHAT to measure, never a value. Reuses the same hard anatomy rule
// analyzeDesignExpression() uses for design positions (techpackRequirements.js) -
// a POM has to exist on the real garment ("a polo has no entrepierna").
export async function proposePoms({ garmentType, generalFields, lang = "ES", onStatus, signal } = {}) {
  const generalText = generalFields && generalFields.length > 0 ? JSON.stringify(generalFields) : "(sin datos de construccion)"
  const instructions =
    "Sos un patronista tecnico definiendo la tabla de medidas (POMs, points of measure) de una ficha tecnica para una prenda tipo '" + garmentType + "'. " +
    "Ya tenemos definidos los campos de construccion general: " + generalText + ".\n\n" +
    "ANATOMIA - regla dura: solo podes nombrar puntos de medida que existan FISICAMENTE en una '" + garmentType + "'. " +
    "Antes de escribir un punto de medida, preguntate si esa parte existe en esta prenda. Un polo no tiene entrepierna; " +
    "un pantalon no tiene medio pecho ni largo de manga; unas medias no tienen cintura. Nombrar un punto que la prenda " +
    "no tiene invalida la tabla entera.\n\n" +
    "Para cada punto de medida real, dame SOLO su nombre y como se mide - NUNCA un numero, ni siquiera un ejemplo o " +
    "rango. Los valores los carga un humano despues con una cinta metrica sobre una prenda fisica; vos no los sabes " +
    "y no debes inventarlos.\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"poms": [{"label": "Medio pecho", "howToMeasure": "De costura a costura, 2.5cm bajo la axila"}]}\n' +
    "Entre 3 y 12 puntos de medida. Si genuinamente no hay puntos de medida estandarizables para esta prenda, devolve un array vacio."

  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 1800,
    temperature: 0.2,
    task: HYBRID_TASKS.DESIGNS,
    validator: (content) => {
      const value = parsePomsResponse(content)
      return value.every((pom) => pom.label && pom.howToMeasure)
    },
    fallback: JSON.stringify({ poms: [] }),
    onStatus,
    signal,
  })
  const poms = parsePomsResponse(raw)
  return poms.map((pom) => newPom({ label: pom.label, howToMeasure: pom.howToMeasure, unit: "cm" }))
}

function parsePomsResponse(raw) {
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio puntos de medida validos.")
  const list = parsed && Array.isArray(parsed.poms) ? parsed.poms : []
  return list
    .filter((p) => p && typeof p.label === "string" && p.label.trim())
    .map((p) => ({ label: p.label.trim(), howToMeasure: typeof p.howToMeasure === "string" ? p.howToMeasure.trim() : "" }))
}

// A grading rule is safe to even SHOW the user only if it is physically
// sane: a finite positive per-step increment, smaller than 20% of that POM's
// own base-size value (a bigger jump is almost certainly a hallucinated or
// misplaced digit, not a real grade), and naming a POM that already exists in
// the chart - never a channel for the model to invent a new measurement.
export function validateGradingRule(rule, chart) {
  if (!rule || typeof rule !== "object") return false
  const pom = (chart && Array.isArray(chart.poms) ? chart.poms : []).find((p) => p.id === rule.pomId)
  if (!pom) return false
  const baseValue = parseMeasure(pom.values[chart.baseSize])
  if (baseValue === null || baseValue === 0) return false
  const increment = parseMeasure(rule.increment)
  if (increment === null || !Number.isFinite(increment) || increment <= 0) return false
  return Math.abs(increment) < Math.abs(baseValue) * 0.2
}

// Proposes grading RULES only - {pomId, increment, unit, why} - never filled
// cells. Every POM sent in must already have a verified base-size value: a
// rule with nothing to grade FROM is not a rule, it is a guess with extra
// steps.
export async function proposeGrading({ chart, garmentType, lang = "ES", onStatus, signal } = {}) {
  const safeChart = chart || { poms: [], baseSize: "M", sizes: [] }
  const gradable = (safeChart.poms || []).filter((pom) => parseMeasure(pom.values[safeChart.baseSize]) !== null)
  if (gradable.length === 0) return []

  const pomText = JSON.stringify(gradable.map((pom) => ({
    id: pom.id,
    label: pom.label,
    baseValue: pom.values[safeChart.baseSize],
    unit: pom.unit,
  })))
  const instructions =
    "Sos un patronista tecnico grillando (grading) la tabla de medidas de una '" + garmentType + "' entre las tallas " +
    (safeChart.sizes || []).join(", ") + ", con talla base '" + safeChart.baseSize + "'.\n" +
    "Estos son los puntos de medida ya cargados con su valor en la talla base: " + pomText + ".\n\n" +
    "Para cada punto de medida, proponé el INCREMENTO por talla (el delta entre una talla y la siguiente, NO la matriz " +
    "completa) - nunca calcules ni devuelvas los valores de las demas tallas, eso lo hace un proceso determinista aparte. " +
    "El incremento tiene que ser un numero positivo razonable para esa medida especifica en esta prenda (por ejemplo, " +
    "'medio pecho' grilla mas por talla que 'altura de cuello').\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"rules": [{"pomId": "el id exacto que te pasamos", "increment": 3, "unit": "cm", "why": "por que ese incremento (breve)"}]}\n' +
    "Una regla por cada punto de medida que te pasamos, en el mismo unit que ya tiene."

  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 1800,
    temperature: 0.2,
    task: HYBRID_TASKS.DESIGNS,
    validator: (content) => {
      const rules = parseGradingResponse(content)
      return rules.length > 0 && rules.every((rule) => validateGradingRule(rule, safeChart))
    },
    fallback: JSON.stringify({ rules: [] }),
    onStatus,
    signal,
  })
  const rules = parseGradingResponse(raw)
  return rules.filter((rule) => validateGradingRule(rule, safeChart))
}

function parseGradingResponse(raw) {
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio reglas de grillado validas.")
  const list = parsed && Array.isArray(parsed.rules) ? parsed.rules : []
  return list
    .filter((r) => r && typeof r.pomId === "string" && r.pomId.trim())
    .map((r) => ({ pomId: r.pomId.trim(), increment: r.increment, unit: typeof r.unit === "string" ? r.unit : "cm", why: typeof r.why === "string" ? r.why : "" }))
}

// Pure - applies already-validated rules via sizeChart's own deterministic
// arithmetic (gradeFromBase), one POM at a time. Never called with an
// unvalidated rule; validateGradingRule is the gate, this is just the fold.
export function applyProposedGrading(chart, rules) {
  const safeChart = chart || { poms: [], baseSize: "M", sizes: [] }
  const bySlot = new Map((rules || []).map((rule) => [rule.pomId, rule]))
  const poms = (safeChart.poms || []).map((pom) => {
    const rule = bySlot.get(pom.id)
    if (!rule) return pom
    return gradeFromBase(pom, { sizes: safeChart.sizes, baseSize: safeChart.baseSize, increment: rule.increment, unit: rule.unit })
  })
  return { ...safeChart, poms }
}

// Nothing on a garment is physically this big - a bound in cm regardless of
// the POM's own unit, so a wildly wrong digit (or unit mixup) is rejected
// before it ever reaches the "accept this?" UI.
export const MAX_BASE_CM = 250

// A base-value proposal is safe to even SHOW the user only if: the pomId is
// real, its base cell is genuinely still empty (this is the hard rule - a
// human's typed measurement is NEVER a candidate for replacement, regardless
// of what the model returns), the value is a finite positive number, and it
// converts to something physically plausible.
export function validateBaseValue(rule, chart) {
  if (!rule || typeof rule !== "object") return false
  const pom = (chart && Array.isArray(chart.poms) ? chart.poms : []).find((p) => p.id === rule.pomId)
  if (!pom) return false
  if (parseMeasure(pom.values[chart.baseSize]) !== null) return false
  const value = parseMeasure(rule.value)
  if (value === null || !Number.isFinite(value) || value <= 0) return false
  const inCm = convertMeasure(value, rule.unit || pom.unit, "cm")
  return inCm !== null && inCm <= MAX_BASE_CM
}

// Proposes the talla-base VALUE for each still-unmeasured POM - never the
// full matrix (proposeGrading covers the other tallas from here, via the
// same arithmetic gradeFromBase always uses). Only ever asks about POMs
// whose base cell is empty: a POM someone already measured never even
// reaches the prompt, so there is no path for the model to overwrite it.
export async function proposeBaseValues({ chart, garmentType, generalFields, lang = "ES", onStatus, signal } = {}) {
  const safeChart = chart || { poms: [], baseSize: "M", sizes: [] }
  const unmeasured = (safeChart.poms || []).filter((pom) => parseMeasure(pom.values[safeChart.baseSize]) === null)
  if (unmeasured.length === 0) return []

  const generalText = generalFields && generalFields.length > 0 ? JSON.stringify(generalFields) : "(sin datos de construccion)"
  const pomText = JSON.stringify(unmeasured.map((pom) => ({ id: pom.id, label: pom.label, howToMeasure: pom.howToMeasure, unit: pom.unit })))
  const instructions =
    "Sos un patronista tecnico proponiendo valores tipicos de talla base para la tabla de medidas de una '" + garmentType + "', talla base '" + safeChart.baseSize + "'. " +
    "Campos de construccion general ya conocidos: " + generalText + ".\n" +
    "Estos son los puntos de medida SIN valor de talla base todavia: " + pomText + ".\n\n" +
    "Para cada uno, proponé un valor TIPICO de mercado para la talla '" + safeChart.baseSize + "' en esta prenda - un numero " +
    "razonable que un patronista esperaria ver de referencia, NUNCA lo presentes como una medicion real: nadie midio " +
    "una prenda fisica todavia, y el usuario va a revisar y corregir cada numero antes de confirmarlo.\n\n" +
    "Devolve SOLO un objeto JSON con esta forma exacta, sin markdown:\n" +
    '{"values": [{"pomId": "el id exacto que te pasamos", "value": 54, "unit": "cm", "why": "por que ese valor (breve)"}]}\n' +
    "Un valor por cada punto de medida que te pasamos, en el mismo unit que ya tiene."

  const raw = await deepseekChat({
    messages: [{ role: "user", content: instructions }],
    maxTokens: 1800,
    temperature: 0.2,
    task: HYBRID_TASKS.DESIGNS,
    validator: (content) => {
      const rules = parseBaseValuesResponse(content)
      return rules.length > 0 && rules.every((rule) => validateBaseValue(rule, safeChart))
    },
    fallback: JSON.stringify({ values: [] }),
    onStatus,
    signal,
  })
  const rules = parseBaseValuesResponse(raw)
  return rules.filter((rule) => validateBaseValue(rule, safeChart))
}

function parseBaseValuesResponse(raw) {
  const parsed = parseJSONOrRepair(raw, "El asistente de IA no devolvio valores de talla base validos.")
  const list = parsed && Array.isArray(parsed.values) ? parsed.values : []
  return list
    .filter((r) => r && typeof r.pomId === "string" && r.pomId.trim())
    .map((r) => ({ pomId: r.pomId.trim(), value: r.value, unit: typeof r.unit === "string" ? r.unit : "cm", why: typeof r.why === "string" ? r.why : "" }))
}

// Pure - writes each already-validated base value into its POM's base-size
// cell and marks the row "suggested" (see sizeChart.js's newPom comment):
// held to the exact same must-verify bar as a derived row, never printed as
// if it were measured. Never called with an unvalidated rule;
// validateBaseValue is the gate, this is just the fold.
export function applyProposedBaseValues(chart, rules) {
  const safeChart = chart || { poms: [], baseSize: "M", sizes: [] }
  const byPom = new Map((rules || []).map((rule) => [rule.pomId, rule]))
  const poms = (safeChart.poms || []).map((pom) => {
    const rule = byPom.get(pom.id)
    if (!rule) return pom
    const value = convertMeasure(rule.value, rule.unit || pom.unit, pom.unit)
    if (value === null) return pom
    return { ...pom, values: { ...pom.values, [safeChart.baseSize]: value }, source: "suggested", verified: false }
  })
  return { ...safeChart, poms }
}
