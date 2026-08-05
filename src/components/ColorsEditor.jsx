import { h2c } from "../core/colorUtils.js"
import { MADEIRA_CLASSIC_RAYON } from "../core/madeiraThreads.js"
import { palette, role } from "../design/tokens.js"

// This is the ONLY color picker most designs ever use - the Wilcom-worksheet
// stopSeq rows in EmbForm.jsx are a different, narrower field (thread
// code/name for a digitized run) that most embroidery designs never touch
// until a PDF gets uploaded. A user picking a thread color for a design's
// main palette needs the Madeira catalog HERE, not buried in a sub-form -
// see madeiraThreads.js for why the official chart, not a guess, is used.
export function ColorsEditor({ colors, onChange, madeira = false }) {
  function addColor() {
    onChange([...colors, { name: "", hex: "#FFFFFF" }])
  }
  function upd(i, k, v) {
    var c = colors.slice()
    c[i] = Object.assign({}, c[i], { [k]: v })
    onChange(c)
  }
  function del(i) {
    var c = colors.slice()
    c.splice(i, 1)
    onChange(c)
  }
  return (
    <div>
      {colors.map((col, i) => {
        var cm = h2c(col.hex || "#FFFFFF")
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 10px", background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 8 }}>
            <input type="color" value={col.hex || "#FFFFFF"} onChange={(e) => upd(i, "hex", e.target.value)} style={{ width: 38, height: 38, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              {madeira && (
                <select
                  value=""
                  onChange={(e) => {
                    const thread = MADEIRA_CLASSIC_RAYON.find((item) => item.code === e.target.value)
                    if (thread) upd(i, "name", "Madeira " + thread.code + " · " + thread.name)
                  }}
                  style={{ padding: "5px 8px", border: "1px solid #c8c8c8", borderRadius: 5, fontSize: 12, background: palette.white.hex, width: "100%" }}
                >
                  <option value="">Elegir hilo Madeira Classic Rayon</option>
                  {MADEIRA_CLASSIC_RAYON.map((thread) => (
                    <option key={thread.code} value={thread.code}>{thread.code} · {thread.name}</option>
                  ))}
                </select>
              )}
              <input
                value={col.name}
                onChange={(e) => upd(i, "name", e.target.value)}
                placeholder={madeira ? "Ej: PANTONE 11-4302 TCX Cannoli Cream, o el codigo Madeira (1055)" : "Ej: PANTONE 11-4302 TCX Cannoli Cream"}
                list={madeira ? "madeira-thread-palette" : undefined}
                style={{ padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>
                {col.hex} | C:{cm.c} M:{cm.m} Y:{cm.y} K:{cm.k}
              </div>
            </div>
            <button onClick={() => del(i)} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
              x
            </button>
          </div>
        )
      })}
      <button onClick={addColor} style={{ padding: "6px 14px", background: palette.white.hex, border: "1.5px dashed " + role.priority.fill, borderRadius: 7, color: role.priority.fill, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
        + Color
      </button>
      {madeira && (
        <datalist id="madeira-thread-palette">
          {MADEIRA_CLASSIC_RAYON.map((t) => (
            <option key={t.code} value={"Madeira " + t.code + " " + t.name}>
              {t.name}
            </option>
          ))}
        </datalist>
      )}
    </div>
  )
}
