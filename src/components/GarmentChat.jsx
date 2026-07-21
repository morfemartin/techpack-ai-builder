import { useState, useRef, useEffect } from "react"
import { DeepSeekError } from "../core/deepseekClient.js"
import {
  analyzeDesignExpression, mergeDesignFields, pendingFields, applyAnswer, skipField, revertField,
  looksLikeQuestion, answerFieldQuestion, analyzeAdditionalNotes, reqsToParts, reqsToDesigns, authorIllustrationBriefs, fallbackDesignFields,
  attachIllustrationBriefs, FIELD_STATUS, analyzeRequirements,
} from "../core/techpackRequirements.js"
import { answerFieldFromImageSegments, splitImageIntoQuadrants } from "../core/visionExtract.js"
import { authorProductionQuestions } from "../core/productionReview.js"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"

const C = palette
const hair = `1px solid ${C.ink.hex}`

const OPENING = "¿Qué prenda querés armar? (por ejemplo: Polo, Hoodie, Camisa, Jogger)"
// Phase-aware "systemic thinking" intake (F3.1). Instead of a free-form
// per-turn DeepSeek conversation, it builds a deterministic requirements
// contract up front and then WALKS that list locally. A model may enrich a
// photo, answer a doubt, or identify a design later, but it is never a
// dependency for publishing the first useful technical question.
//
// Phases: "naming" (ask what garment) -> "analyzing" (general requirements
// call) -> "asking" (walk pending general fields) -> "designAnalyzing" (F3.2:
// a second DeepSeek call reasons about which discrete elements - logo,
// embroidery, personalized hardware, etc. - need their own design page) ->
// "designing" (walk pending design fields, same numbered-options UI) ->
// "briefing" (F3.3: a third DeepSeek call authors a concrete illustration
// brief per design element, skipped entirely if there are none) -> "ready"
// (build + continue). Design-level fields share the same `reqs.fields` array
// as general ones (tagged `category: "design"`), so pendingFields/
// applyAnswer/isComplete need zero changes to work for both passes.

function Bubble({ role: msgRole, children }) {
  const isUser = msgRole === "user"
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
        padding: `${space(2)}px ${space(3)}px`,
        background: isUser ? C.white.hex : role.priority.fill,
        color: isUser ? C.ink.hex : role.priority.on,
        border: isUser ? hair : "none",
        fontSize: type.size.sm,
        fontFamily: type.fonts.ui,
        lineHeight: 1.4,
        whiteSpace: "pre-line",
      }}
    >
      {children}
    </div>
  )
}

export function GarmentChat({ onComplete, tecs, seed, initialGarmentType, generalOnly }) {
  const [phase, setPhase] = useState(initialGarmentType ? "analyzing" : "naming")
  const [history, setHistory] = useState([{ role: "assistant", content: initialGarmentType ? "Analizando la prenda…" : OPENING }])
  const [reqs, setReqs] = useState(null)
  const [briefs, setBriefs] = useState([]) // F3.3: [{ name, illustrationBrief }] authored once designs are done
  const [garmentLabel, setGarmentLabel] = useState(initialGarmentType || "")
  const [currentField, setCurrentField] = useState(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [liveReply, setLiveReply] = useState("")
  const [aiStatus, setAIStatus] = useState("")
  const [error, setError] = useState(null)
  // Stack of {key, phase} pushed right before each askNext() advance - lets
  // "Volver" undo the most recent answer/skip. Scoped to the CURRENT walk on
  // purpose: only the top entry matching today's `phase` is poppable, so
  // rewinding can never cross a boundary where a different DeepSeek call
  // (design analysis, brief authoring) already ran off the old answer.
  const [answerStack, setAnswerStack] = useState([])
  const [extraNotes, setExtraNotes] = useState("") // raw text from the "finalCheck" catch-all step
  const [imageAnalyzing, setImageAnalyzing] = useState(false) // true only while a mid-chat photo is being read
  const [imageProgress, setImageProgress] = useState(null) // { partialText, tokensSoFar } | null
  const scrollRef = useRef(null)
  const analyzedFor = useRef(null)
  // Monotonic id for the layer-1 investigation. Only the newest run may write
  // its result, so a slow call that lands after the user rewound the garment
  // name can never overwrite the analysis that replaced it.
  const analysisRun = useRef(0)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, sending, currentField])

  // The three question-walking phases: layer 1 (construction), layer 2
  // (designs), layer 3 (production refinement). They all drive the same
  // numbered-options walker, so everything that gates on "is the user
  // answering a question right now" keys off this instead of re-listing them.
  const isWalking = phase === "asking" || phase === "designing" || phase === "refining"

  // Kick off the up-front analysis when a garment type is known (either passed
  // in by a seed door, or once the user names it). Guarded so it runs once per
  // garment type even under React StrictMode double-invocation.
  useEffect(() => {
    if (phase !== "analyzing") return
    if (analyzedFor.current === garmentLabel) return
    analyzedFor.current = garmentLabel
    runAnalysis(garmentLabel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, garmentLabel])

  function post(role_, content) {
    setHistory((h) => [...h, { role: role_, content }])
  }

  function questionText(field) {
    const heading = field.layer ? field.layer.toUpperCase() + "\n" + field.label : field.label
    const purpose = field.why ? "\nPara la ficha: " + field.why + "." : ""
    const example = field.example ? "\n" + field.example : ""
    return heading + purpose + example
  }

  function showStructuredStream(progressUpdate, action) {
    const labels = progressUpdate && progressUpdate.completedLabels ? progressUpdate.completedLabels : []
    if (labels.length > 0) {
      setLiveReply(action + "\n" + labels.map((label) => "✓ " + label).join("\n"))
    }
  }

  // Every path that finishes the walk (4 non-generalOnly sites: no-designs
  // here, runDesignAnalysis's catch, runBriefAuthoring's success AND catch)
  // routes through here instead of setting "ready" directly - centralizes the
  // generalOnly-skips-it branch and the new open-ended "finalCheck" step in
  // one place instead of duplicating the branch at every call site.
  function finishIntake(finalReqs) {
    setReqs(finalReqs)
    setCurrentField(null)
    if (generalOnly) {
      setPhase("ready")
      return
    }
    setPhase("finalCheck")
    post("assistant", "¿Hay algo que no te haya preguntado y creas importante para la fábrica? Podés escribirlo, o tocar \"Nada más\" para continuar.")
  }

  function askNext(nextReqs, category) {
    const pending = pendingFields(nextReqs, category)
    if (pending.length === 0) {
      setCurrentField(null)
      if (category === "general" && generalOnly) {
        post("assistant", "Listo, ya tengo lo que faltaba. Podés continuar.")
        finishIntake(nextReqs)
      } else if (category === "general") {
        post("assistant", "Ya tengo la construcción general. Ahora reviso qué elementos necesitan su propia página de diseño…")
        setPhase("designAnalyzing")
        runDesignAnalysis(nextReqs)
      } else if (category === "production") {
        // Layer 3 finished - nothing else to investigate.
        finishIntake(nextReqs)
      } else if (reqsToDesigns(nextReqs).length > 0) {
        post("assistant", "Ya tengo los diseños. Ahora redacto la instrucción de ilustración para cada página…")
        setPhase("briefing")
        runBriefAuthoring(nextReqs)
      } else {
        // No design elements, but the construction answers can still hide
        // production decisions worth pinning down (a zipper's pull, a hem's
        // width), so layer 3 runs here too instead of ending the intake.
        startRefinement(nextReqs)
      }
      return
    }
    setCurrentField(pending[0])
    post("assistant", questionText(pending[0]))
  }

  // LAYER 1 - investigate, THEN ask.
  //
  // This waits for the model to study the garment before publishing a single
  // question, and that order is the whole point: it is what makes the intake
  // feel like it looked at YOUR garment instead of reciting a checklist.
  //
  // An earlier revision inverted it - the fixed layer template was published
  // instantly and the model's findings were spliced in afterwards. That reads
  // well on paper (nothing ever stalls) but in practice the questions are
  // answered faster than the model returns, and since an answered question is
  // never rewritten underneath the user, the whole intake ended up generic:
  // the deterministic template was, in effect, the only thing anyone saw.
  //
  // There is no template underneath any more. The fixed layer floor assumed a
  // torso garment, so it asked a pair of socks about its collar, sleeve and
  // chest pocket - incoherent questions presented as if the analysis had gone
  // fine. Coherence is now the model's job at every layer, and when the model
  // cannot deliver we SAY SO (see the catch) instead of quietly substituting a
  // questionnaire that does not belong to this garment.
  async function runAnalysis(garmentType) {
    const runId = ++analysisRun.current
    setSending(true)
    setError(null)
    setLiveReply("Estoy estudiando esta prenda: qué lleva y qué necesita la ficha…")
    try {
      const analysis = await analyzeRequirements({
        garmentType,
        seed: seed || {},
        tecs,
        lang: "ES",
        onStatus: setAIStatus,
        onProgress: (p) => {
          if (analysisRun.current === runId) showStructuredStream(p, "Ya identifiqué estas decisiones de producción:")
        },
      })
      // A newer analysis (or a rewound garment name) supersedes this one.
      if (analysisRun.current !== runId) return

      setReqs(analysis)

      // Saying out loud what it already settled is the visible proof that it
      // investigated - and it spares the user a pile of questions whose answer
      // is standard for this garment anyway.
      const assumed = analysis.fields.filter((f) => f.status === FIELD_STATUS.ASSUMED && String(f.value || "").trim())
      if (assumed.length > 0) {
        post("assistant", "Para una " + (analysis.garmentType || garmentType) + " doy por estandar: " + assumed.map((f) => f.label + " (" + f.value + ")").join(", ") + ". Si algo no aplica lo corregis despues. Ahora, lo que define tu prenda:")
      }
      setPhase("asking")
      askNext(analysis, "general")
    } catch (e) {
      analysisRun.current += 1 // ignore late progress from the timed-out call
      // Fail visibly. Substituting a generic questionnaire here would read as
      // success and quietly put questions in the tech pack that were never
      // reasoned about - worse than no questions at all.
      setReqs(null)
      setCurrentField(null)
      setPhase("analysisFailed")
      setError(e instanceof DeepSeekError ? e.message : "No se pudo analizar la prenda.")
      post("assistant", "No pude analizar esta prenda: " + (e instanceof DeepSeekError ? e.message : "los modelos no respondieron a tiempo") + ".\n\nNo voy a inventar preguntas genericas para disimularlo. Proba de nuevo, o revisa que la IA este disponible.")
    } finally {
      setSending(false)
      setLiveReply("")
    }
  }

  // Second DeepSeek call (F3.2): reasons about which discrete elements of
  // THIS garment need their own design page, given the general answers just
  // collected. A failure here degrades gracefully - it's an enhancement over
  // the F3.1 flow, not a hard requirement, so the user can still finish with
  // no designs (App.jsx already falls back to one blank design in that case).
  async function runDesignAnalysis(generalReqs) {
    setSending(true)
    setError(null)
    setLiveReply("Estoy revisando qué aplicaciones necesitan su propia especificación…")
    try {
      const designAnalysis = await analyzeDesignExpression({
          garmentType: garmentLabel || generalReqs.garmentType,
          generalFields: reqsToParts(generalReqs),
          tecs,
          lang: "ES",
          onStatus: setAIStatus,
          onProgress: (p) => showStructuredStream(p, "Ya detecté estas especificaciones de diseño:"),
      })
      const fields = designAnalysis.fields.length > 0 ? designAnalysis.fields : fallbackDesignFields(generalReqs)
      const merged = mergeDesignFields(generalReqs, fields)
      setReqs(merged)
      setPhase("designing")
      askNext(merged, "design")
    } catch (e) {
      const fields = fallbackDesignFields(generalReqs)
      if (fields.length > 0) {
        const merged = mergeDesignFields(generalReqs, fields)
        setReqs(merged)
        setPhase("designing")
        post("assistant", "No pude profundizar los diseños con IA, pero seguimos con las preguntas esenciales de esa aplicacion.")
        askNext(merged, "design")
      } else {
        setError(null)
        post("assistant", "No detecté aplicaciones que requieran una página propia.")
        await startRefinement(generalReqs)
      }
    } finally {
      setSending(false)
      setLiveReply("")
    }
  }

  // Third DeepSeek call (F3.3): once every design element's fields are
  // answered, ask the model to author a concrete illustration brief per
  // element - a placeholder instruction (not invented vector art) shown on
  // the design page until a human illustrator/uploaded image replaces it.
  // Degrades gracefully on failure, same as runDesignAnalysis - a missing
  // brief just means that page falls back to the generic "sube tu diseno"
  // placeholder, not a blocked flow.
  async function runBriefAuthoring(finalReqs) {
    setSending(true)
    setError(null)
    setLiveReply("Estoy redactando las instrucciones para ilustración…")
    try {
      const designs = reqsToDesigns(finalReqs)
      const { briefs: authored } = await authorIllustrationBriefs({
          garmentType: garmentLabel || finalReqs.garmentType,
          designs,
          lang: "ES",
          onStatus: setAIStatus,
          onProgress: (p) => showStructuredStream(p, "Ya quedaron definidos estos elementos:"),
        })
      setBriefs(authored)
      // Awaited so this function's `finally` cannot clear `sending` out from
      // under layer 3's own in-progress indicator.
      await startRefinement(finalReqs)
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudieron redactar los briefs de ilustración. Podés continuar igual.")
      post("assistant", "No pude redactar las instrucciones de ilustración todavía, pero podés continuar igual.")
      await startRefinement(finalReqs)
    } finally {
      setSending(false)
      setLiveReply("")
    }
  }

  // LAYER 3 (F3.4) - production refinement. The first two layers establish
  // WHAT the garment is (construction) and WHAT goes on it (designs). This
  // third pass rereads both together and thinks like a technical designer:
  // given a placket of buttons and an embroidered chest logo, how many
  // buttons, at what spacing, does the closure flip side by gender, what
  // backing does the embroidery need - the questions that are only askable
  // once material, technique and position are already decided, and that the
  // factory would otherwise have to invent.
  //
  // Shares the walker field shape, so pendingFields/applyAnswer/askNext need
  // no special casing beyond the "production" category. Backed by the same
  // deterministic per-technique checklist as the final review, so it still
  // asks something useful with zero AI availability - and it never blocks:
  // any failure just ends the intake normally.
  async function startRefinement(baseReqs) {
    setPhase("refining")
    setSending(true)
    setError(null)
    setLiveReply("Estoy revisando los detalles de producción propios de esta prenda…")
    try {
      const questions = await authorProductionQuestions({
        hdr: {},
        // reqsToParts yields {label, val}; productionReview keys subjects off
        // id/label, so pass the human question label as the part's identity -
        // otherwise every question reads 'la pieza ""'.
        parts: reqsToParts(baseReqs).map((part) => ({ id: part.label, label: part.label, val: part.val, on: true })),
        designs: reqsToDesigns(baseReqs),
      })
      const fields = (questions || [])
        .filter((q) => q && typeof q.key === "string" && q.key.trim() && Array.isArray(q.options) && q.options.length >= 2)
        .map((q) => ({
          key: q.key.trim(),
          label: q.label,
          category: "production",
          layer: "Detalles de produccion",
          status: FIELD_STATUS.ASK,
          value: "",
          options: q.options.slice(0, 4),
          why: q.why || "",
        }))
      if (fields.length === 0) {
        finishIntake(baseReqs)
        return
      }
      const merged = { ...baseReqs, fields: [...baseReqs.fields, ...fields] }
      setReqs(merged)
      post("assistant", "Último repaso, pensando como diseñador técnico: los detalles que la fábrica tendría que adivinar si no los definimos.")
      askNext(merged, "production")
    } catch {
      finishIntake(baseReqs)
    } finally {
      setSending(false)
      setLiveReply("")
    }
  }

  function submitName(value) {
    post("user", value)
    setGarmentLabel(value)
    setPhase("analyzing")
  }

  function submitAnswer(value) {
    post("user", value)
    setAnswerStack((s) => [...s, { key: currentField.key, phase }])
    const nextReqs = applyAnswer(reqs, currentField.key, value)
    setReqs(nextReqs)
    askNext(nextReqs, currentField.category)
  }

  function skipCurrentField() {
    if (!currentField || !currentField.optional || sending) return
    post("user", "Saltar")
    setAnswerStack((s) => [...s, { key: currentField.key, phase }])
    const nextReqs = skipField(reqs, currentField.key)
    setReqs(nextReqs)
    askNext(nextReqs, currentField.category)
  }

  // Undo the most recently answered/skipped field - only while its stack
  // entry still belongs to the CURRENT walk (see answerStack's comment above
  // for why that boundary matters). Purely additive: re-posts the question
  // rather than rewriting history, like a real chat.
  function goBack() {
    if (answerStack.length === 0 || sending) return
    const top = answerStack[answerStack.length - 1]
    if (top.phase !== phase) return
    const reverted = revertField(reqs, top.key)
    setReqs(reverted)
    setAnswerStack((s) => s.slice(0, -1))
    const field = reverted.fields.find((f) => f.key === top.key)
    setCurrentField(field)
    post("assistant", "↩ " + questionText(field))
  }

  // A clarifying question about the CURRENT field ("que es bordado 3d?") -
  // answers it without advancing currentField/phase, so the same numbered
  // options stay right where they were (they render off currentField, not
  // off history) instead of breaking the walk's rigid continuity.
  async function submitTangentQuestion(value) {
    post("user", value)
    setSending(true)
    setError(null)
    setLiveReply("Estoy revisando esa duda…")
    try {
      const answer = await answerFieldQuestion({
        field: currentField,
        garmentType: garmentLabel || (reqs && reqs.garmentType),
        question: value,
        onStatus: setAIStatus,
        onProgress: ({ contentSoFar }) => setLiveReply(contentSoFar || "Estoy revisando esa duda…"),
      })
      post("assistant", answer)
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No pude responder eso. Podés seguir con la pregunta igual.")
    } finally {
      setSending(false)
      setLiveReply("")
    }
  }

  // "finalCheck" free text: tries to turn it into real fields (so it lands in
  // the actual tech pack via reqsToParts/reqsToDesigns), staying in this same
  // phase afterward so the user can add more than one thing before finishing.
  async function submitExtraNotes(value) {
    post("user", value)
    setExtraNotes((n) => (n ? n + "\n" + value : value))
    setSending(true)
    setError(null)
    try {
      const newFields = await analyzeAdditionalNotes({ garmentType: garmentLabel || (reqs && reqs.garmentType), existingFields: reqs.fields, notes: value, onStatus: setAIStatus })
      if (newFields.length > 0) {
        setReqs((r) => mergeDesignFields(r, newFields))
        post("assistant", "Sumado: " + newFields.map((f) => f.label + " (" + f.value + ")").join(", ") + ". ¿Algo más? Si no, tocá \"Nada más\".")
      } else {
        post("assistant", "No pude identificar datos nuevos concretos ahí, pero lo tengo anotado igual. ¿Algo más, o tocás \"Nada más\"?")
      }
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : null)
      post("assistant", "No pude procesarlo con la IA, pero lo tengo anotado igual. ¿Algo más, o tocás \"Nada más\"?")
    } finally {
      setSending(false)
    }
  }

  function finishFinalCheck() {
    post("user", "Nada más")
    setPhase("ready")
    post("assistant", "Listo, ya tengo todo. Podés continuar.")
  }

  // Mid-chat photo upload: answers the current field from one full-image pass
  // plus four native-resolution quadrants. The merged answer still only
  // PRE-FILLS the input, so visual evidence can never lock itself in silently.
  //
  // Posts TWO things to history so the photo actually reads as part of the
  // conversation instead of a silent background action: the photo itself (a
  // thumbnail, so it's clear WHAT was analyzed) and the model's answer as its
  // own bubble (so the suggestion has a visible origin, not just text that
  // mysteriously appeared in the input box). Uses its own imageAnalyzing/
  // imageProgress state rather than the generic sending/progress pair, which
  // is built around the whole-garment analysis bar and would otherwise show
  // a misleading "Analizando la prenda…" stuck at 0%.
  async function handleAttachImage(e) {
    const file = (e.target.files || [])[0]
    e.target.value = ""
    if (!file || !currentField || sending) return
    const fieldAsked = currentField
    setSending(true)
    setImageAnalyzing(true)
    setImageProgress(null)
    setError(null)
    try {
      const segmented = await splitImageIntoQuadrants(file)
      const segments = [segmented.full, ...segmented.quadrants]
      post("user", <img src={"data:image/jpeg;base64," + segmented.full.base64} alt="Foto adjunta" style={{ display: "block", maxWidth: 160, maxHeight: 160, objectFit: "cover", border: hair }} />)
      const suggestion = await answerFieldFromImageSegments({
        field: fieldAsked,
        garmentType: garmentLabel || (reqs && reqs.garmentType),
        segments,
        onProgress: (p) => setImageProgress(p),
      })
      post("assistant", "Según la foto: " + suggestion)
      setInput(suggestion)
    } catch (err) {
      setError(err instanceof DeepSeekError ? err.message : "No se pudo analizar la foto.")
    } finally {
      setSending(false)
      setImageAnalyzing(false)
      setImageProgress(null)
    }
  }

  function send(valueOverride) {
    const value = (valueOverride !== undefined ? valueOverride : input).trim()
    if (!value || sending) return
    setInput("")
    if (phase === "naming") return submitName(value)
    if (isWalking && currentField && looksLikeQuestion(value)) return submitTangentQuestion(value)
    if (isWalking) return submitAnswer(value)
    if (phase === "finalCheck") return submitExtraNotes(value)
  }

  function buildDraft() {
    // Layer 3's answers live in the "production" category, which neither
    // reqsToParts (general) nor reqsToDesigns (design) reads - without this
    // they would be collected in the chat and then silently dropped before
    // ever reaching the tech pack. They ride along as notes, the same channel
    // the finalCheck free text already uses.
    const productionNotes = (reqs && Array.isArray(reqs.fields) ? reqs.fields : [])
      .filter((f) => f.category === "production" && f.status !== FIELD_STATUS.ASK && String(f.value || "").trim())
      .map((f) => f.label + ": " + f.value)
      .join("\n")

    return {
      id: garmentLabel,
      label: garmentLabel,
      parts: reqsToParts(reqs),
      positions: ["Toda la prenda"],
      // A design element added during "finalCheck" (after runBriefAuthoring
      // already ran) never gets its own illustration brief - attachIllustrationBriefs
      // already defaults those to "" (same as any other unmatched design), so
      // this degrades exactly like a normal brief-authoring failure, not a crash.
      designs: attachIllustrationBriefs(reqsToDesigns(reqs), briefs),
      notes: [productionNotes, extraNotes].filter(Boolean).join("\n"),
    }
  }

  const inputActive = isWalking || phase === "naming" || phase === "finalCheck"
  const backAvailable = answerStack.length > 0 && answerStack[answerStack.length - 1].phase === phase && isWalking
  const knownParts = reqs ? reqsToParts(reqs) : []
  const designsSoFar = reqs ? reqsToDesigns(reqs) : []
  const pendingCategory = phase === "refining" ? "production" : phase === "designAnalyzing" || phase === "designing" ? "design" : "general"
  const pendingCount = reqs ? pendingFields(reqs, pendingCategory).length : 0
  const designGroupFields = reqs && currentField && currentField.category === "design" && currentField.designSlot
    ? reqs.fields.filter((f) => f.category === "design" && f.designSlot === currentField.designSlot)
    : []

  return (
    <div style={{ display: "flex", gap: space(4), flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", border: hair, background: C.white.hex, height: 440 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: space(3), display: "flex", flexDirection: "column", gap: space(2) }}>
          {history.map((m, i) => (
            <Bubble key={i} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {phase === "designing" && currentField && designGroupFields.length > 0 && (
            <div style={{ alignSelf: "flex-start", maxWidth: "92%", border: hair, borderLeft: `${space(1)}px solid ${role.highlight.fill}`, background: C.white.hex, color: C.ink.hex, padding: space(2) }}>
              <div style={{ fontSize: type.size.xs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: space(1) }}>
                Sub-preguntas: {currentField.designSlot.replace(/_/g, " ")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: space(1) }}>
                {designGroupFields.map((f, i) => {
                  const isCurrent = f.key === currentField.key
                  const answered = f.status !== FIELD_STATUS.ASK
                  return (
                    <div
                      key={f.key}
                      style={{
                        display: "flex",
                        gap: space(1),
                        alignItems: "center",
                        color: answered ? "#8A909A" : C.ink.hex,
                        fontSize: isCurrent ? type.size.base : type.size.xs,
                        fontWeight: isCurrent ? 700 : 500,
                        background: isCurrent ? role.highlight.fill : "transparent",
                        padding: isCurrent ? `${space(1)}px ${space(2)}px` : 0,
                      }}
                    >
                      <span style={{ width: 15, height: 15, flexShrink: 0, background: answered ? "#8A909A" : role.index.fill, color: C.white.hex, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                      <span>{f.label}{f.optional ? " (opcional)" : ""}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {/* Numbered option chips for the current question - click to answer, or type your own. */}
          {isWalking && currentField && currentField.options && currentField.options.length > 0 && !sending && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: space(1), alignSelf: "flex-start", maxWidth: "90%" }}>
              {currentField.optional && (
                <button
                  onClick={skipCurrentField}
                  style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(2)}px`, background: C.white.hex, border: hair, cursor: "pointer", fontFamily: type.fonts.ui, fontSize: type.size.xs, color: C.ink.hex }}
                >
                  <span style={{ width: 15, height: 15, flexShrink: 0, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>1</span>
                  Saltar
                </button>
              )}
              {currentField.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => send(opt)}
                  style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(2)}px`, background: C.white.hex, border: hair, cursor: "pointer", fontFamily: type.fonts.ui, fontSize: type.size.xs, color: C.ink.hex }}
                >
                  <span style={{ width: 15, height: 15, flexShrink: 0, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + (currentField.optional ? 2 : 1)}</span>
                  {opt}
                </button>
              ))}
            </div>
          )}
          {sending && (
            <Bubble role="assistant">
              {imageAnalyzing
                ? (imageProgress
                    ? `${imageProgress.label || "Analizando foto"} · ${imageProgress.segmentNumber || 1}/${imageProgress.totalSegments || 5}${imageProgress.partialText ? "\n" + imageProgress.partialText : ""}`
                    : "Preparando vista completa y cuatro detalles…")
                : (liveReply || aiStatus || "Estoy procesando la información…")}
              <span aria-hidden="true"> ▍</span>
            </Bubble>
          )}
        </div>
        {error && (
          <div style={{ padding: `${space(2)}px ${space(3)}px`, borderTop: hair, display: "flex", alignItems: "center", gap: space(2), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>
            <Icon name="error" size={16} color={role.index.fill} /> {error}
          </div>
        )}
        {!sending && aiStatus && (
          <div style={{ padding: `${space(1)}px ${space(3)}px`, borderTop: hair, fontSize: type.size.xs, color: C.ink.hex, fontFamily: type.fonts.data, opacity: 0.7 }}>
            {aiStatus}
          </div>
        )}
        {backAvailable && (
          <div style={{ padding: `${space(1)}px ${space(3)}px`, borderTop: hair, display: "flex" }}>
            <button
              onClick={goBack}
              disabled={sending}
              style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(2)}px`, background: "none", border: "none", cursor: sending ? "not-allowed" : "pointer", fontFamily: type.fonts.ui, fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7 }}
            >
              <Icon name="undo" size={14} /> Volver
            </button>
          </div>
        )}
        {inputActive ? (
          <div style={{ display: "flex", borderTop: hair }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send()
              }}
              placeholder={phase === "asking" ? "Elegí una opción, escribí la tuya, o preguntá algo..." : phase === "finalCheck" ? "Algo que no te pregunté (opcional)..." : "Escribí tu respuesta..."}
              disabled={sending}
              style={{ flex: 1, padding: space(3), border: "none", outline: "none", fontFamily: type.fonts.ui, fontSize: type.size.base, background: sending ? "#F7F7F8" : C.white.hex }}
            />
            {isWalking && currentField && (
              <label
                title="Responder esta pregunta con una foto"
                style={{ display: "inline-flex", alignItems: "center", padding: `0 ${space(3)}px`, borderLeft: hair, cursor: sending ? "not-allowed" : "pointer", opacity: sending ? 0.5 : 1 }}
              >
                <Icon name="add_photo_alternate" size={20} color={C.ink.hex} />
                <input type="file" accept="image/png,image/jpeg" disabled={sending} onChange={handleAttachImage} style={{ display: "none" }} />
              </label>
            )}
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `0 ${space(4)}px`, background: sending || !input.trim() ? "#C6CAD2" : role.priority.fill, color: C.white.hex, border: "none", borderLeft: hair, cursor: sending || !input.trim() ? "not-allowed" : "pointer", fontFamily: type.fonts.ui, fontWeight: 700 }}
            >
              <Icon name="send" size={18} color={C.white.hex} />
            </button>
          </div>
        ) : phase === "ready" ? (
          <div style={{ padding: space(3), borderTop: hair, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => onComplete(buildDraft())}
              style={{ display: "inline-flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: role.priority.fill, color: role.priority.on, border: "none", fontFamily: type.fonts.ui, fontWeight: 700, fontSize: type.size.sm, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}
            >
              Continuar con esta prenda <Icon name="arrow_forward" size={18} color={C.white.hex} />
            </button>
          </div>
        ) : null}
        {phase === "finalCheck" && (
          <div style={{ padding: `${space(2)}px ${space(3)}px`, borderTop: hair, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={finishFinalCheck}
              disabled={sending}
              style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(3)}px`, background: C.white.hex, color: C.ink.hex, border: hair, fontFamily: type.fonts.ui, fontWeight: 700, fontSize: type.size.xs, textTransform: "uppercase", letterSpacing: "0.04em", cursor: sending ? "not-allowed" : "pointer" }}
            >
              Nada más, continuar <Icon name="arrow_forward" size={16} color={C.ink.hex} />
            </button>
          </div>
        )}
        {phase === "analysisFailed" && (
          <div style={{ padding: `${space(2)}px ${space(3)}px`, borderTop: hair, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                analyzedFor.current = null
                setError(null)
                setPhase("analyzing")
              }}
              disabled={sending}
              style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(3)}px`, background: role.priority.fill, color: role.priority.on, border: "none", fontFamily: type.fonts.ui, fontWeight: 700, fontSize: type.size.xs, textTransform: "uppercase", letterSpacing: "0.04em", cursor: sending ? "not-allowed" : "pointer" }}
            >
              <Icon name="undo" size={16} color={C.white.hex} /> Reintentar analisis
            </button>
          </div>
        )}
      </div>

      {/* Live draft panel - so the intake is never a black box. */}
      <div style={{ width: 240, flexShrink: 0, border: hair, background: C.white.hex, padding: space(3) }}>
        <div style={{ fontSize: type.size.xs, fontWeight: 700, fontFamily: type.fonts.ui, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: space(2) }}>Borrador</div>
        {!reqs && <p style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.6 }}>Todavía no hay datos.</p>}
        {reqs && (
          <div>
            <div style={{ fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, marginBottom: space(2) }}>{garmentLabel || reqs.garmentType || "..."}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: space(1) }}>
              {knownParts.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: space(1), alignItems: "flex-start", fontSize: type.size.xs }}>
                  <span style={{ width: 16, height: 16, flexShrink: 0, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
                  <span style={{ color: C.ink.hex }}>
                    <b>{p.label}:</b> {p.val}
                  </span>
                </div>
              ))}
            </div>
            {designsSoFar.length > 0 && (
              <div style={{ marginTop: space(2), paddingTop: space(2), borderTop: "1px solid #E6E8EC" }}>
                <div style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: space(1) }}>Diseños (páginas propias)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: space(1) }}>
                  {designsSoFar.map((d, i) => (
                    <div key={i} style={{ display: "flex", gap: space(1), alignItems: "flex-start", fontSize: type.size.xs }}>
                      <span style={{ width: 16, height: 16, flexShrink: 0, background: role.priority.fill, color: role.priority.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
                      <span style={{ color: C.ink.hex }}>
                        <b>{d.name}</b> — {d.pos || "?"} — {d.tec || "?"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pendingCount > 0 && (
              <div style={{ marginTop: space(2), paddingTop: space(2), borderTop: "1px solid #E6E8EC", fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7 }}>
                Faltan {pendingCount} pregunta{pendingCount === 1 ? "" : "s"}.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
