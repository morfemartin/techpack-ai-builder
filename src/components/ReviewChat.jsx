// ─────────────────────────────────────────────────────────────────────────────
// REVIEW CHAT — the pre-download review round (Phase 4 of Layout Engine v2).
//
// Opens when the user hits "Generar SVG" and the deterministic intent-vs-
// document diff (src/core/reviewDiff.js) found problems: intake data that is
// empty, or data the generated document doesn't carry. Walks ONLY those
// findings as a short chat with numbered options (same interaction grammar
// as the intake walker), never re-interrogating what's already confirmed -
// that shows as a one-line summary instead.
//
// A single bounded DeepSeek call may rephrase the questions conversationally;
// if it fails or times out the deterministic wording ships as-is - the review
// works with zero AI availability. Always skippable ("Descargar igual"):
// the review protects the user, it never holds the download hostage.
//
// Deliberately a NEW component (GarmentChat.jsx has concurrent in-flight
// work); it reuses the visual language, not the code.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"
import { deepseekChat } from "../core/deepseekClient.js"
import { findingsToWalkFields, summarizeConfirmed } from "../core/reviewDiff.js"

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
  const raw = await deepseekChat({ messages: [{ role: "user", content: prompt }], maxTokens: 1200, temperature: 0.3 })
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
  const byKey = new Map((parsed.fields || []).map((f) => [f.key, f]))
  return fields.map((f) => {
    const r = byKey.get(f.key)
    return r && r.label ? { ...f, label: String(r.label), why: r.why ? String(r.why) : f.why } : f
  })
}

export function ReviewChat({ findings, onComplete, onSkip }) {
  const [fields, setFields] = useState(() => findingsToWalkFields(findings))
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [typing, setTyping] = useState(false) // free-text mode for "Completar ahora"
  const [text, setText] = useState("")
  const summary = summarizeConfirmed(findings)
  const rephrased = useRef(false)

  useEffect(() => {
    if (rephrased.current) return
    rephrased.current = true
    let active = true
    // Best-effort conversational polish; 8s cap so the review never stalls.
    Promise.race([rephraseFields(fields), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])
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

  useEffect(() => {
    if (done && fields.length > 0) onComplete(answers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  function answer(choiceIdx, value) {
    setAnswers((a) => [...a, { key: current.key, choice: choiceIdx, option: current.options[choiceIdx], value: value || "" }])
    setTyping(false)
    setText("")
    setIdx((i) => i + 1)
  }

  function back() {
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
    // The "type it now" option needs a value before it can be answered.
    if (/escrib/i.test(current.options[i])) {
      setTyping(true)
      return
    }
    answer(i)
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

  if (fields.length === 0) return null

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,21,24,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: space(4) }}>
      <div style={{ background: C.white.hex, width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", border: hair }}>
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderBottom: hair, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
          <div>
            <div style={{ fontSize: type.size.md, fontWeight: 700, fontFamily: type.fonts.display, textTransform: "uppercase", color: C.ink.hex }}>Revisión final</div>
            <div style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.6, marginTop: 2 }}>
              {done ? "Listo" : `Pregunta ${idx + 1} de ${fields.length}`}
            </div>
          </div>
          <button onClick={onSkip} style={{ ...btn(C.white.hex, C.ink.hex) }} title="Saltar la revisión y generar igual">
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
        </div>

        <div style={{ padding: `${space(2)}px ${space(4)}px`, borderTop: hair, display: "flex", justifyContent: "space-between" }}>
          <button onClick={back} disabled={idx === 0 && !typing} style={{ ...btn(C.white.hex, C.ink.hex), opacity: idx === 0 && !typing ? 0.4 : 1 }}>
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
