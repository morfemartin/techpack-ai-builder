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

// Spanish contracts "de + el" into "del". The subjects below read
// 'el diseño "X"' / 'la pieza "Y"', so a naive `"de " + subject` produced
// "de el diseño" in every question that needed a genitive.
function of(subject) {
  const text = String(subject || "")
  return text.startsWith("el ") ? "del " + text.slice(3) : "de " + text
}

const TECHNIQUE_RULES = [
  {
    id: "buttons",
    match: /boton|button/i,
    questions: (subject) => [
      { suffix: "count", label: "¿Cuántos botones lleva " + subject + "?", options: ["1-2", "3-4", "5 o más", "A definir con fábrica"], why: "define avíos y tiempo de máquina" },
      { suffix: "spacing", label: "¿Qué distancia hay entre los botones " + of(subject) + "?", options: ["Equidistante", "Agrupados en pares", "Espaciado creciente hacia abajo", "A definir con fábrica"], why: "sin esto la fábrica improvisa el patrón de ojales" },
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
      { suffix: "pull", label: "¿Qué tipo de tirador lleva el cierre " + of(subject) + "?", options: ["Estándar metálico", "Tirador de tela a juego", "Tirador con logo", "A definir con fábrica"], why: "el tirador es un punto de marca y de falla frecuente" },
      { suffix: "length", label: "¿El largo del cierre " + of(subject) + " ya está confirmado?", options: ["Sí, medido", "Aproximado, a confirmar en fitting", "A definir con fábrica"], why: "un cierre mal medido no cierra bien la prenda" },
    ],
  },
  {
    id: "pocket",
    match: /bolsill|pocket/i,
    questions: (subject) => [
      { suffix: "depth", label: "¿La profundidad del bolsillo " + of(subject) + " está definida?", options: ["Sí, medida exacta", "Proporcional a la prenda", "A definir con fábrica"], why: "un bolsillo muy chico o grande cambia la funcionalidad" },
      { suffix: "bartack", label: "¿Lleva refuerzo (bartack) en las esquinas del bolsillo?", options: ["Sí", "No", "A definir con fábrica"], why: "sin refuerzo el bolsillo se rasga en uso" },
    ],
  },
  {
    id: "hem",
    // No bare "bajo" (Spanish for "below/under") - it false-matched ordinary
    // position language like "80mm bajo costura de hombro" (a logo's
    // posDetail, nothing to do with a hem), tying a hem question to whatever
    // design happened to mention a placement below something.
    match: /dobladillo|\bruedo\b|\bbastilla\b|\bhem\b/i,
    questions: (subject) => [
      { suffix: "width", label: "¿El ancho del dobladillo " + of(subject) + " está definido?", options: ["Estándar (2-3 cm)", "Angosto", "Ancho / doble puntada", "A definir con fábrica"], why: "cambia el consumo de tela y la máquina a usar" },
    ],
  },
  {
    id: "print",
    match: /serigraf|estampad|sublimac|dtf|impresion|print/i,
    questions: (subject) => [
      { suffix: "color_count", label: "¿Cuántos colores/tintas lleva la estampa " + of(subject) + "?", options: ["1 color", "2-3 colores", "4 o más (proceso)", "A definir con fábrica"], why: "cada color extra es una pantalla/pasada mas y sube el costo" },
      { suffix: "wash_durability", label: "¿Que durabilidad al lavado necesita la estampa " + of(subject) + "?", options: ["Estandar (uso normal)", "Alta (industrial/deportivo)", "A definir con fábrica"], why: "define la tinta y el curado; una estampa mal curada se agrieta" },
    ],
  },
  {
    id: "patch",
    match: /parche|patch/i,
    questions: (subject) => [
      { suffix: "attachment", label: "¿Cómo se fija el parche " + of(subject) + " a la prenda?", options: ["Cosido perimetral", "Termosellado", "Velcro (removible)", "A definir con fábrica"], why: "el método de fijación cambia el proceso y si el parche es removible" },
      { suffix: "edge_finish", label: "¿Qué terminación de borde lleva el parche " + of(subject) + "?", options: ["Borde termosellado", "Bordado overlock", "Borde crudo", "A definir con fábrica"], why: "sin esto el borde del parche se deshilacha en uso" },
    ],
  },
]

// Designs first on purpose: they are the specific, named elements, so when a
// rule fires for both a design and a construction part the design wins (see
// the dedupe in fallbackProductionQuestions).
function subjectsFrom({ parts, designs }) {
  const subjects = []
  ;(designs || []).forEach((d) => {
    if (!d) return
    subjects.push({ kind: "design", key: "design:" + (d.name || ""), label: "el diseño \"" + (d.name || "sin nombre") + "\"", text: [d.name, d.tec, d.posDetail, d.notes].filter(Boolean).join(" ") })
  })
  ;(parts || []).forEach((p) => {
    if (!p || p.on === false) return
    // Prefer a human label when the caller has one (the intake passes the
    // question label, e.g. "Cierre / botonadura"); fall back to the raw id,
    // which downstream is often just a BOM row number.
    const name = String((p.label || p.id) ?? "").trim()
    subjects.push({ kind: "part", key: "part:" + (p.id ?? name), label: "la pieza \"" + name + "\"", text: String(p.val || "") })
  })
  return subjects
}

// The deterministic floor: never zero AI, never zero questions when there is
// an obvious production-relevant technique in the collected data.
export function fallbackProductionQuestions({ parts, designs } = {}) {
  const subjects = subjectsFrom({ parts, designs })
  const fields = []
  const seenTopics = new Set()
  const rulesCoveredByADesign = new Set()
  const seenLabels = new Set()

  for (const subject of subjects) {
    for (const rule of TECHNIQUE_RULES) {
      if (!rule.match.test(subject.text)) continue
      // A construction part must not re-ask what a named design already
      // covers. Observed live: a "Cierre: Botones" part and a design literally
      // named "Botones" are the same physical placket, and the walk asked
      // "¿Cuántos botones...?" twice in a row, which reads like a bug.
      if (subject.kind === "part" && rulesCoveredByADesign.has(rule.id)) continue
      const topicKey = rule.id + ":" + subject.key
      if (seenTopics.has(topicKey)) continue
      seenTopics.add(topicKey)
      if (subject.kind === "design") rulesCoveredByADesign.add(rule.id)
      for (const q of rule.questions(subject.label)) {
        // Garment-level questions (the gendered placket side, a pocket's
        // bartack) word themselves without a subject, so two subjects hitting
        // the same rule would otherwise emit the identical sentence twice.
        if (seenLabels.has(q.label)) continue
        seenLabels.add(q.label)
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
    "Ya se decidio todo lo general (tela, calce, construccion) y el detalle de cada diseno (tecnica, posicion, colores).\n\n" +
    "Header: " + JSON.stringify(hdr || {}) + "\n" +
    "Piezas activas: " + JSON.stringify(activeParts) + "\n" +
    "Disenos: " + JSON.stringify(activeDesigns) + "\n\n" +
    "REGLA 1 - solo sobre lo que EXISTE. Cada pregunta tiene que referirse a un elemento que aparece EN LOS DATOS de arriba. " +
    "Si la ficha dice 'Sin cierre', la prenda no tiene botones ni remaches y preguntar por ellos es un error grave. " +
    "Antes de escribir una pregunta, verifica en que linea de los datos aparece ese elemento. Si no aparece, no lo preguntes.\n" +
    "REGLA 2 - solo lo que FALTA. Si el dato ya esta resuelto arriba, no lo repreguntes ni pidas confirmarlo.\n" +
    "REGLA 3 - si no falta nada critico, devolve \"questions\": []. Una lista vacia es una respuesta correcta y esperada; " +
    "es MUCHO mejor que inventar preguntas de relleno. No completes hasta un numero.\n\n" +
    "Que cuenta como pregunta valida: un detalle de fabricacion que la fabrica tendria que ADIVINAR para producir esta prenda " +
    "concreta, y que no se puede deducir de los datos - cantidades y espaciados de elementos que la ficha ya dice que existen, " +
    "colores exactos de hilos o herrajes que ya estan nombrados, tolerancias, o variaciones entre talles.\n\n" +
    "Devolve SOLO JSON valido, sin markdown, con esta forma exacta (maximo 8 preguntas, las MAS criticas primero, o [] si no falta nada):\n" +
    '{"questions":[{"key":"identificador_corto","label":"Pregunta en espanol","options":["Opcion A","Opcion B"],"why":"por que importa (breve)"}]}'

  const raw = await deepseekChat({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1800,
    temperature: 0.2,
    task: HYBRID_TASKS.REVIEW,
    // An EMPTY list is a valid answer - "nothing critical is missing" is the
    // right call on a simple garment, and rejecting it (as this used to) left
    // the model structurally unable to say so: the empty answer was thrown
    // away and the deterministic checklist ran instead, which is exactly the
    // filler this round is supposed to avoid.
    validator: (content) => {
      try {
        const value = JSON.parse(content.replace(/```json|```/g, "").trim())
        return Array.isArray(value.questions) && value.questions.every((q) => q && typeof q.key === "string" && typeof q.label === "string" && Array.isArray(q.options) && q.options.length >= 2)
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
  // A deliberate empty list is respected, not overridden. Falling back here
  // would mean the reviewer can never conclude "nothing is missing" - the
  // only way to get no questions would be for the whole call to fail.
  if (questions.length === 0) return []
  return questions
    .filter((q) => q && typeof q.key === "string" && typeof q.label === "string" && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, 8)
    .map((q) => {
      const trimmedKey = q.key.trim()
      // A key that already carries the "production:<rule>:design|part:<name>:<suffix>"
      // shape came straight from `fallback` above (the hybrid call fell through
      // to it and it round-tripped through JSON unchanged) - keep it as-is so
      // applyReviewAnswers() can still route it to the right part/design.
      // Only a genuinely freeform AI-authored key (no fixed subject) gets the
      // "ai:" tag; re-prefixing an already-qualified key here would silently
      // break that routing and dump every answer onto the first design.
      const key = trimmedKey.startsWith("production:") ? trimmedKey : "production:ai:" + trimmedKey
      return {
        key,
        label: q.label,
        category: "production",
        status: "ask",
        options: q.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 4),
        why: q.why || "detalle de producción identificado en la revisión final",
      }
    })
}
