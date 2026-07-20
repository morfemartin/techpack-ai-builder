import { deepseekChat } from "./deepseekClient.js"
import { HYBRID_TASKS } from "./hybridTasks.js"

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION REVIEW — the 4th round: "think like a technical designer."
//
// The existing review (reviewDiff.js) only asks "does the document carry
// what the intake already said?" This round is different: given EVERYTHING
// already decided (material, technique, position, colors), it reasons about
// the production-critical details that can ONLY be asked once those are
// known - the concrete example that drove this: a button design page already
// has material and position decided, so a technical designer's next
// questions are "how many buttons?", "what spacing between them?", "does the
// placket flip side between men's and women's?" - never generic, always the
// specific gap that would otherwise be left to the factory to guess.
//
// Two halves, same shape as every other hybrid task in this app:
//   - fallbackProductionQuestions(): a deterministic per-technique checklist
//     (buttons/zipper/embroidery/pocket/hem), so this round works with zero
//     AI availability.
//   - authorProductionQuestions(): the AI half (NVIDIA+Qwen hybrid,
//     HYBRID_TASKS.REVIEW), which reasons freely across ALL the collected
//     data instead of being limited to the fixed rule table.
// ─────────────────────────────────────────────────────────────────────────────

const TECHNIQUE_RULES = [
  {
    id: "buttons",
    match: /boton|button/i,
    questions: (subject) => [
      { suffix: "count", label: "¿Cuántos botones lleva " + subject + "?", options: ["1-2", "3-4", "5 o más", "A definir con fábrica"], why: "define avíos y tiempo de máquina" },
      { suffix: "spacing", label: "¿Qué distancia hay entre los botones de " + subject + "?", options: ["Equidistante", "Agrupados en pares", "Espaciado creciente hacia abajo", "A definir con fábrica"], why: "sin esto la fábrica improvisa el patrón de ojales" },
      { suffix: "gendered_side", label: "¿La botonadura cambia de lado entre versión femenina y masculina?", options: ["Sí, cruce opuesto en femenino", "No, mismo lado siempre", "Solo hay una versión"], why: "un cruce incorrecto es un defecto de producción clásico" },
    ],
  },
  {
    id: "embroidery",
    match: /bordad|embroider/i,
    questions: (subject) => [
      { suffix: "thread_color", label: "¿El color de hilo del bordado en " + subject + " está confirmado en Pantone o referencia física?", options: ["Sí, Pantone/hex exacto", "Aproximado, a definir con fábrica", "Igual al color base de tela"], why: "el hilo bordado rara vez matchea el Pantone de tela sin muestra física" },
      { suffix: "backing", label: "¿Qué backing/estabilizador lleva el bordado en " + subject + "?", options: ["Cut-away", "Tear-away", "Sin backing", "A definir con fábrica"], why: "define si el bordado deforma la tela" },
    ],
  },
  {
    id: "closure-zipper",
    match: /zipper|cierre|cremallera/i,
    questions: (subject) => [
      { suffix: "pull", label: "¿Qué tipo de tirador lleva el cierre de " + subject + "?", options: ["Estándar metálico", "Tirador de tela a juego", "Tirador con logo", "A definir con fábrica"], why: "el tirador es un punto de marca y de falla frecuente" },
      { suffix: "length", label: "¿El largo del cierre de " + subject + " ya está confirmado?", options: ["Sí, medido", "Aproximado, a confirmar en fitting", "A definir con fábrica"], why: "un cierre mal medido no cierra bien la prenda" },
    ],
  },
  {
    id: "pocket",
    match: /bolsill|pocket/i,
    questions: (subject) => [
      { suffix: "depth", label: "¿La profundidad del bolsillo de " + subject + " está definida?", options: ["Sí, medida exacta", "Proporcional a la prenda", "A definir con fábrica"], why: "un bolsillo muy chico o grande cambia la funcionalidad" },
      { suffix: "bartack", label: "¿Lleva refuerzo (bartack) en las esquinas del bolsillo?", options: ["Sí", "No", "A definir con fábrica"], why: "sin refuerzo el bolsillo se rasga en uso" },
    ],
  },
  {
    id: "hem",
    match: /dobladillo|\bbajo\b|hem/i,
    questions: (subject) => [
      { suffix: "width", label: "¿El ancho del dobladillo de " + subject + " está definido?", options: ["Estándar (2-3 cm)", "Angosto", "Ancho / doble puntada", "A definir con fábrica"], why: "cambia el consumo de tela y la máquina a usar" },
    ],
  },
]

function subjectsFrom({ parts, designs }) {
  const subjects = []
  ;(designs || []).forEach((d) => {
    if (!d) return
    subjects.push({ key: "design:" + (d.name || ""), label: "el diseño \"" + (d.name || "sin nombre") + "\"", text: [d.name, d.tec, d.posDetail, d.notes].filter(Boolean).join(" ") })
  })
  ;(parts || []).forEach((p) => {
    if (!p || p.on === false) return
    subjects.push({ key: "part:" + (p.id || ""), label: "la pieza \"" + (p.id || "") + "\"", text: String(p.val || "") })
  })
  return subjects
}

// The deterministic floor: never zero AI, never zero questions when there is
// an obvious production-relevant technique in the collected data.
export function fallbackProductionQuestions({ parts, designs } = {}) {
  const subjects = subjectsFrom({ parts, designs })
  const fields = []
  const seenTopics = new Set()
  for (const subject of subjects) {
    for (const rule of TECHNIQUE_RULES) {
      if (!rule.match.test(subject.text)) continue
      const topicKey = rule.id + ":" + subject.key
      if (seenTopics.has(topicKey)) continue
      seenTopics.add(topicKey)
      for (const q of rule.questions(subject.label)) {
        fields.push({
          key: "production:" + rule.id + ":" + subject.key + ":" + q.suffix,
          label: q.label,
          category: "production",
          status: "ask",
          options: q.options,
          why: q.why,
        })
      }
    }
  }
  return fields
}

// The AI half: reasons freely across everything already decided (not limited
// to the fixed rule table above) for the production-critical gaps a senior
// technical designer would still flag. Hybrid (NVIDIA+Qwen); on any failure
// the deterministic checklist ships instead - this round never blocks export.
export async function authorProductionQuestions({ hdr, parts, designs } = {}) {
  const fallback = fallbackProductionQuestions({ parts, designs })
  const activeParts = (parts || []).filter((p) => p && p.on !== false)
  const activeDesigns = (designs || []).filter(Boolean)
  if (activeDesigns.length === 0 && activeParts.length === 0) return []

  const prompt =
    "Sos un disenador tecnico senior haciendo la ULTIMA revision de produccion antes de mandar esta ficha a fabrica. " +
    "Ya se decidio todo lo general (tela, calce, construccion) y el detalle de cada diseno (tecnica, posicion, colores). " +
    "Tu trabajo es pensar, SOLO a partir de estos datos ya conocidos, que detalles de PRODUCCION todavia faltan para que la fabrica " +
    "no tenga que inventar nada y el resultado sea fiel a la intencion del cliente. Pensa en terminos de: cantidad exacta de elementos " +
    "repetidos (botones, ojales, remaches), distancias/espaciados entre ellos, si algo cambia entre version femenina y masculina o entre " +
    "talles, colores exactos de hilos/herrajes, y tolerancias de fabricacion. NO repreguntes nada que ya este en los datos - solo lo que falta.\n\n" +
    "Header: " + JSON.stringify(hdr || {}) + "\n" +
    "Piezas activas: " + JSON.stringify(activeParts) + "\n" +
    "Disenos: " + JSON.stringify(activeDesigns) + "\n\n" +
    "Devolve SOLO JSON valido, sin markdown, con esta forma exacta (maximo 8 preguntas, las MAS criticas primero):\n" +
    '{"questions":[{"key":"identificador_corto","label":"Pregunta en espanol","options":["Opcion A","Opcion B"],"why":"por que importa (breve)"}]}'

  const raw = await deepseekChat({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1800,
    temperature: 0.2,
    task: HYBRID_TASKS.REVIEW,
    validator: (content) => {
      try {
        const value = JSON.parse(content.replace(/```json|```/g, "").trim())
        return Array.isArray(value.questions) && value.questions.length > 0 && value.questions.every((q) => q && typeof q.key === "string" && typeof q.label === "string" && Array.isArray(q.options) && q.options.length >= 2)
      } catch {
        return false
      }
    },
    fallback: JSON.stringify({ questions: fallback.map((f) => ({ key: f.key, label: f.label, options: f.options, why: f.why })) }),
  })

  let parsed
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    return fallback
  }
  const questions = Array.isArray(parsed.questions) ? parsed.questions : []
  if (questions.length === 0) return fallback
  return questions
    .filter((q) => q && typeof q.key === "string" && typeof q.label === "string" && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, 8)
    .map((q) => ({
      key: "production:ai:" + q.key.trim(),
      label: q.label,
      category: "production",
      status: "ask",
      options: q.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 4),
      why: q.why || "detalle de producción identificado en la revisión final",
    }))
}
