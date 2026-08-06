import { useState } from "react"
import { ColorsEditor } from "./ColorsEditor.jsx"
import { newColorway } from "../core/colorways.js"
import { isEmbTec } from "../core/helpers.js"
import { palette, role } from "../design/tokens.js"

// One embroidery design's thread row inside a non-base colorway card.
// Collapsed by default ("mismo hilo que el colorway base") - the whole point
// is that inheriting the base thread is a NORMAL, expected outcome for most
// colorways, not something every colorway must restate. Expanding it writes
// an override; collapsing it back clears one (colorwayWarnings then prints
// the "hilo heredado" note on the document instead of staying silent).
function ThreadOverrideRow({ design, override, onChange }) {
  const [editing, setEditing] = useState(!!(override && override.length > 0))
  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", fontSize: 11, color: "#555" }}>
        <span>
          <b>{design.name || "Diseno"}</b>: mismo hilo que el colorway base
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{ padding: "3px 8px", border: "1px solid " + role.priority.fill, background: palette.white.hex, color: role.priority.fill, fontSize: 10, cursor: "pointer", borderRadius: 5 }}
        >
          Cambiar hilo
        </button>
      </div>
    )
  }
  return (
    <div style={{ padding: "6px 10px", borderTop: "1px dashed #ddd" }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{design.name || "Diseno"}</div>
      <ColorsEditor colors={override || []} onChange={onChange} madeira={true} />
      <button
        type="button"
        onClick={() => {
          onChange(null)
          setEditing(false)
        }}
        style={{ marginTop: 6, padding: "3px 8px", border: "1px solid #999", background: "none", fontSize: 10, cursor: "pointer", borderRadius: 5, color: "#555" }}
      >
        Usar el mismo hilo que el base
      </button>
    </div>
  )
}

// With exactly one colorway this renders the bare ColorsEditor the app
// already had, plus one small "+ Agregar colorway" affordance below it - no
// forced name field, no card chrome - so a document with a single colorway
// looks and behaves like it always did. Naming a second colorway is what
// switches every card into the full named-card layout.
export function ColorwaysEditor({ colorways, onChange, designs }) {
  const multi = colorways.length > 1
  const embDesigns = (Array.isArray(designs) ? designs : []).filter((d) => d && isEmbTec(d.tec))

  function updateColorway(index, patch) {
    onChange(colorways.map((cw, i) => (i === index ? { ...cw, ...patch } : cw)))
  }
  function updateOverride(index, designId, override) {
    const cw = colorways[index]
    const nextOverrides = { ...cw.threadOverrides }
    if (override) nextOverrides[designId] = override
    else delete nextOverrides[designId]
    updateColorway(index, { threadOverrides: nextOverrides })
  }
  function addColorway() {
    onChange([...colorways, newColorway({ name: "" })])
  }
  function removeColorway(index) {
    onChange(colorways.filter((_, i) => i !== index))
  }

  return (
    <div>
      {colorways.map((cw, i) => (
        <div key={cw.id} style={multi ? { marginBottom: 12, border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" } : undefined}>
          {multi && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: i === 0 ? "#f3f3f5" : palette.white.hex, borderBottom: "1px solid #eee" }}>
              <input
                value={cw.name}
                onChange={(e) => updateColorway(i, { name: e.target.value })}
                placeholder={i === 0 ? "Colorway base (ej: Fair Green)" : "Ej: Silver Lake Blue"}
                style={{ flex: 1, padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12 }}
              />
              {i > 0 && (
                <button type="button" onClick={() => removeColorway(i)} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 16 }}>
                  x
                </button>
              )}
            </div>
          )}
          <div style={{ padding: multi ? 10 : 0 }}>
            <ColorsEditor colors={cw.fabricColors} onChange={(colors) => updateColorway(i, { fabricColors: colors })} />
          </div>
          {multi && i > 0 && embDesigns.length > 0 && (
            <div style={{ borderTop: "1px solid #eee" }}>
              <div style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#777", textTransform: "uppercase" }}>Hilo de bordado por diseno</div>
              {embDesigns.map((d) => (
                <ThreadOverrideRow key={d.id} design={d} override={cw.threadOverrides[d.id]} onChange={(override) => updateOverride(i, d.id, override)} />
              ))}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addColorway}
        style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.priority.fill, borderRadius: 7, color: role.priority.fill, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
      >
        + Agregar colorway
      </button>
    </div>
  )
}
