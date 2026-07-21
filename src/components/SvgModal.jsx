import { useState } from "react"
import { palette, role, type, space } from "../design/tokens.js"
import { Icon } from "./Icon.jsx"
import { buildIllustratorPackageBlob } from "../core/illustratorPackage.js"
import illustratorImporter from "../../docs/illustrator-comparison/Techpack-Import-Illustrator.jsx?raw"

const C = palette
const hair = `1px solid ${C.ink.hex}`

export function SvgModal({ pages, onClose }) {
  const [selPage, setSelPage] = useState(0)
  const [packaging, setPackaging] = useState(false)
  const [failed, setFailed] = useState("")
  if (!pages || !pages.length) return null
  var cur = pages[selPage]
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

  // Confirmed live, twice: Illustrator discards a plain SVG's group ids on
  // import, so a single self-contained file - however it lays the pages out -
  // always collapses to one flat layer. The importer script is not an
  // optional extra; it is the only path to real native layers, because it
  // works by opening each page as its OWN document and fusing them from
  // inside Illustrator, which is where the seven groups get promoted to real
  // layers. So the one download is this ZIP: `pages/*.svg` (self-contained,
  // no external assets folder to lose) plus the script - nothing else, since
  // nothing else is read by it. Running the script is the last step; its
  // output is the single final .ai file with real layers and named artboards.
  async function downloadPackage() {
    if (packaging) return
    setPackaging(true)
    setFailed("")
    try {
      const blob = await buildIllustratorPackageBlob(pages, illustratorImporter)
      download(blob, "application/zip", "techpack-" + pages.length + "-paginas.zip")
    } catch (error) {
      setFailed((error && error.message) || "No se pudo generar el paquete.")
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
              onClick={() => setSelPage(i)}
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
          <span style={{ fontSize: type.size.xs, color: C.ink.hex }}>
            Descomprimí el ZIP y corré <b>Techpack-Import-Illustrator.jsx</b> (Archivo &gt; Secuencias de comandos &gt; Otra secuencia de comandos) — arma un solo <b>.ai</b> con las {pages.length} páginas como mesas de trabajo nombradas y las 7 capas nativas reales. Affinity: abrí cualquier SVG de <b>pages/</b> directamente, sin script.
          </span>
        </div>
        <textarea
          id="svgta"
          readOnly
          value={cur.svg}
          style={{ flex: 1, padding: space(3), fontFamily: type.fonts.data, fontSize: 10, border: "none", outline: "none", resize: "none", background: C.ink.hex, color: "#8AA9F0", lineHeight: 1.5, overflowY: "auto", minHeight: 200 }}
        />
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderTop: hair, display: "flex", gap: space(2), justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.6, marginRight: "auto" }}>{(cur.svg.length / 1024).toFixed(1)} KB</span>
          {failed && <span style={{ fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>{failed}</span>}
          <button disabled={packaging} onClick={downloadPackage} style={{ ...btn(role.index.fill, role.index.on), opacity: packaging ? 0.55 : 1 }} title="pages/*.svg + el script que las fusiona en un solo .ai con capas nativas">
            <Icon name="folder_zip" size={16} color={role.index.on} /> {packaging ? "Preparando..." : "Descargar ficha completa"}
          </button>
        </div>
      </div>
    </div>
  )
}
