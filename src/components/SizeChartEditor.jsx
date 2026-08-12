import { useState } from "react"
import { newPom, newConstant, gradeFromBase } from "../core/sizeChart.js"
import { proposePoms, proposeGrading, proposeBaseValues } from "../core/sizeChartAI.js"
import { parseMeasure, formatMeasure } from "../core/units.js"
import { palette, role } from "../design/tokens.js"

const cellInputStyle = { width: 46, padding: "4px 2px", border: "1px solid #d0d0d0", borderRadius: 4, fontSize: 11, textAlign: "center", outline: "none" }
const labelInputStyle = { flex: "0 0 160px", padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12, outline: "none" }

// One POM (point of measure) row: label, how-to-measure, one number cell per
// size, tolerance. The base-size column is visually locked (tinted, bold
// border) because it is the one cell grading actually reads FROM - typing it
// wrong silently throws off every derived size, so it needs to read as "the
// important one", not just another cell in the row.
function PomRow({ pom, sizes, baseSize, onChange, onRemove }) {
  function updValue(size, raw) {
    // Typing IS measuring - hand-editing the base cell of a "suggested" row
    // (an AI guess at a typical value, never a real measurement) turns it
    // into a real, trusted "user" cell. This deliberately does NOT apply to
    // "derived" rows: there the number came from arithmetic on a rule, not
    // from you looking at the garment, so editing one cell shouldn't quietly
    // relabel the whole row as measured.
    const nextSource = pom.source === "suggested" && size === baseSize ? "user" : pom.source
    onChange({ ...pom, values: { ...pom.values, [size]: raw }, source: nextSource })
  }
  // A row the app itself derived (gradeFromBase) or the AI suggested a base
  // value for stays flagged "pending" on the document until a human
  // re-confirms it - checking this box is that confirmation. A hand-typed
  // ("user") row was never unconfirmed to begin with, so the checkbox only
  // appears where it means something.
  const showVerify = pom.source !== "user"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", borderBottom: "1px solid #eee" }}>
      <input value={pom.label} onChange={(e) => onChange({ ...pom, label: e.target.value })} placeholder="Ej: Medio pecho" style={labelInputStyle} />
      {sizes.map((size) => (
        <input
          key={size}
          value={pom.values[size] != null ? pom.values[size] : ""}
          onChange={(e) => updValue(size, e.target.value)}
          placeholder={size}
          title={size === baseSize ? "Talla base - las demas se grillan desde aca" : size}
          style={{
            ...cellInputStyle,
            background: size === baseSize ? role.highlight.fill + "33" : palette.white.hex,
            borderColor: size === baseSize ? role.priority.fill : "#d0d0d0",
            borderWidth: size === baseSize ? 2 : 1,
            fontWeight: size === baseSize ? 700 : 400,
          }}
        />
      ))}
      <input
        value={pom.tolerance != null ? pom.tolerance : ""}
        onChange={(e) => onChange({ ...pom, tolerance: e.target.value === "" ? null : e.target.value })}
        placeholder="Tol."
        title="Tolerancia (+-)"
        style={{ ...cellInputStyle, width: 44 }}
      />
      {showVerify && (
        <label
          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: pom.verified ? "#2a7a2a" : role.index.fill, flexShrink: 0, width: 62 }}
          title={pom.source === "suggested" ? "Confirmar que este valor propuesto por IA es correcto - nadie lo midio todavia" : "Confirmar que este grillado (calculado, no tipeado) es correcto"}
        >
          <input type="checkbox" checked={!!pom.verified} onChange={(e) => onChange({ ...pom, verified: e.target.checked })} style={{ accentColor: role.priority.fill }} />
          {pom.verified ? "Verificado" : "Pendiente"}
        </label>
      )}
      <button type="button" onClick={onRemove} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>
        x
      </button>
    </div>
  )
}

function ConstantRow({ constant, onChange, onRemove }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px" }}>
      <input value={constant.label} onChange={(e) => onChange({ ...constant, label: e.target.value })} placeholder="Ej: Altura del cuello" style={labelInputStyle} />
      <input value={constant.value != null ? constant.value : ""} onChange={(e) => onChange({ ...constant, value: e.target.value })} placeholder="Valor" style={{ ...cellInputStyle, width: 70 }} />
      <span style={{ fontSize: 10, color: "#888" }}>{constant.unit}</span>
      <button type="button" onClick={onRemove} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 15 }}>
        x
      </button>
    </div>
  )
}

// A construction measurement that DOES vary by size (a POM row) belongs
// here, on Piezas - it is BOM data, same status as any other part
// specification, not design content (see the plan doc: this editor is
// deliberately NOT on the Diseños step).
export function SizeChartEditor({ chart, onChange, garmentType, generalFields }) {
  // AI proposes; the arithmetic decides. proposePoms only ever returns
  // labels/howToMeasure (empty cells), so "Aceptar" here is exactly as safe
  // as typing the label by hand. proposeGrading only ever returns a rule
  // (an increment), never filled cells - the diff preview below runs the
  // SAME gradeFromBase a human's own typed increment would use, so nothing
  // about the preview or the accepted result was computed by the model.
  const [pomSuggestions, setPomSuggestions] = useState([])
  const [pomLoading, setPomLoading] = useState(false)
  const [pomError, setPomError] = useState(null)
  const [gradeSuggestions, setGradeSuggestions] = useState([])
  const [gradeLoading, setGradeLoading] = useState(false)
  const [gradeError, setGradeError] = useState(null)
  const [baseSuggestions, setBaseSuggestions] = useState([])
  const [baseLoading, setBaseLoading] = useState(false)
  const [baseError, setBaseError] = useState(null)

  function patch(next) {
    onChange({ ...chart, ...next })
  }
  function updatePom(index, next) {
    const poms = chart.poms.slice()
    poms[index] = next
    patch({ poms })
  }
  function removePom(index) {
    patch({ poms: chart.poms.filter((_, i) => i !== index) })
  }

  async function suggestPoms() {
    setPomLoading(true)
    setPomError(null)
    try {
      const proposed = await proposePoms({ garmentType: garmentType || "prenda", generalFields: generalFields || [] })
      setPomSuggestions(proposed)
    } catch (e) {
      setPomError((e && e.message) || "No se pudo sugerir puntos de medida.")
    } finally {
      setPomLoading(false)
    }
  }
  function acceptPomSuggestion(index) {
    patch({ poms: [...chart.poms, pomSuggestions[index]] })
    setPomSuggestions((s) => s.filter((_, i) => i !== index))
  }
  function discardPomSuggestion(index) {
    setPomSuggestions((s) => s.filter((_, i) => i !== index))
  }

  async function suggestGrading() {
    setGradeLoading(true)
    setGradeError(null)
    try {
      const rules = await proposeGrading({ chart, garmentType: garmentType || "prenda" })
      if (rules.length === 0) setGradeError("No hay puntos de medida con talla base cargada todavia, o el modelo no propuso nada confiable.")
      setGradeSuggestions(rules.map((rule) => ({ rule, increment: rule.increment })))
    } catch (e) {
      setGradeError((e && e.message) || "No se pudo sugerir el grillado.")
    } finally {
      setGradeLoading(false)
    }
  }
  function previewForSuggestion(sug) {
    const pom = chart.poms.find((p) => p.id === sug.rule.pomId)
    if (!pom) return null
    return gradeFromBase(pom, { sizes: chart.sizes, baseSize: chart.baseSize, increment: sug.increment, unit: sug.rule.unit })
  }
  function acceptGradeSuggestion(index) {
    const graded = previewForSuggestion(gradeSuggestions[index])
    if (!graded) return
    patch({ poms: chart.poms.map((p) => (p.id === graded.id ? graded : p)) })
    setGradeSuggestions((s) => s.filter((_, i) => i !== index))
  }
  function discardGradeSuggestion(index) {
    setGradeSuggestions((s) => s.filter((_, i) => i !== index))
  }
  function editGradeSuggestion(index, value) {
    setGradeSuggestions((s) => s.map((sug, i) => (i === index ? { ...sug, increment: value } : sug)))
  }

  const canGrade = chart.poms.some((pom) => parseMeasure(pom.values[chart.baseSize]) !== null)
  const canProposeBase = chart.poms.some((pom) => parseMeasure(pom.values[chart.baseSize]) === null)

  async function suggestBaseValues() {
    setBaseLoading(true)
    setBaseError(null)
    try {
      const rules = await proposeBaseValues({ chart, garmentType: garmentType || "prenda", generalFields: generalFields || [] })
      if (rules.length === 0) setBaseError("El modelo no propuso ningun valor confiable para las medidas sin talla base.")
      setBaseSuggestions(rules.map((rule) => ({ rule, value: rule.value })))
    } catch (e) {
      setBaseError((e && e.message) || "No se pudo sugerir valores de talla base.")
    } finally {
      setBaseLoading(false)
    }
  }
  function acceptBaseSuggestion(index) {
    const sug = baseSuggestions[index]
    // Writes the base cell and marks the row "suggested" - same provenance
    // PomRow already knows to flag ⏳ until a human verifies it (or edits
    // the cell by hand, which counts as verifying it themselves).
    patch({
      poms: chart.poms.map((pom) =>
        pom.id === sug.rule.pomId ? { ...pom, values: { ...pom.values, [chart.baseSize]: sug.value }, source: "suggested", verified: false } : pom
      ),
    })
    setBaseSuggestions((s) => s.filter((_, i) => i !== index))
  }
  function discardBaseSuggestion(index) {
    setBaseSuggestions((s) => s.filter((_, i) => i !== index))
  }
  function editBaseSuggestion(index, value) {
    setBaseSuggestions((s) => s.map((sug, i) => (i === index ? { ...sug, value } : sug)))
  }

  // Every row not yet verified - whether the app derived it or the AI
  // suggested it - so the bulk action below can confirm all of them in one
  // explicit, named act instead of forcing N individual clicks.
  const unverifiedPoms = chart.poms.filter((pom) => pom.source !== "user" && !pom.verified)
  function verifyAllPoms() {
    patch({ poms: chart.poms.map((pom) => (pom.source !== "user" && !pom.verified ? { ...pom, verified: true } : pom)) })
  }

  function updateConstant(index, next) {
    const constants = chart.constants.slice()
    constants[index] = next
    patch({ constants })
  }
  function removeConstant(index) {
    patch({ constants: chart.constants.filter((_, i) => i !== index) })
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11 }}>
        <span style={{ fontWeight: 700, color: "#555" }}>Talla base:</span>
        <select
          value={chart.baseSize}
          onChange={(e) => patch({ baseSize: e.target.value })}
          style={{ padding: "3px 6px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 11 }}
        >
          {chart.sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span style={{ color: "#888" }}>las demas tallas se grillan a partir de esta</span>
      </div>

      {unverifiedPoms.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "5px 8px", background: role.highlight.fill + "18", border: "1px solid " + role.highlight.fill, borderRadius: 5, fontSize: 11, color: "#555", cursor: "pointer" }}>
          <input type="checkbox" checked={false} onChange={verifyAllPoms} style={{ accentColor: role.priority.fill }} />
          Confirmo que verifiqué estas {unverifiedPoms.length} fila{unverifiedPoms.length === 1 ? "" : "s"} contra una prenda física
        </label>
      )}

      {chart.poms.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "0 4px 4px", fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>
          <span style={{ flex: "0 0 160px" }}>Punto de medida</span>
          {chart.sizes.map((size) => (
            <span key={size} style={{ width: 46, textAlign: "center" }}>
              {size}
            </span>
          ))}
          <span style={{ width: 44, textAlign: "center" }}>Tol.</span>
        </div>
      )}
      {chart.poms.map((pom, i) => (
        <PomRow key={pom.id} pom={pom} sizes={chart.sizes} baseSize={chart.baseSize} onChange={(next) => updatePom(i, next)} onRemove={() => removePom(i)} />
      ))}

      {pomSuggestions.map((pom, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", background: role.highlight.fill + "22", border: "1px dashed " + role.highlight.fill, borderRadius: 5, marginTop: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: role.highlight.fill, flexShrink: 0 }}>IA</span>
          <span style={{ flex: 1, fontSize: 12 }}>
            <strong>{pom.label}</strong>
            {pom.howToMeasure && <span style={{ color: "#777" }}> — {pom.howToMeasure}</span>}
          </span>
          <button type="button" onClick={() => acceptPomSuggestion(i)} style={{ padding: "3px 10px", background: role.priority.fill, color: palette.white.hex, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Aceptar
          </button>
          <button type="button" onClick={() => discardPomSuggestion(i)} style={{ padding: "3px 10px", background: "none", border: "1px solid #ccc", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
            Descartar
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={() => patch({ poms: [...chart.poms, newPom({ unit: "cm" })] })}
          style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.priority.fill, borderRadius: 7, color: role.priority.fill, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
        >
          + Punto de medida
        </button>
        <button
          type="button"
          onClick={suggestPoms}
          disabled={pomLoading}
          style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.highlight.fill, borderRadius: 7, color: role.highlight.fill, fontSize: 12, cursor: pomLoading ? "wait" : "pointer", fontWeight: 600, opacity: pomLoading ? 0.6 : 1 }}
        >
          {pomLoading ? "Pensando..." : "Sugerir puntos de medida (IA)"}
        </button>
      </div>
      {pomError && <div style={{ marginTop: 4, fontSize: 11, color: role.index.fill }}>{pomError}</div>}

      {chart.poms.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={suggestBaseValues}
            disabled={baseLoading || !canProposeBase}
            title={canProposeBase ? "" : "Todos los puntos de medida ya tienen un valor en la talla base"}
            style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.highlight.fill, borderRadius: 7, color: canProposeBase ? role.highlight.fill : "#aaa", fontSize: 12, cursor: baseLoading || !canProposeBase ? "not-allowed" : "pointer", fontWeight: 600, opacity: baseLoading ? 0.6 : 1 }}
          >
            {baseLoading ? "Pensando..." : "Sugerir valores base (IA)"}
          </button>
          {baseError && <div style={{ marginTop: 4, fontSize: 11, color: role.index.fill }}>{baseError}</div>}
          {baseSuggestions.map((sug, i) => {
            const pom = chart.poms.find((p) => p.id === sug.rule.pomId)
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", background: role.highlight.fill + "22", border: "1px dashed " + role.highlight.fill, borderRadius: 5, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: role.highlight.fill, flexShrink: 0 }}>IA</span>
                <strong style={{ fontSize: 12 }}>{pom ? pom.label : sug.rule.pomId}</strong>
                <span style={{ fontSize: 11, color: "#555" }}>talla {chart.baseSize} =</span>
                <input
                  value={sug.value}
                  onChange={(e) => editBaseSuggestion(i, e.target.value)}
                  style={{ width: 50, padding: "2px 4px", border: "1px solid #d0d0d0", borderRadius: 4, fontSize: 11, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "#555", flex: 1 }}>{sug.rule.unit}</span>
                <button type="button" onClick={() => acceptBaseSuggestion(i)} style={{ padding: "3px 10px", background: role.priority.fill, color: palette.white.hex, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Aceptar
                </button>
                <button type="button" onClick={() => discardBaseSuggestion(i)} style={{ padding: "3px 10px", background: "none", border: "1px solid #ccc", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                  Descartar
                </button>
              </div>
            )
          })}
        </div>
      )}

      {chart.poms.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={suggestGrading}
            disabled={gradeLoading || !canGrade}
            title={canGrade ? "" : "Cargá al menos un valor en la talla base antes de pedir grillado"}
            style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.highlight.fill, borderRadius: 7, color: canGrade ? role.highlight.fill : "#aaa", fontSize: 12, cursor: gradeLoading || !canGrade ? "not-allowed" : "pointer", fontWeight: 600, opacity: gradeLoading ? 0.6 : 1 }}
          >
            {gradeLoading ? "Pensando..." : "Sugerir grillado (IA)"}
          </button>
          {gradeError && <div style={{ marginTop: 4, fontSize: 11, color: role.index.fill }}>{gradeError}</div>}
          {gradeSuggestions.map((sug, i) => {
            const graded = previewForSuggestion(sug)
            const pom = chart.poms.find((p) => p.id === sug.rule.pomId)
            const preview = graded
              ? chart.sizes.filter((size) => size !== chart.baseSize).map((size) => size + " " + formatMeasure(graded.values[size], graded.unit)).join(" · ")
              : ""
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", background: role.highlight.fill + "22", border: "1px dashed " + role.highlight.fill, borderRadius: 5, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: role.highlight.fill, flexShrink: 0 }}>IA</span>
                <strong style={{ fontSize: 12 }}>{pom ? pom.label : sug.rule.pomId}</strong>
                <span style={{ fontSize: 11, color: "#555" }}>+</span>
                <input
                  value={sug.increment}
                  onChange={(e) => editGradeSuggestion(i, e.target.value)}
                  style={{ width: 44, padding: "2px 4px", border: "1px solid #d0d0d0", borderRadius: 4, fontSize: 11, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "#555" }}>{sug.rule.unit} por talla →</span>
                <span style={{ fontSize: 11, color: "#555", flex: 1 }}>{preview}</span>
                <button type="button" onClick={() => acceptGradeSuggestion(i)} style={{ padding: "3px 10px", background: role.priority.fill, color: palette.white.hex, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Aceptar
                </button>
                <button type="button" onClick={() => discardGradeSuggestion(i)} style={{ padding: "3px 10px", background: "none", border: "1px solid #ccc", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                  Descartar
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #eee" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#777", textTransform: "uppercase", marginBottom: 4 }}>Medidas constantes (no varian por talla)</div>
        {chart.constants.map((c, i) => (
          <ConstantRow key={c.id} constant={c} onChange={(next) => updateConstant(i, next)} onRemove={() => removeConstant(i)} />
        ))}
        <button
          type="button"
          onClick={() => patch({ constants: [...chart.constants, newConstant({ unit: "cm" })] })}
          style={{ marginTop: 4, padding: "4px 10px", background: "none", border: "1px dashed #999", borderRadius: 5, color: "#555", fontSize: 11, cursor: "pointer" }}
        >
          + Medida constante
        </button>
      </div>
    </div>
  )
}
