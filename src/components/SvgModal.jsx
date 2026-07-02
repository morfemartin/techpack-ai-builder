import { useState } from "react"

export function SvgModal({ pages, onClose }) {
  const [selPage, setSelPage] = useState(0)
  const [copied, setCopied] = useState(false)
  if (!pages || !pages.length) return null
  var cur = pages[selPage]
  function copyCode() {
    try {
      navigator.clipboard.writeText(cur.svg)
    } catch (ex) {}
    var ta = document.getElementById("svgta")
    if (ta) {
      ta.select()
      try {
        document.execCommand("copy")
      } catch (e) {}
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  function tryDownload() {
    var uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(cur.svg)
    var a = document.createElement("a")
    a.href = uri
    a.download = cur.name + ".svg"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: 820, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2340" }}>Archivos SVG generados</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Cada pagina = un archivo SVG separado (artboard propio en Illustrator)</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>
            x
          </button>
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #eee", overflowX: "auto" }}>
          {pages.map((p, i) => (
            <button key={i} onClick={() => { setSelPage(i); setCopied(false) }} style={{ padding: "8px 14px", background: selPage === i ? "#1a4fd6" : "white", color: selPage === i ? "white" : "#555", border: "none", borderBottom: selPage === i ? "3px solid #1a4fd6" : "3px solid transparent", cursor: "pointer", fontSize: 11, fontWeight: selPage === i ? 700 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ padding: "10px 20px", background: "#f0f7ff", borderBottom: "1px solid #eee" }}>
          <span style={{ fontSize: 11, color: "#1a4fd6", fontWeight: 600 }}>Como abrir en Illustrator con artboards separados: </span>
          <span style={{ fontSize: 11, color: "#444" }}>Guarda cada pagina como .svg independiente. En AI: Archivo &gt; Colocar (o abrir uno a uno y copiar al documento principal).</span>
        </div>
        <textarea id="svgta" readOnly value={cur.svg} style={{ flex: 1, padding: 12, fontFamily: "monospace", fontSize: 9.5, border: "none", outline: "none", resize: "none", background: "#0d1117", color: "#79c0ff", lineHeight: 1.5, overflowY: "auto", minHeight: 200 }} />
        <div style={{ padding: "12px 20px", borderTop: "1px solid #eee", display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#888" }}>{(cur.svg.length / 1024).toFixed(1)} KB</span>
          <button onClick={tryDownload} style={{ padding: "9px 18px", background: "#27ae60", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
            Descargar .svg
          </button>
          <button onClick={copyCode} style={{ padding: "9px 22px", background: copied ? "#27ae60" : "#1a4fd6", color: "white", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700, transition: "background 0.2s" }}>
            {copied ? "Copiado!" : "Copiar codigo"}
          </button>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "white", color: "#555", border: "1px solid #ddd", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
