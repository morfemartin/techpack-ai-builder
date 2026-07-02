import { useState, useRef } from "react"
import { extractEmbFromPDF } from "../core/claudeApi.js"

export function EmbForm({ emb, onChange }) {
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(false)
  const fileRef = useRef()
  function upd(k, v) {
    onChange(Object.assign({}, emb, { [k]: v }))
  }
  function updSeq(i, k, v) {
    var ss = emb.stopSeq ? emb.stopSeq.slice() : []
    ss[i] = Object.assign({}, ss[i], { [k]: v })
    onChange(Object.assign({}, emb, { stopSeq: ss }))
  }
  function addStop() {
    var ss = emb.stopSeq ? emb.stopSeq.slice() : []
    ss.push({ stop: ss.length + 1, color: "", stitches: "", code: "", name: "" })
    onChange(Object.assign({}, emb, { stopSeq: ss }))
  }
  function delStop(i) {
    var ss = emb.stopSeq ? emb.stopSeq.slice() : []
    ss.splice(i, 1)
    onChange(Object.assign({}, emb, { stopSeq: ss }))
  }
  async function handlePDF(e) {
    var f = e.target.files[0]
    if (!f) return
    setExtracting(true)
    var reader = new FileReader()
    reader.onload = async function (ev) {
      var b64 = ev.target.result.split(",")[1]
      var data = await extractEmbFromPDF(b64)
      if (data) onChange(Object.assign({}, emb, data))
      setExtracting(false)
      setExtracted(true)
    }
    reader.readAsDataURL(f)
  }
  var fields = [
    { k: "machine", lbl: "Formato Maquina" }, { k: "stitches", lbl: "Puntadas" }, { k: "colorChanges", lbl: "Cambios Color" }, { k: "stops", lbl: "Paradas" },
    { k: "trims", lbl: "Cortes" }, { k: "fabric", lbl: "Tela" }, { k: "stabTopping", lbl: "Estab. Top" }, { k: "stabBacking", lbl: "Estab. Backing" },
    { k: "appliques", lbl: "Apliques" }, { k: "w", lbl: "Ancho (mm)" }, { k: "h", lbl: "Alto (mm)" }, { k: "area", lbl: "Area (mm2)" },
    { k: "maxStitch", lbl: "Max Puntada" }, { k: "minStitch", lbl: "Min Puntada" }, { k: "maxJump", lbl: "Max Salto" }, { k: "totalThread", lbl: "Hilo Total" }, { k: "totalBobbin", lbl: "Bobina Total" },
  ]
  return (
    <div style={{ marginTop: 12, padding: 14, background: "#f0f4ff", borderRadius: 10, border: "1px solid #c5d5f0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a4fd6" }}>Ficha Tecnica de Bordado</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {extracted && <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>PDF extraido</span>}
          {extracting && <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 600 }}>Extrayendo...</span>}
          <label style={{ padding: "6px 12px", background: "white", border: "1.5px dashed #1a4fd6", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#1a4fd6" }}>
            Subir PDF Wilcom
            <input ref={fileRef} type="file" accept="application/pdf" onChange={handlePDF} style={{ display: "none" }} />
          </label>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {fields.map((f) => (
          <div key={f.k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#555", textTransform: "uppercase" }}>{f.lbl}</label>
            <input value={emb[f.k] || ""} onChange={(e) => upd(f.k, e.target.value)} style={{ padding: "5px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 12, outline: "none" }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>Secuencia de Stops</span>
          <button onClick={addStop} style={{ padding: "4px 10px", background: "white", border: "1px solid #1a4fd6", borderRadius: 5, color: "#1a4fd6", fontSize: 11, cursor: "pointer" }}>
            + Stop
          </button>
        </div>
        {(emb.stopSeq || []).map((st, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#888", minWidth: 18, paddingBottom: 4 }}>#{i + 1}</span>
            {[["color", "Color"], ["stitches", "Punt."], ["code", "Cod."], ["name", "Nombre"]].map((kl) => (
              <div key={kl[0]} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <label style={{ fontSize: 9, color: "#aaa" }}>{kl[1]}</label>
                <input value={st[kl[0]] || ""} onChange={(e) => updSeq(i, kl[0], e.target.value)} style={{ padding: "3px 6px", border: "1px solid #e0e0e0", borderRadius: 4, fontSize: 11, outline: "none" }} />
              </div>
            ))}
            <button onClick={() => delStop(i)} style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 14, paddingBottom: 4 }}>
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
