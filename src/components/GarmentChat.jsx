import { useState, useRef, useEffect } from "react"
import { DeepSeekError } from "../core/deepseekClient.js"
import { analyzeRequirements, analyzeDesignExpression, mergeDesignFields, pendingFields, applyAnswer, isComplete, reqsToParts, reqsToDesigns, FIELD_STATUS } from "../core/techpackRequirements.js"
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
// "ready" (build + continue). Design-level fields share the same `reqs.fields`
// array as general ones (tagged `category: "design"`), so pendingFields/
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
      }}
    >
      {children}
    </div>
  )
}

export function GarmentChat({ onComplete, tecs, seed, initialGarmentType }) {
  const [phase, setPhase] = useState(initialGarmentType ? "analyzing" : "naming")
  const [history, setHistory] = useState([{ role: "assistant", content: initialGarmentType ? "Analizando la prenda…" : OPENING }])
  const [reqs, setReqs] = useState(null)
  const [garmentLabel, setGarmentLabel] = useState(initialGarmentType || "")
  const [currentField, setCurrentField] = useState(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null) // { percent, lastLabel } | null - only set while streaming the analysis
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)
  const analyzedFor = useRef(null)

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

  function askNext(nextReqs, category) {
    const pending = pendingFields(nextReqs, category)
    if (pending.length === 0) {
      setCurrentField(null)
      if (category === "general") {
        post("assistant", "Ya tengo la construcción general. Ahora reviso qué elementos necesitan su propia página de diseño…")
        setPhase("designAnalyzing")
        runDesignAnalysis(nextReqs)
      } else {
        setPhase("ready")
        post("assistant", "Listo, ya tengo todo lo necesario para armar la ficha. Podés continuar.")
      }
      return
    }
    setCurrentField(pending[0])
    post("assistant", questionText(pending[0]))
  }

  async function runAnalysis(garmentType) {
    setSending(true)
    setError(null)
    setProgress({ percent: 0, lastLabel: null })
    try {
      const analysis = await analyzeRequirements({
        garmentType,
        seed: seed || {},
        tecs,
        lang: "ES",
        onProgress: (p) => setProgress(p),
      })
      setReqs(analysis)
      const assumed = analysis.fields.filter((f) => f.status === FIELD_STATUS.ASSUMED && String(f.value || "").trim())
      if (assumed.length > 0) {
        post("assistant", "Para una " + (analysis.garmentType || garmentType) + " doy por estándar: " + assumed.map((f) => f.label + " (" + f.value + ")").join(", ") + ". Si algo no aplica lo corregís después. Ahora, lo que define tu prenda:")
      }
      setPhase("asking")
      askNext(analysis, "general")
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudo analizar la prenda. Probá de nuevo.")
      analyzedFor.current = null // allow a retry
    } finally {
      setSending(false)
      setProgress(null)
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
    setProgress({ percent: 0, lastLabel: null })
    try {
      const designAnalysis = await analyzeDesignExpression({
        garmentType: garmentLabel || generalReqs.garmentType,
        generalFields: reqsToParts(generalReqs),
        tecs,
        lang: "ES",
        onProgress: (p) => setProgress(p),
      })
      const merged = mergeDesignFields(generalReqs, designAnalysis.fields)
      setReqs(merged)
      setPhase("designing")
      askNext(merged, "design")
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudieron analizar los diseños. Podés continuar igual.")
      setPhase("ready")
      post("assistant", "No pude analizar los diseños todavía, pero podés continuar igual y agregarlos después.")
    } finally {
      setSending(false)
      setProgress(null)
    }
  }

  function submitName(value) {
    post("user", value)
    setGarmentLabel(value)
    setPhase("analyzing")
  }

  function submitAnswer(value) {
    post("user", value)
    const nextReqs = applyAnswer(reqs, currentField.key, value)
    setReqs(nextReqs)
    askNext(nextReqs, currentField.category)
  }

  function send(valueOverride) {
    const value = (valueOverride !== undefined ? valueOverride : input).trim()
    if (!value || sending) return
    setInput("")
    if (phase === "naming") return submitName(value)
    if (phase === "asking" || phase === "designing") return submitAnswer(value)
  }

  function buildDraft() {
    return {
      id: garmentLabel,
      label: garmentLabel,
      parts: reqsToParts(reqs),
      positions: ["Toda la prenda"],
      designs: reqsToDesigns(reqs),
      notes: "",
    }
  }

  const inputActive = phase === "naming" || phase === "asking" || phase === "designing"
  const knownParts = reqs ? reqsToParts(reqs) : []
  const designsSoFar = reqs ? reqsToDesigns(reqs) : []
  const pendingCategory = phase === "designAnalyzing" || phase === "designing" ? "design" : "general"
  const pendingCount = reqs ? pendingFields(reqs, pendingCategory).length : 0

  return (
    <div style={{ display: "flex", gap: space(4), flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", border: hair, background: C.white.hex, height: 440 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: space(3), display: "flex", flexDirection: "column", gap: space(2) }}>
          {history.map((m, i) => (
            <Bubble key={i} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {/* Numbered option chips for the current question - click to answer, or type your own. */}
          {(phase === "asking" || phase === "designing") && currentField && currentField.options && currentField.options.length > 0 && !sending && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: space(1), alignSelf: "flex-start", maxWidth: "90%" }}>
              {currentField.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => send(opt)}
                  style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(2)}px`, background: C.white.hex, border: hair, cursor: "pointer", fontFamily: type.fonts.ui, fontSize: type.size.xs, color: C.ink.hex }}
                >
                  <span style={{ width: 15, height: 15, flexShrink: 0, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  {opt}
                </button>
              ))}
            </div>
          )}
          {sending && (
            <div style={{ display: "flex", flexDirection: "column", gap: space(1), alignSelf: "flex-start", maxWidth: "90%", width: 260 }}>
              <div style={{ height: 6, background: C.canvas.hex, border: hair }}>
                <div style={{ height: "100%", width: (progress ? progress.percent : 0) + "%", background: role.priority.fill, transition: "width 160ms linear" }} />
              </div>
              <span style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.6, fontFamily: type.fonts.data }}>
                {progress && progress.lastLabel ? "Analizando: " + progress.lastLabel + "…" : "Analizando la prenda…"}
              </span>
            </div>
          )}
        </div>
        {error && (
          <div style={{ padding: `${space(2)}px ${space(3)}px`, borderTop: hair, display: "flex", alignItems: "center", gap: space(2), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>
            <Icon name="error" size={16} color={role.index.fill} /> {error}
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
              placeholder={phase === "asking" ? "Elegí una opción o escribí la tuya..." : "Escribí tu respuesta..."}
              disabled={sending}
              style={{ flex: 1, padding: space(3), border: "none", outline: "none", fontFamily: type.fonts.ui, fontSize: type.size.base, background: sending ? "#F7F7F8" : C.white.hex }}
            />
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
