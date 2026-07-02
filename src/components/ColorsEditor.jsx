import { h2c } from "../core/colorUtils.js"

export function ColorsEditor({ colors, onChange }) {
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
              <input value={col.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Ej: PANTONE 11-4302 TCX Cannoli Cream" style={{ padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" }} />
              <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>
                {col.hex} | C:{cm.c} M:{cm.m} Y:{cm.y} K:{cm.k}
              </div>
            </div>
            <button onClick={() => del(i)} style={{ background: "none", border: "none", color: "#E5352B", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
              x
            </button>
          </div>
        )
      })}
      <button onClick={addColor} style={{ padding: "6px 14px", background: "#FFFFFF", border: "1.5px dashed #1A3FB0", borderRadius: 7, color: "#1A3FB0", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
        + Color
      </button>
    </div>
  )
}
