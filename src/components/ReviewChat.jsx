// ─────────────────────────────────────────────────────────────────────────────
// REVIEW CHAT — the pre-download review round used by Layout Engine v3.
//
// Two rounds, walked back to back as ONE continuous field queue:
//
// 1. Data-fidelity diff (src/core/reviewDiff.js): does the generated document
//    carry what the intake already said? Only problems become questions -
//    confirmed data shows as a one-line summary, never re-interrogated.
// 2. Production review (src/core/productionReview.js), the 4th round: once
//    round 1 is answered, this reasons like a senior technical designer over
//    EVERYTHING already decided (material, technique, position, colors) for
//    the production-critical detail only knowable at that point - "how many
//    buttons, what spacing, does the placket flip side by gender." Runs even
//    when round 1 had zero problems - it is not conditioned on the diff.
//
// Both rounds render through the same numbered-options walker; round 2's
// fields simply get appended to `fields` once round 1's `done` fires, which
// naturally re-opens the walk (idx no longer >= fields.length). A single
// bounded DeepSeek call backs each round (hybrid NVIDIA+Qwen); if it fails or
// times out the deterministic wording/checklist ships as-is - the review
// works with zero AI availability and never holds the download hostage
// (always skippable via "Descargar igual"; auto-skips itself if BOTH rounds
// end up with nothing to ask).
//
// Deliberately a NEW component (GarmentChat.jsx has concurrent in-flight
// work); it reuses the visual language, not the code.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"
import { deepseekChat } from "../core/deepseekClient.js"
import { HYBRID_TASKS } from "../core/hybridTasks.js"
import { findingsToWalkFields, summarizeConfirmed } from "../core/reviewDiff.js"
import { authorProductionQuestions } from "../core/productionReview.js"

const C = palette
const hair = `1px solid ${C.ink.hex}`

// One bounded call to make the deterministic questions read like a colleague
// asking, not a validator dumping codes. Only label/why get rephrased -
// options stay deterministic so answers keep their meaning.
async function rephraseFields(fields) {
  const compact = fields.map((f) => ({ key: f.key, label: f.label, why: f.why }))
  const prompt =
    "Sos un asistente de fichas tecnicas textiles haciendo una revision final antes de exportar. Reformula cada pregunta para que suene conversacional y clara en espanol rioplatense, sin cambiar su significado. " +
    "Devolve SOLO JSON valido: {\"fields\":[{\"key\":\"...\",\"label\":\"...\",\"why\":\"...\"}]}\n\n" +
    JSON.stringify(compact)
  const raw = await deepseekChat({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1200,
    temperature: 0.3,
    task: HYBRID_TASKS.REVIEW,
    validator: (content) => {
      try {
        const value = JSON.parse(content.replace(/```json|```/g, "").trim())
        return Array.isArray(value.fields) && fields.every((field) => value.fields.some((candidate) => candidate && candidate.key === field.key))
      } catch { return false }
    },
    fallback: JSON.stringify({ fields: compact }),
  })
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
  const byKey = new Map((parsed.fields || []).map((f) => [f.key, f]))
  return fields.map((f) => {
    const r = byKey.get(f.key)
    return r && r.label ? { ...f, label: String(r.label), why: r.why ? String(r.why) : f.why } : f
  })
}

export function ReviewChat({ findings, hdr, parts, designs, onComplete, onSkip }) {
  const [fields, setFields] = useState(() => findingsToWalkFields(findings))
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [typing, setTyping] = useState(false) // free-text mode for "Completar ahora"
  const [text, setText] = useState("")
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState("")
  const [loadingProduction, setLoadingProduction] = useState(false)
  const summary = summarizeConfirmed(findings)
  const rephrased = useRef(false)
  const productionAppended = useRef(false)

  useEffect(() => {
    if (rephrased.current) return
    rephrased.current = true
    let active = true
    rephraseFields(fields)
      .then((polished) => {
        if (active) setFields(polished)
      })
      .catch(() => {})
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = fields[idx]
  const done = idx >= fields.length

  // Round 2 (production review): fires exactly once, right when round 1's
  // walk empties out - including immediately on mount if round 1 had zero
  // problems. Appending to `fields` makes `done` false again on its own, so
  // the SAME walk just continues into the new questions; if nothing comes
  // back, `done` stays true and the auto-skip effect below fires.
  useEffect(() => {
    if (!done || productionAppended.current || applying) return
    productionAppended.current = true
    setLoadingProduction(true)
    authorProductionQuestions({ hdr, parts, designs })
      .then((extra) => {
        if (Array.isArray(extra) && extra.length > 0) setFields((f) => [...f, ...extra])
      })
      .catch(() => {})
      .finally(() => setLoadingProduction(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  // Nothing to review at all (round 1 was clean AND round 2 found no
  // production gaps): never show a dead modal - complete instantly with an
  // empty answer set, same as the user hitting "Descargar igual".
  useEffect(() => {
    if (done && productionAppended.current && !loadingProduction && fields.length === 0) onSkip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, loadingProduction, fields.length])

  function answer(choiceIdx, value) {
    if (applying) return
    // `label` rides along so applyReviewAnswers() can write a readable note
    // for production-round answers ("¿Cuántos botones...?: 3-4") - the
    // review-diff answers ignore it, they derive meaning from key/choice alone.
    setAnswers((a) => [...a, { key: current.key, choice: choiceIdx, option: current.options[choiceIdx], value: value || "", label: current.label }])
    setTyping(false)
    setText("")
    setIdx((i) => i + 1)
  }

  function back() {
    if (applying) return
    if (typing) {
      setTyping(false)
      setText("")
      return
    }
    if (idx === 0) return
    setAnswers((a) => a.slice(0, -1))
    setIdx((i) => i - 1)
  }

  function pick(i) {
    if (applying) return
    // The "type it now" option needs a value before it can be answered.
    if (/escrib/i.test(current.options[i])) {
      setTyping(true)
      return
    }
    answer(i)
  }

  async function complete() {
    if (applying) return
    setApplying(true)
    setApplyError("")
    try {
      await onComplete(answers)
    } catch (error) {
      setApplyError((error && error.message) || "No se pudo aplicar la revisión.")
      setApplying(false)
    }
  }

  const btn = (fill, on) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: space(1),
    padding: `${space(2)}px ${space(4)}px`,
    background: fill,
    color: on,
    border: hair,
    borderColor: fill === C.white.hex ? C.ink.hex : fill,
    fontFamily: type.fonts.ui,
    fontSize: type.size.sm,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: "pointer",
  })

  // Stay mounted (and visible) while round 2 is still being fetched even if
  // round 1 had zero problems - otherwise the modal would flash blank for the
  // whole production-review call. Only render nothing once we're sure both
  // rounds are done and truly empty (the auto-skip effect handles that case).
  if (fields.length === 0 && !loadingProduction) return null

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,21,24,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: space(4) }}>
      <div style={{ background: C.white.hex, width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", border: hair }}>
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderBottom: hair, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
          <div>
            <div style={{ fontSize: type.size.md, fontWeight: 700, fontFamily: type.fonts.display, textTransform: "uppercase", color: C.ink.hex }}>Revisión final</div>
            <div style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.6, marginTop: 2 }}>
              {done ? (loadingProduction ? "Revisando producción…" : "Listo") : `Pregunta ${idx + 1} de ${fields.length}`}
            </div>
          </div>
          <button onClick={onSkip} disabled={applying} style={{ ...btn(C.white.hex, C.ink.hex), opacity: applying ? 0.45 : 1 }} title="Saltar la revisión y generar igual">
            Descargar igual
          </button>
        </div>

        <div style={{ padding: space(4), overflowY: "auto", display: "flex", flexDirection: "column", gap: space(3) }}>
          {/* confirmed summary - what's already faithful, not re-asked */}
          <div style={{ background: C.canvas.hex, border: `1px solid #cfd3da`, padding: `${space(2)}px ${space(3)}px`, fontSize: type.size.xs, color: C.ink.hex }}>
            <Icon name="check" size={14} color={role.priority.fill} /> El documento ya refleja {summary.header} datos de header, {summary.parts} piezas y {summary.designs} diseños del intake.
          </div>

          {/* answered so far */}
          {answers.map((a, i) => (
            <div key={i} style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.55, display: "flex", gap: space(2) }}>
              <Icon name="check" size={13} color={C.ink.hex} />
              <span>
                {fields[i].label} — <b>{a.value || a.option}</b>
              </span>
            </div>
          ))}

          {!done && current && (
            <div>
              <div style={{ background: role.priority.fill, color: role.priority.on, padding: `${space(2)}px ${space(3)}px`, fontSize: type.size.sm, fontWeight: 600, maxWidth: "90%" }}>
                {current.label}
              </div>
              <div style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.6, margin: `${space(1)}px 0 ${space(2)}px` }}>{current.why}</div>

              {!typing && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: space(2) }}>
                  {current.options.map((opt, i) => (
                    <button key={i} onClick={() => pick(i)} style={{ ...btn(C.white.hex, C.ink.hex), textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                      <span style={{ background: role.index.fill, color: C.white.hex, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 11, padding: "1px 6px", marginRight: 6 }}>{i + 1}</span>
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {typing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (text.trim()) answer(0, text.trim())
                  }}
                  style={{ display: "flex", gap: space(2) }}
                >
                  <input
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Escribí el valor..."
                    style={{ flex: 1, padding: space(2), border: hair, fontFamily: type.fonts.data, fontSize: type.size.sm }}
                  />
                  <button type="submit" style={btn(role.priority.fill, role.priority.on)}>
                    <Icon name="send" size={14} color={C.white.hex} /> OK
                  </button>
                </form>
              )}
            </div>
          )}

          {done && loadingProduction && (
            <div style={{ border: hair, padding: space(4), color: C.ink.hex, display: "flex", alignItems: "center", gap: space(2) }}>
              <Icon name="hourglass" size={16} color={role.priority.fill} />
              <div>
                <div style={{ fontSize: type.size.sm, fontWeight: 700 }}>Revisando detalles de producción…</div>
                <div style={{ fontSize: type.size.xs, opacity: 0.6, marginTop: 2 }}>Pensando como diseñador técnico sobre lo ya decidido - cantidades, distancias, variantes.</div>
              </div>
            </div>
          )}

          {done && !loadingProduction && (
            <div style={{ border: hair, padding: space(4), color: C.ink.hex }}>
              <div style={{ fontSize: type.size.sm, fontWeight: 700, marginBottom: space(1) }}>Revisión completada</div>
              <div style={{ fontSize: type.size.xs, opacity: 0.65, marginBottom: space(3) }}>
                Aplicaremos {answers.length} decisiones y regeneraremos únicamente las páginas afectadas.
              </div>
              {applyError && (
                <div style={{ color: role.index.fill, fontSize: type.size.xs, marginBottom: space(2) }}>
                  <Icon name="error" size={14} color={role.index.fill} /> {applyError}
                </div>
              )}
              <button onClick={complete} disabled={applying} style={{ ...btn(role.priority.fill, role.priority.on), opacity: applying ? 0.55 : 1 }}>
                <Icon name={applying ? "hourglass" : "check"} size={14} color={C.white.hex} />
                {applying ? "Aplicando revisión..." : applyError ? "Reintentar" : "Aplicar y descargar"}
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: `${space(2)}px ${space(4)}px`, borderTop: hair, display: "flex", justifyContent: "space-between" }}>
          <button onClick={back} disabled={applying || (idx === 0 && !typing)} style={{ ...btn(C.white.hex, C.ink.hex), opacity: applying || (idx === 0 && !typing) ? 0.4 : 1 }}>
            <Icon name="arrow_back" size={14} /> Volver
          </button>
          <span style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.5, alignSelf: "center" }}>
            La revisión asegura que el documento sea 100% fiel a lo que pediste.
          </span>
        </div>
      </div>
    </div>
  )
}
