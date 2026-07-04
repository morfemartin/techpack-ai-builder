import { useState, useRef, useEffect } from "react"
import { deepseekChat, DeepSeekError } from "../core/deepseekClient.js"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"

const C = palette
const hair = `1px solid ${C.ink.hex}`

const OPENING = "¿Qué prenda querés armar? (por ejemplo: Polo, Hoodie, Camisa, Jogger)"

// tecs: the garment's valid technique labels (same list csvImport.js already
// gets as tl.tecs) - without this, a chat-drafted embroidery design's `tec`
// can drift from the exact strings isEmbTec() matches against, and its
// embroidery block would silently never render downstream.
function buildSystemPrompt(tecs) {
  var tecList = (tecs || []).join(", ")
  return (
    "Sos un asistente que arma la ficha tecnica de una prenda nueva charlando con el usuario, en espanol, una pregunta a la vez.\n\n" +
    "Tu objetivo es juntar: 1) que prenda es, 2) sus piezas de construccion con valores concretos, 3) que elementos tienen diseno/arte propio.\n\n" +
    "Para cada pieza de construccion relevante (cuello, puno, bajo, cintura, capucha, cierre, etc.) pregunta explicitamente sus variantes " +
    'binarias o categoricas conocidas en indumentaria antes de darla por completa - no asumas un valor por default. Ejemplos de estilo: ' +
    '"tu polo lleva botones, cuantos? son personalizados?", "el cuello, lleva puno o no?", "el bajo, es recto o cola de pato (bajo curvo)?", ' +
    '"la capucha lleva cordon o no?". No sigas un guion fijo por tipo de prenda - usa tu conocimiento de construccion de indumentaria para ' +
    "preguntar lo relevante a la prenda que te digan, con el mismo estilo que esos ejemplos.\n\n" +
    "Regla clave para decidir donde va cada cosa: si lo que describen (a) tiene arte o referencia visual propia, (b) tiene un enlace de Drive, " +
    "(c) es un bordado o parche con especificacion propia, o (d) es un componente personalizado con entidad propia (ej. 'botones personalizados', " +
    "'parche bordado', 'logo estampado') - va como una entrada NUEVA en 'designs', NO como una fila de 'parts'. Un atributo simple y plano de una " +
    "pieza (ej. composicion de tela, tipo de cierre, si el cuello lleva puno o no) va en 'parts' como hasta ahora. Cada entrada de 'designs' " +
    "necesita su propia pagina en la ficha final - por eso la distincion importa.\n\n" +
    "Si el usuario menciona un enlace de Drive para un diseno, ponelo en 'driveLink' tal cual lo escribio, sin validarlo ni modificarlo. " +
    "El campo 'tec' de cada diseno DEBE ser exactamente uno de estos valores (elegi el mas parecido, nunca inventes texto libre): " + tecList + ".\n\n" +
    "Cada respuesta tuya DEBE ser un objeto JSON, sin markdown, con esta forma exacta:\n" +
    '{"reply": "tu mensaje conversacional en espanol, una sola pregunta o comentario breve", ' +
    '"draft": {"id": "slug-en-ingles-de-la-prenda", "label": "Nombre de la prenda en espanol", ' +
    '"parts": [{"label": "...", "val": "..."}], "positions": ["Toda la prenda", "..."], ' +
    '"designs": [{"name": "...", "pos": "...", "posDetail": "...", "tec": "...", "driveLink": "...", "notes": "..."}], ' +
    '"notes": "cualquier cosa relevante que no se pudo estructurar arriba, string vacio si no aplica"}, ' +
    '"done": false}\n\n' +
    '"draft" es SIEMPRE el estado acumulado completo hasta ahora, no solo lo nuevo de este turno - repeti las piezas y disenos ' +
    "ya conocidos ademas de lo nuevo. \"done\" pasa a true recien cuando ya preguntaste las piezas principales y los disenos/bordados, y el " +
    "usuario no tiene mas que agregar - en ese ultimo turno, \"reply\" es un mensaje de cierre, no una pregunta."
  )
}

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

export function GarmentChat({ onComplete, tecs }) {
  const [history, setHistory] = useState([{ role: "assistant", content: OPENING }])
  const [draft, setDraft] = useState(null)
  const [done, setDone] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, sending])

  async function send() {
    if (!input.trim() || sending) return
    const userMsg = { role: "user", content: input.trim() }
    const nextHistory = [...history, userMsg]
    setHistory(nextHistory)
    setInput("")
    setSending(true)
    setError(null)
    try {
      const apiMessages = [{ role: "system", content: buildSystemPrompt(tecs) }, ...nextHistory]
      // Generous budget: even with thinking:false, this model sometimes still
      // spends tokens on a reasoning_content aside before the actual JSON
      // reply - too tight a cap here truncates mid-JSON (observed in manual
      // testing: JSON.parse failures on longer drafts with a lower cap).
      const raw = await deepseekChat({ messages: apiMessages, maxTokens: 1400, temperature: 0.4 })

      // The model occasionally ignores the JSON-envelope instruction and
      // replies in plain conversational text instead (observed in manual
      // testing - not a truncation issue, just an instruction-following
      // miss). That's still a real, useful answer, so show it as-is instead
      // of erroring out; just skip the draft/done update for that turn. The
      // system prompt is resent in full every turn, so the model reliably
      // self-corrects back to JSON on the next message.
      let parsed = null
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
      } catch {
        parsed = null
      }

      if (parsed && typeof parsed.reply === "string") {
        setHistory((h) => [...h, { role: "assistant", content: parsed.reply }])
        if (parsed.draft) setDraft(parsed.draft)
        if (parsed.done) setDone(true)
      } else {
        setHistory((h) => [...h, { role: "assistant", content: raw }])
      }
    } catch (e) {
      setError(e instanceof DeepSeekError ? e.message : "No se pudo interpretar la respuesta de la IA. Probá de nuevo.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: "flex", gap: space(4), flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", border: hair, background: C.white.hex, height: 440 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: space(3), display: "flex", flexDirection: "column", gap: space(2) }}>
          {history.map((m, i) => (
            <Bubble key={i} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {sending && (
            <span style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.6, fontFamily: type.fonts.data }}>Pensando...</span>
          )}
        </div>
        {error && (
          <div style={{ padding: `${space(2)}px ${space(3)}px`, borderTop: hair, display: "flex", alignItems: "center", gap: space(2), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>
            <Icon name="error" size={16} color={role.index.fill} /> {error}
          </div>
        )}
        {!done ? (
          <div style={{ display: "flex", borderTop: hair }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send()
              }}
              placeholder="Escribí tu respuesta..."
              disabled={sending}
              style={{ flex: 1, padding: space(3), border: "none", outline: "none", fontFamily: type.fonts.ui, fontSize: type.size.base, background: sending ? "#F7F7F8" : C.white.hex }}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space(1),
                padding: `0 ${space(4)}px`,
                background: sending || !input.trim() ? "#C6CAD2" : role.priority.fill,
                color: C.white.hex,
                border: "none",
                borderLeft: hair,
                cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                fontFamily: type.fonts.ui,
                fontWeight: 700,
              }}
            >
              <Icon name="send" size={18} color={C.white.hex} />
            </button>
          </div>
        ) : (
          <div style={{ padding: space(3), borderTop: hair, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => onComplete(draft)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space(2),
                padding: `${space(2)}px ${space(4)}px`,
                background: role.priority.fill,
                color: role.priority.on,
                border: "none",
                fontFamily: type.fonts.ui,
                fontWeight: 700,
                fontSize: type.size.sm,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                cursor: "pointer",
              }}
            >
              Continuar con esta prenda <Icon name="arrow_forward" size={18} color={C.white.hex} />
            </button>
          </div>
        )}
      </div>

      {/* Live draft panel - so the chat is never a black box. */}
      <div style={{ width: 240, flexShrink: 0, border: hair, background: C.white.hex, padding: space(3) }}>
        <div style={{ fontSize: type.size.xs, fontWeight: 700, fontFamily: type.fonts.ui, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: space(2) }}>Borrador</div>
        {!draft && <p style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.6 }}>Todavía no hay datos.</p>}
        {draft && (
          <div>
            <div style={{ fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, marginBottom: space(2) }}>{draft.label || "..."}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: space(1) }}>
              {(draft.parts || []).map((p, i) => (
                <div key={i} style={{ display: "flex", gap: space(1), alignItems: "flex-start", fontSize: type.size.xs }}>
                  <span style={{ width: 16, height: 16, flexShrink: 0, background: role.index.fill, color: role.index.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
                  <span style={{ color: C.ink.hex }}>
                    <b>{p.label}:</b> {p.val}
                  </span>
                </div>
              ))}
            </div>
            {Array.isArray(draft.designs) && draft.designs.length > 0 && (
              <div style={{ marginTop: space(2), paddingTop: space(2), borderTop: "1px solid #E6E8EC" }}>
                <div style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: space(1) }}>Disenos (paginas propias)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: space(1) }}>
                  {draft.designs.map((d, i) => (
                    <div key={i} style={{ display: "flex", gap: space(1), alignItems: "flex-start", fontSize: type.size.xs }}>
                      <span style={{ width: 16, height: 16, flexShrink: 0, background: role.priority.fill, color: role.priority.on, fontFamily: type.fonts.data, fontWeight: 700, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
                      <span style={{ color: C.ink.hex }}>
                        <b>{d.name || "Diseno"}</b> — {d.pos || "?"} — {d.tec || "?"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
