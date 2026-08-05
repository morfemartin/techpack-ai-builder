import { useState, useRef } from "react"
import { extractEmbFromPDF } from "../core/embExtract.js"
import { MADEIRA_CLASSIC_RAYON, findMadeiraThreadByCode, searchMadeiraThreads } from "../core/madeiraThreads.js"
import { normalizeMadeiraThread } from "../core/colorSpecs.js"
import { palette, role } from "../design/tokens.js"

export function EmbForm({ emb, onChange }) {
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(false)
  const [extractError, setExtractError] = useState("")
  const [corrections, setCorrections] = useState([])
  const [threadSearches, setThreadSearches] = useState({})
  const fileRef = useRef()
  function upd(k, v) {
    onChange(Object.assign({}, emb, { [k]: v }))
  }
  function updSeq(i, k, v) {
    var ss = emb.stopSeq ? emb.stopSeq.slice() : []
    var next = Object.assign({}, ss[i], { [k]: v })
    // Typing/picking a recognized Madeira code fills the official name in
    // the same keystroke - the code is authoritative, so this never leaves
    // the pair inconsistent with itself.
    if (k === "code") {
      var match = findMadeiraThreadByCode(v)
      var visual = normalizeMadeiraThread(v)
      if (match) next.name = match.name
      if (visual) {
        next.displayHex = visual.displayHex
        next.madeira = visual
        next.color = visual.displayHex
      }
    }
    ss[i] = next
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
  function useCustomThread(i) {
    var ss = emb.stopSeq ? emb.stopSeq.slice() : []
    ss[i] = Object.assign({}, ss[i], { code: "", displayHex: "", madeira: { custom: true } })
    onChange(Object.assign({}, emb, { stopSeq: ss }))
  }
  async function handlePDF(e) {
    var f = e.target.files[0]
    if (!f) return
    setExtracting(true)
    setExtracted(false)
    setExtractError("")
    setCorrections([])
    var reader = new FileReader()
    reader.onload = async function (ev) {
      try {
        var b64 = ev.target.result.split(",")[1]
        var result = await extractEmbFromPDF(b64)
        var extractedEmb = Object.assign({}, result.emb)
        if (Array.isArray(extractedEmb.stopSeq)) {
          extractedEmb.stopSeq = extractedEmb.stopSeq.map(function (stop) {
            var visual = normalizeMadeiraThread(stop && (stop.code || stop.name))
            return visual ? Object.assign({}, stop, { code: visual.code, name: visual.name, color: visual.displayHex, displayHex: visual.displayHex, madeira: visual }) : stop
          })
        }
        onChange(Object.assign({}, emb, extractedEmb))
        setCorrections(result.corrections)
        setExtracted(true)
      } catch (err) {
        // Previously this just returned null and the UI still said "PDF
        // extraido" - a real error the user could not see or act on. Now
        // it says exactly why (no Mistral/estudio, OCR found nothing, the
        // upstream rejected the file) instead of pretending it worked.
        setExtractError((err && err.message) || "No se pudo extraer el PDF.")
      } finally {
        setExtracting(false)
      }
    }
    reader.onerror = function () {
      setExtracting(false)
      setExtractError("No se pudo leer el archivo.")
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
    <div style={{ marginTop: 12, padding: 14, background: palette.white.hex, borderRadius: 10, border: "1px solid #c5d5f0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: role.priority.fill }}>Ficha Tecnica de Bordado</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {extracted && <span style={{ fontSize: 11, color: role.priority.fill, fontWeight: 600 }}>PDF extraido</span>}
          {extracting && <span style={{ fontSize: 11, color: role.index.fill, fontWeight: 600 }}>Extrayendo...</span>}
          <label style={{ padding: "6px 12px", background: "white", border: "1.5px dashed " + role.priority.fill, borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, color: role.priority.fill }}>
            Subir PDF Wilcom
            <input ref={fileRef} type="file" accept="application/pdf" onChange={handlePDF} style={{ display: "none" }} />
          </label>
        </div>
      </div>
      {extractError && (
        <div style={{ marginBottom: 12, padding: "6px 10px", background: role.highlight.fill, border: "1px solid " + role.highlight.keyline, borderRadius: 5, fontSize: 11, color: palette.ink.hex }}>
          {extractError}
        </div>
      )}
      {corrections.length > 0 && (
        <div style={{ marginBottom: 12, padding: "6px 10px", background: role.highlight.fill, border: "1px solid " + role.highlight.keyline, borderRadius: 5, fontSize: 11, color: palette.ink.hex }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Corregido segun el catalogo oficial Madeira:</div>
          {corrections.map((c, i) => (
            <div key={i}>
              Stop {c.stop}: {c.extractedCode || c.extractedName || "(sin dato)"} → {c.officialCode} {c.officialName}
            </div>
          ))}
        </div>
      )}
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
          <button onClick={addStop} style={{ padding: "4px 10px", background: "white", border: "1px solid " + role.priority.fill, borderRadius: 5, color: role.priority.fill, fontSize: 11, cursor: "pointer" }}>
            + Stop
          </button>
        </div>
        {(emb.stopSeq || []).map((st, i) => {
          var query = threadSearches[i] || ""
          var matches = query ? searchMadeiraThreads(query, 16) : MADEIRA_CLASSIC_RAYON.slice(0, 16)
          var catalogThread = st.madeira && st.madeira.code
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 100px 24px", gap: 8, marginBottom: 10, alignItems: "start", padding: 8, border: "1px solid #ddd", background: palette.white.hex }}>
              <span style={{ fontSize: 11, color: "#666", paddingTop: 7 }}>#{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <input value={query} onChange={(event) => setThreadSearches((current) => ({ ...current, [i]: event.target.value }))} placeholder="Buscar codigo o nombre Madeira" style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", border: "1px solid #bbb", fontSize: 11 }} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 4, maxHeight: 112, overflowY: "auto", marginTop: 5 }}>
                  {matches.map((thread) => {
                    var visual = normalizeMadeiraThread(thread.code)
                    return <button key={thread.code} type="button" onClick={() => updSeq(i, "code", thread.code)} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: 5, alignItems: "center", padding: 4, border: catalogThread === thread.code ? "2px solid " + role.priority.fill : "1px solid #ddd", background: palette.white.hex, textAlign: "left", fontSize: 9, cursor: "pointer" }}><span style={{ width: 18, height: 18, background: visual.displayHex, border: "1px solid #777" }} /><span><b>{thread.code}</b><br />{thread.name}</span></button>
                  })}
                </div>
                {catalogThread ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 9, color: "#666" }}><span style={{ width: 16, height: 16, background: st.displayHex, border: "1px solid #777" }} /><b>{st.code}</b> {st.name}<button type="button" onClick={() => useCustomThread(i)} style={{ marginLeft: "auto", border: "1px solid #777", background: palette.white.hex, cursor: "pointer", fontSize: 9 }}>Hilo personalizado</button></div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "54px 1fr", gap: 5, marginTop: 5 }}><input type="color" value={st.color || "#FFFFFF"} onChange={(event) => updSeq(i, "color", event.target.value)} /><input value={st.name || ""} onChange={(event) => updSeq(i, "name", event.target.value)} placeholder="Nombre del hilo personalizado" style={{ padding: "4px 6px", border: "1px solid #ddd", fontSize: 10 }} /></div>
                )}
              </div>
              <div><label style={{ fontSize: 9, color: "#777" }}>Puntadas</label><input value={st.stitches || ""} onChange={(event) => updSeq(i, "stitches", event.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "5px 6px", border: "1px solid #ddd", fontSize: 11 }} /></div>
              <button onClick={() => delStop(i)} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 14, paddingTop: 5 }}>x</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
