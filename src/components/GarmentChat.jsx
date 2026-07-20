import { useState, useRef, useEffect } from "react"
import { DeepSeekError } from "../core/deepseekClient.js"
import {
  analyzeRequirements, analyzeDesignExpression, mergeDesignFields, pendingFields, applyAnswer, skipField, revertField,
  looksLikeQuestion, answerFieldQuestion, analyzeAdditionalNotes, reqsToParts, reqsToDesigns, authorIllustrationBriefs,
  attachIllustrationBriefs, FIELD_STATUS, fallbackRequirements,
} from "../core/techpackRequirements.js"
import { downscaleImage, answerFieldFromImage } from "../core/visionExtract.js"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"

const C = palette
const hair = `1px solid ${C.ink.hex}`

const OPENING = "¿Qué prenda querés armar? (por ejemplo: Polo, Hoodie, Camisa, Jogger)"
// Phase-aware "systemic thinking" intake (F3.1). Instead of a free-form
// per-turn DeepSeek conversation, it makes ONE requirements call up front
// (analyzeRequirements) and then WALKS the resulting field list locally:
// skips what's standard/obvious, and asks only what genuinely defines the
// product, one at a time, with numbered options. Cheap and predictable at
// runtime no matter how long the intake gets.
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
  const analysisRun = useRef(0)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, sending, currentField])

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
    return field.why ? field.label + " — " + field.why : field.label
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
      } else if (reqsToDesigns(nextReqs).length > 0) {
        post("assistant", "Ya tengo los diseños. Ahora redacto la instrucción de ilustración para cada página…")
        setPhase("briefing")
        runBriefAuthoring(nextReqs)
      } else {
        post("assistant", "Listo, ya tengo todo lo necesario para armar la ficha. Podés continuar.")
        finishIntake(nextReqs)
      }
      return
    }
    setCurrentField(pending[0])
    post("assistant", questionText(pending[0]))
  }

  async function runAnalysis(garmentType) {
    const runId = ++analysisRun.current
    setSending(true)
    setError(null)
    setLiveReply("Estoy construyendo las preguntas técnicas de esta prenda…")
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
      if (analysisRun.current !== runId) return
      setReqs(analysis)
      const assumed = analysis.fields.filter((f) => f.status === FIELD_STATUS.ASSUMED && String(f.value || "").trim())
      if (assumed.length > 0) {
        post("assistant", "Para una " + (analysis.garmentType || garmentType) + " doy por estándar: " + assumed.map((f) => f.label + " (" + f.value + ")").join(", ") + ". Si algo no aplica lo corregís después. Ahora, lo que define tu prenda:")
      }
      setPhase("asking")
      askNext(analysis, "general")
    } catch (e) {
      analysisRun.current += 1 // ignore late progress from the timed-out IA call
      const localReqs = fallbackRequirements(garmentType, seed || {})
      setReqs(localReqs)
      setPhase("asking")
      setError(null)
      post("assistant", "La IA está saturada o tardó demasiado, así que arranco con preguntas base para " + garmentType + " y seguimos sin bloquearnos.")
      askNext(localReqs, "general")
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
      const merged = mergeDesignFields(generalReqs, designAnalysis.fields)
      setReqs(merged)
      setPhase("designing")
      askNext(merged, "design")
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudieron analizar los diseños. Podés continuar igual.")
      post("assistant", "No pude analizar los diseños todavía, pero podés continuar igual y agregarlos después.")
      finishIntake(generalReqs)
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
      post("assistant", "Listo, ya tengo todo lo necesario para armar la ficha, con instrucciones de ilustración incluidas. Podés continuar.")
      finishIntake(finalReqs)
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudieron redactar los briefs de ilustración. Podés continuar igual.")
      post("assistant", "No pude redactar las instrucciones de ilustración todavía, pero podés continuar igual.")
      finishIntake(finalReqs)
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

  // Mid-chat photo upload (F1.5's sibling): answers whatever field is
  // currently on screen from a photo instead of typed text. Deliberately a
  // single quick vision call (no quadrant split - that's for the exhaustive
  // upfront intake, not a one-question lookup) and deliberately PRE-FILLS the
  // input rather than auto-submitting, so a wrong read never locks in silently.
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
      const downscaled = await downscaleImage(file)
      post("user", <img src={"data:image/jpeg;base64," + downscaled.base64} alt="Foto adjunta" style={{ display: "block", maxWidth: 160, maxHeight: 160, objectFit: "cover", border: hair }} />)
      const suggestion = await answerFieldFromImage({
        field: fieldAsked,
        garmentType: garmentLabel || (reqs && reqs.garmentType),
        imageBase64: downscaled.base64,
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
    if ((phase === "asking" || phase === "designing") && currentField && looksLikeQuestion(value)) return submitTangentQuestion(value)
    if (phase === "asking" || phase === "designing") return submitAnswer(value)
    if (phase === "finalCheck") return submitExtraNotes(value)
  }

  function buildDraft() {
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
      notes: extraNotes,
    }
  }

  const inputActive = phase === "naming" || phase === "asking" || phase === "designing" || phase === "finalCheck"
  const backAvailable = answerStack.length > 0 && answerStack[answerStack.length - 1].phase === phase && (phase === "asking" || phase === "designing")
  const knownParts = reqs ? reqsToParts(reqs) : []
  const designsSoFar = reqs ? reqsToDesigns(reqs) : []
  const pendingCategory = phase === "designAnalyzing" || phase === "designing" ? "design" : "general"
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
          {(phase === "asking" || phase === "designing") && currentField && currentField.options && currentField.options.length > 0 && !sending && (
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
                ? (imageProgress && imageProgress.partialText ? "Analizando la foto: " + imageProgress.partialText : "Estoy analizando la foto…")
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
            {(phase === "asking" || phase === "designing") && currentField && (
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
