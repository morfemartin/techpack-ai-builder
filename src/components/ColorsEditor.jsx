import { useState } from "react"
import { h2c } from "../core/colorUtils.js"
import { MADEIRA_CLASSIC_RAYON, searchMadeiraThreads } from "../core/madeiraThreads.js"
import { applyMadeiraThread, normalizeFabricColor, pantoneDisplay } from "../core/colorSpecs.js"
import { palette, role } from "../design/tokens.js"

// This is the ONLY color picker most designs ever use - the Wilcom-worksheet
// stopSeq rows in EmbForm.jsx are a different, narrower field (thread
// code/name for a digitized run) that most embroidery designs never touch
// until a PDF gets uploaded. A user picking a thread color for a design's
// main palette needs the Madeira catalog HERE, not buried in a sub-form -
// see madeiraThreads.js for why the official chart, not a guess, is used.
export function ColorsEditor({ colors, onChange, madeira = false }) {
  const [searches, setSearches] = useState({})
  function addColor() {
    onChange([...colors, madeira ? { name: "", hex: "#FFFFFF", madeira: null } : normalizeFabricColor({ name: "", hex: "#FFFFFF" })])
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
        var query = searches[i] || ""
        var matches = query ? searchMadeiraThreads(query, 18) : MADEIRA_CLASSIC_RAYON.slice(0, 18)
        var catalogThread = madeira && col.madeira && col.madeira.code
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, padding: "8px 10px", background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 8 }}>
            {(!madeira || !catalogThread) ? (
              <input type="color" value={col.hex || "#FFFFFF"} onChange={(e) => upd(i, "hex", e.target.value)} style={{ width: 38, height: 38, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2, flexShrink: 0 }} />
            ) : (
              <span title="Referencia visual de pantalla; el codigo Madeira es vinculante" style={{ width: 38, height: 38, border: "1px solid #777", borderRadius: 4, background: col.hex, flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              {madeira && (
                <>
                  <input
                    value={query}
                    onChange={(e) => setSearches((current) => ({ ...current, [i]: e.target.value }))}
                    placeholder="Buscar codigo o nombre Madeira"
                    style={{ padding: "5px 8px", border: "1px solid #c8c8c8", borderRadius: 5, fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                  {catalogThread && (
                    <button type="button" onClick={() => { var copy = colors.slice(); copy[i] = { name: "", hex: col.hex || "#FFFFFF", madeira: { custom: true } }; onChange(copy) }} style={{ alignSelf: "flex-start", padding: "3px 7px", border: "1px solid #777", background: palette.white.hex, fontSize: 9, cursor: "pointer" }}>
                      Usar hilo personalizado
                    </button>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 4, maxHeight: 132, overflowY: "auto", padding: 4, border: "1px solid #ddd", background: palette.white.hex }}>
                    {matches.map((thread) => {
                      const next = applyMadeiraThread(col, thread.code)
                      return (
                        <button key={thread.code} type="button" onClick={() => { var copy = colors.slice(); copy[i] = next; onChange(copy) }} title={thread.code + " · " + thread.name} style={{ display: "grid", gridTemplateColumns: "22px 1fr", alignItems: "center", gap: 5, padding: 4, border: catalogThread === thread.code ? "2px solid " + role.priority.fill : "1px solid #ddd", background: palette.white.hex, cursor: "pointer", textAlign: "left", fontSize: 9 }}>
                          <span style={{ width: 20, height: 20, background: next.hex, border: "1px solid #777" }} />
                          <span><b>{thread.code}</b><br />{thread.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              <input
                value={col.name}
                onChange={(e) => upd(i, "name", e.target.value)}
                placeholder={madeira ? "Hilo personalizado" : "Nombre del color"}
                readOnly={!!catalogThread}
                style={{ padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>
                {col.hex} | C:{cm.c} M:{cm.m} Y:{cm.y} K:{cm.k}
              </div>
              {!madeira && (
                <>
                  <input value={col.pantoneApprox || ""} onChange={(e) => { var copy = colors.slice(); copy[i] = normalizeFabricColor({ ...col, pantoneApprox: e.target.value, pantoneStatus: e.target.value ? "approximate" : "pending" }); onChange(copy) }} placeholder="Pantone aproximado (opcional)" style={{ padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12 }} />
                  <div style={{ fontSize: 9, color: col.pantoneApprox ? role.index.fill : "#777", fontWeight: 700 }}>{pantoneDisplay(col)}</div>
                </>
              )}
              {catalogThread && <div style={{ fontSize: 9, color: "#777" }}>Muestra de pantalla. Codigo Madeira vinculante.</div>}
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
    </div>
  )
}
