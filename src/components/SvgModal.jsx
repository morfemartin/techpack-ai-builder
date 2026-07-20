import { useState } from "react"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"
import { prepareIllustratorSvg } from "../core/illustratorSvg.js"
import { buildIllustratorPackageBlob } from "../core/illustratorPackage.js"
import illustratorImporter from "../../docs/illustrator-comparison/Techpack-Import-Illustrator.jsx?raw"

const C = palette
const hair = `1px solid ${C.ink.hex}`

export function SvgModal({ pages, onClose }) {
  const [selPage, setSelPage] = useState(0)
  const [copied, setCopied] = useState(false)
  const [packaging, setPackaging] = useState(false)
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
  function download(content, mime, name) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime })
    var uri = URL.createObjectURL(blob)
    var a = document.createElement("a")
    a.href = uri
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(uri)
  }
  function downloadOriginal() {
    download(cur.svg, "image/svg+xml;charset=utf-8", cur.name + "-original.svg")
  }
  function downloadEditable() {
    const prepared = prepareIllustratorSvg(cur.svg, cur)
    download(prepared, "image/svg+xml;charset=utf-8", cur.name + "-editable.svg")
  }
  function downloadImporter() {
    download(illustratorImporter, "text/javascript;charset=utf-8", "Techpack-Import-Illustrator.jsx")
  }
  async function downloadPackage() {
    if (packaging) return
    setPackaging(true)
    try {
      const blob = await buildIllustratorPackageBlob(pages, illustratorImporter)
      download(blob, "application/zip", "techpack-illustrator-" + pages.length + "-paginas.zip")
    } finally {
      setPackaging(false)
    }
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
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,21,24,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: space(4) }}>
      <div style={{ background: C.white.hex, width: "100%", maxWidth: 840, maxHeight: "92vh", display: "flex", flexDirection: "column", border: hair }}>
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderBottom: hair, display: "flex", justifyContent: "space-between", alignItems: "center", gap: space(3) }}>
          <div>
            <div style={{ fontSize: type.size.md, fontWeight: 700, fontFamily: type.fonts.display, textTransform: "uppercase", letterSpacing: "0.02em", color: C.ink.hex }}>Exportación vectorial</div>
            <div style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.6, marginTop: 2 }}>Cada página = un SVG A4 con capas semánticas</div>
          </div>
          <button onClick={onClose} style={{ ...btn(C.white.hex, C.ink.hex), padding: space(1) }} title="Cerrar">
            <Icon name="close" size={20} />
          </button>
        </div>
        {/* page tabs */}
        <div style={{ display: "flex", borderBottom: hair, overflowX: "auto" }}>
          {pages.map((p, i) => (
            <button
              key={i}
              onClick={() => { setSelPage(i); setCopied(false) }}
              style={{
                padding: `${space(2)}px ${space(3)}px`,
                background: selPage === i ? role.priority.fill : C.white.hex,
                color: selPage === i ? role.priority.on : C.ink.hex,
                border: "none",
                borderRight: hair,
                cursor: "pointer",
                fontSize: type.size.xs,
                fontFamily: type.fonts.data,
                fontWeight: selPage === i ? 700 : 500,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ padding: `${space(2)}px ${space(4)}px`, background: C.canvas.hex, borderBottom: hair }}>
          <span style={{ fontSize: type.size.xs, color: role.priority.fill, fontWeight: 700 }}>Affinity: </span>
          <span style={{ fontSize: type.size.xs, color: C.ink.hex }}>abre el SVG editable directamente. </span>
          <span style={{ fontSize: type.size.xs, color: role.priority.fill, fontWeight: 700 }}>Illustrator: </span>
          <span style={{ fontSize: type.size.xs, color: C.ink.hex }}>descarga el editable y ejecuta el importador JSX para crear capas nativas.</span>
        </div>
        <textarea
          id="svgta"
          readOnly
          value={cur.svg}
          style={{ flex: 1, padding: space(3), fontFamily: type.fonts.data, fontSize: 10, border: "none", outline: "none", resize: "none", background: C.ink.hex, color: "#8AA9F0", lineHeight: 1.5, overflowY: "auto", minHeight: 200 }}
        />
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderTop: hair, display: "flex", gap: space(2), justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.6, marginRight: "auto" }}>{(cur.svg.length / 1024).toFixed(1)} KB</span>
          <button onClick={downloadOriginal} style={btn(C.white.hex, C.ink.hex)} title="Salida anterior para diagnóstico y comparación">
            <Icon name="download" size={16} /> SVG original
          </button>
          <button onClick={downloadImporter} style={btn(C.ink.hex, C.white.hex)} title="Script auditable para crear capas nativas en Illustrator">
            <Icon name="code" size={16} color={C.white.hex} /> Importador JSX
          </button>
          <button onClick={downloadEditable} style={btn(role.priority.fill, role.priority.on)}>
            <Icon name="download" size={16} color={C.white.hex} /> SVG editable
          </button>
          <button disabled={packaging} onClick={downloadPackage} style={{ ...btn(role.index.fill, role.index.on), opacity: packaging ? 0.55 : 1 }} title="Un AI con todas las páginas como mesas de trabajo nombradas">
            <Icon name="folder_zip" size={16} color={role.index.on} /> {packaging ? "Preparando..." : "Paquete completo"}
          </button>
          <button onClick={copyCode} style={btn(copied ? role.index.fill : C.ink.hex, C.white.hex)}>
            <Icon name={copied ? "check" : "content_copy"} size={16} color={C.white.hex} /> {copied ? "Copiado" : "Copiar código"}
          </button>
        </div>
      </div>
    </div>
  )
}
