import { useState } from "react"
import { uid } from "./core/idGen.js"
import { T } from "./core/i18n.js"
import { EMPTY_EMB, isEmbTec, isWholePosF } from "./core/helpers.js"
import { translateContent } from "./core/claudeApi.js"
import { buildAllPages } from "./pages/buildPages.js"
import { GARMENTS, GARMENT_LIST } from "./garments/index.js"
import { Inp, Sel, Fld } from "./components/FormControls.jsx"
import { ColorsEditor } from "./components/ColorsEditor.jsx"
import { ImageUploader } from "./components/ImageUploader.jsx"
import { EmbForm } from "./components/EmbForm.jsx"
import { SvgModal } from "./components/SvgModal.jsx"
import { Preview } from "./components/Preview.jsx"

const ICONS = ["🧵", "🌐", "📋", "🧩", "🎨", "👁"]

function newDesign() {
  return {
    id: uid(), name: "Nuevo Diseno", pos: "", posDetail: "", w: "", h: "", tec: "Bordado 3D",
    colors: [], fileName: "", driveLink: "", imageData: null, imageType: null, imgNatW: null, imgNatH: null,
    emb: Object.assign({}, EMPTY_EMB, { stopSeq: [] }),
  }
}

export default function App() {
  const [step, setStep] = useState(0)
  const [garmentId, setGarmentId] = useState("cap")
  const [langs, setLangs] = useState(["ES"])
  const [hdr, setHdr] = useState({ brand: "", season: "2027 SS/FW", sno: "", cat: "Accesorio", fab: "100% Poliester", fac: "", ind: "", outd: "", pname: "" })
  const garment = GARMENTS[garmentId]
  const [parts, setParts] = useState(garment.defaultParts.map((p) => Object.assign({}, p)))
  const [designs, setDesigns] = useState([
    Object.assign(newDesign(), { name: "Logo Frontal", pos: garment.positions.ES[3] || garment.positions.ES[0], posDetail: "Centrado", colors: [{ name: "PANTONE 286 C", hex: "#003DA5" }, { name: "PANTONE White", hex: "#FFFFFF" }] }),
  ])
  const [logo, setLogo] = useState(null)
  const [prevLang, setPrevLang] = useState("ES")
  const [prevPage, setPrevPage] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [txCache, setTxCache] = useState({})
  const [svgPages, setSvgPages] = useState(null)
  const tl = T.ES

  function selectGarment(id) {
    if (id === garmentId) return
    const g = GARMENTS[id]
    setGarmentId(id)
    setParts(g.defaultParts.map((p) => Object.assign({}, p)))
    setDesigns([Object.assign(newDesign(), { pos: g.positions.ES[0] })])
    setTxCache({})
    setPrevPage(0)
  }
  function toggleLang(c) {
    setLangs((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))
  }
  function updPart(id, k, v) {
    setParts((p) => p.map((x) => (x.id === id ? Object.assign({}, x, { [k]: v }) : x)))
  }
  function updDesign(id, k, v) {
    setDesigns((p) => p.map((x) => (x.id === id ? Object.assign({}, x, { [k]: v }) : x)))
  }
  function updDesignMulti(id, obj) {
    setDesigns((p) => p.map((x) => (x.id === id ? Object.assign({}, x, obj) : x)))
  }

  function handleLogo(e) {
    var f = e.target.files[0]
    if (!f) return
    var r = new FileReader()
    r.onload = (ev) => setLogo(ev.target.result)
    r.readAsDataURL(f)
  }

  async function ensureTx(lang) {
    if (lang === "ES" || txCache[lang]) return txCache[lang] || null
    setTranslating(true)
    var tx = await translateContent(hdr, parts, designs, lang)
    setTxCache((p) => Object.assign({}, p, { [lang]: tx }))
    setTranslating(false)
    return tx
  }

  async function handleGenerate(lang) {
    var tx = await ensureTx(lang)
    var pages = buildAllPages(lang, hdr, parts, designs, logo, tx, garment)
    setSvgPages(pages)
  }

  function canNext() {
    if (step === 0) return !!garmentId
    if (step === 1) return langs.length > 0
    if (step === 2) return hdr.brand.trim() && hdr.pname.trim()
    return true
  }

  function renderStep() {
    if (step === 0)
      return (
        <div>
          <p style={{ color: "#555", margin: "0 0 14px", fontSize: 13 }}>{tl.garmentStep}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {GARMENT_LIST.map((g) => (
              <label
                key={g.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", border: "2px solid " + (garmentId === g.id ? "#1a4fd6" : "#d0d0d0"), borderRadius: 10, cursor: "pointer", background: garmentId === g.id ? "#eff4ff" : "white", fontSize: 14, fontWeight: garmentId === g.id ? 700 : 400 }}
              >
                <input type="radio" checked={garmentId === g.id} onChange={() => selectGarment(g.id)} style={{ display: "none" }} />
                {g.icon} {g.label.ES} {garmentId === g.id && <span style={{ color: "#1a4fd6", fontWeight: 700 }}>ok</span>}
              </label>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", border: "2px dashed #d0d0d0", borderRadius: 10, fontSize: 13, color: "#999" }}>+ Mas tipos de prenda proximamente — contribuye uno en GitHub</div>
          </div>
        </div>
      )

    if (step === 1)
      return (
        <div>
          <p style={{ color: "#555", margin: "0 0 14px", fontSize: 13 }}>{tl.langStep}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[{ c: "ES", l: "Espanol" }, { c: "EN", l: "English" }, { c: "ZH", l: "Zhongwen" }].map((item) => (
              <label key={item.c} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", border: "2px solid " + (langs.includes(item.c) ? "#1a4fd6" : "#d0d0d0"), borderRadius: 10, cursor: "pointer", background: langs.includes(item.c) ? "#eff4ff" : "white", fontSize: 14, fontWeight: langs.includes(item.c) ? 700 : 400 }}>
                <input type="checkbox" checked={langs.includes(item.c)} onChange={() => toggleLang(item.c)} style={{ display: "none" }} />
                {item.l} {langs.includes(item.c) && <span style={{ color: "#1a4fd6", fontWeight: 700 }}>ok</span>}
              </label>
            ))}
          </div>
        </div>
      )

    if (step === 2)
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Fld lbl="Logo de la Marca">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ padding: "8px 14px", background: logo ? "#e8f5e9" : "#f0f4ff", border: "1.5px dashed " + (logo ? "#27ae60" : "#1a4fd6"), borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: logo ? "#27ae60" : "#1a4fd6" }}>
                {logo ? "Logo cargado - cambiar" : "Seleccionar imagen (PNG, JPG, SVG)"}
                <input type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} />
              </label>
              {logo && <img src={logo} style={{ height: 46, maxWidth: 100, objectFit: "contain", border: "1px solid #eee", borderRadius: 4, padding: 4 }} alt="logo" />}
              {logo && (
                <button onClick={() => setLogo(null)} style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 18 }}>
                  x
                </button>
              )}
            </div>
          </Fld>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Marca", "brand", "Ej: New Era"], ["Temporada", "season", "Ej: 2027 SS/FW"], ["Codigo", "sno", "Ej: 2ACP002"], ["Tela", "fab", "Ej: 100% Poliester"], ["Fabrica", "fac", "Ej: Colombia"], ["Fecha Entrada", "ind", "18/10/2027"], ["Fecha Salida", "outd", "20/11/2027"]].map((row) => (
              <Fld key={row[1]} lbl={row[0]}>
                <Inp v={hdr[row[1]]} ch={(v) => setHdr((p) => Object.assign({}, p, { [row[1]]: v }))} ph={row[2]} />
              </Fld>
            ))}
            <Fld lbl="Categoria">
              <Sel v={hdr.cat} ch={(v) => setHdr((p) => Object.assign({}, p, { cat: v }))} opts={tl.cats} />
            </Fld>
            <Fld lbl="Nombre del Producto" span={2}>
              <Inp v={hdr.pname} ch={(v) => setHdr((p) => Object.assign({}, p, { pname: v }))} ph="Ej: Gorra New Era 59FIFTY Los Angeles" />
            </Fld>
          </div>
        </div>
      )

    if (step === 3) {
      const pn = garment.partLabels.ES
      return (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {parts.map((p) => {
              var nm = p.customName || pn[p.id] || "P" + p.id
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: "1px solid #e0e0e0", borderRadius: 8, background: p.on ? "white" : "#f6f6f6", opacity: p.on ? 1 : 0.5 }}>
                  <input type="checkbox" checked={p.on} onChange={() => updPart(p.id, "on", !p.on)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#1a4fd6", flexShrink: 0 }} />
                  <span style={{ width: 140, fontSize: 11, fontWeight: 600, color: "#444", flexShrink: 0 }}>{nm}</span>
                  <input value={p.val} onChange={(e) => updPart(p.id, "val", e.target.value)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #d0d0d0", borderRadius: 5, fontSize: 11, outline: "none", background: p.on ? "white" : "#eee" }} />
                  {p.customName && (
                    <button onClick={() => setParts((prev) => prev.filter((x) => x.id !== p.id))} style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 15 }}>
                      x
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <button onClick={() => setParts((p) => [...p, { id: uid(), val: "", on: true, customName: "Pieza personalizada" }])} style={{ marginTop: 10, padding: "8px 16px", background: "#f0f4ff", border: "1.5px dashed #1a4fd6", borderRadius: 8, color: "#1a4fd6", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            + Agregar Pieza
          </button>
        </div>
      )
    }

    if (step === 4) {
      const positions = garment.positions.ES
      return (
        <div>
          {designs.map((d, i) => {
            var isEmb = isEmbTec(d.tec), isWhole = isWholePosF(d.pos)
            return (
              <div key={d.id} style={{ marginBottom: 16, padding: 14, border: "1px solid #e0e0e0", borderRadius: 10, background: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a4fd6" }}>
                    Diseno {i + 1}: {d.name}
                  </span>
                  <button onClick={() => setDesigns((p) => p.filter((x) => x.id !== d.id))} style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 16 }}>
                    x
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Fld lbl="Nombre">
                    <Inp v={d.name} ch={(v) => updDesign(d.id, "name", v)} />
                  </Fld>
                  <Fld lbl="Posicion">
                    <Sel v={d.pos} ch={(v) => updDesign(d.id, "pos", v)} opts={positions} />
                  </Fld>
                  <Fld lbl="Tecnica">
                    <Sel v={d.tec} ch={(v) => updDesign(d.id, "tec", v)} opts={tl.tecs} />
                  </Fld>
                  {!isWhole ? (
                    <Fld lbl="Posicion Detallada">
                      <Inp v={d.posDetail || ""} ch={(v) => updDesign(d.id, "posDetail", v)} ph="Ej: Panel frontal centrado" />
                    </Fld>
                  ) : (
                    <div />
                  )}
                  {!isWhole && (
                    <Fld lbl="Ancho (mm)">
                      <Inp v={d.w || ""} ch={(v) => updDesign(d.id, "w", v)} ph="Ej: 111.6" />
                    </Fld>
                  )}
                  {!isWhole && (
                    <Fld lbl="Alto (mm)">
                      <Inp v={d.h || ""} ch={(v) => updDesign(d.id, "h", v)} ph="Ej: 59.1" />
                    </Fld>
                  )}
                  {isWhole && <div style={{ gridColumn: "span 2", padding: "8px 12px", background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, fontSize: 11, color: "#856404" }}>Diseno cubre toda la prenda - medidas no aplican.</div>}
                  <Fld lbl="Nombre del Archivo">
                    <Inp v={d.fileName || ""} ch={(v) => updDesign(d.id, "fileName", v)} ph="Ej: SUNNER_HAWAII_LOGO_v3.ai" />
                  </Fld>
                  <Fld lbl="Enlace Drive">
                    <Inp v={d.driveLink || ""} ch={(v) => updDesign(d.id, "driveLink", v)} ph="Ej: drive.google.com/..." mono={true} />
                  </Fld>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Fld lbl="Colores (selector + nombre Pantone)">
                    <ColorsEditor colors={d.colors || []} onChange={(c) => updDesign(d.id, "colors", c)} />
                  </Fld>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Fld lbl="Imagen del diseno (PNG o SVG - se muestra con cotas)">
                    <ImageUploader d={d} onUpdate={(obj) => updDesignMulti(d.id, obj)} />
                  </Fld>
                </div>
                {isEmb && <EmbForm emb={d.emb || Object.assign({}, EMPTY_EMB, { stopSeq: [] })} onChange={(emb) => updDesign(d.id, "emb", emb)} />}
              </div>
            )
          })}
          <button onClick={() => setDesigns((p) => [...p, Object.assign(newDesign(), { pos: positions[0] })])} style={{ padding: "9px 18px", background: "#f0f4ff", border: "1.5px dashed #1a4fd6", borderRadius: 8, color: "#1a4fd6", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            + Agregar Diseno
          </button>
        </div>
      )
    }

    if (step === 5) {
      var allPgs = [{ l: "Pag. Principal", i: 0 }, ...designs.map((d, i) => ({ l: "Diseno " + (i + 1), i: i + 1 }))]
      return (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#555", marginRight: 4 }}>Vista:</span>
              {allPgs.map((p) => (
                <button key={p.i} onClick={() => { setPrevPage(p.i); ensureTx(prevLang) }} style={{ padding: "5px 10px", background: prevPage === p.i ? "#1a4fd6" : "white", color: prevPage === p.i ? "white" : "#555", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: prevPage === p.i ? 700 : 400 }}>
                  {p.l}
                </button>
              ))}
              <span style={{ margin: "0 4px", borderLeft: "1px solid #ddd" }} />
              {langs.map((l) => (
                <button key={l} onClick={() => { setPrevLang(l); ensureTx(l) }} style={{ padding: "5px 10px", background: prevLang === l ? "#34495e" : "white", color: prevLang === l ? "white" : "#555", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: prevLang === l ? 700 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {translating && <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 600 }}>Traduciendo...</span>}
              {langs.map((l) => (
                <button key={l} onClick={() => handleGenerate(l)} style={{ padding: "7px 14px", background: "#1a4fd6", color: "white", border: "none", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
                  Generar SVG [{l}]
                </button>
              ))}
            </div>
          </div>
          <Preview lang={prevLang} hdr={hdr} parts={parts} designs={designs} logo={logo} page={prevPage} txCache={txCache} garment={garment} />
        </div>
      )
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#eef0f8", display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px", fontFamily: "Arial,sans-serif" }}>
      {svgPages && <SvgModal pages={svgPages} onClose={() => setSvgPages(null)} />}
      <div style={{ width: "100%", maxWidth: 940, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 42, height: 42, background: "#1a4fd6", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🧢</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, color: "#1a2340", letterSpacing: 1 }}>TECHPACK AI BUILDER</h1>
            <p style={{ margin: 0, fontSize: 11, color: "#999" }}>Generador Open Source de Fichas Tecnicas v0.1</p>
          </div>
        </div>
        <div style={{ display: "flex", background: "white", borderRadius: 10, overflow: "hidden", border: "1px solid #e0e0e0" }}>
          {tl.steps.map((s, i) => (
            <div key={i} onClick={() => { if (i < step) setStep(i) }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "10px 4px", background: i === step ? "#1a4fd6" : i < step ? "#e8efff" : "#f8f8f8", color: i === step ? "white" : i < step ? "#1a4fd6" : "#bbb", fontSize: 11, fontWeight: i === step ? 700 : 400, cursor: i < step ? "pointer" : "default", borderRight: i < tl.steps.length - 1 ? "1px solid #e0e0e0" : "none" }}>
              {ICONS[i]} {s}
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: "100%", maxWidth: 940, background: "white", borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.07)", overflow: "hidden" }}>
        <div style={{ padding: "14px 22px", borderBottom: "1px solid #f0f0f0", background: "#fafbff" }}>
          <h2 style={{ margin: 0, fontSize: 14, color: "#1a2340" }}>
            {ICONS[step]} {tl.steps[step]}
          </h2>
        </div>
        <div style={{ padding: "18px 22px", maxHeight: "64vh", overflowY: "auto" }}>{renderStep()}</div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", background: "#fafbff" }}>
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ padding: "8px 18px", background: step === 0 ? "#eee" : "white", color: step === 0 ? "#bbb" : "#555", border: "1px solid " + (step === 0 ? "#e0e0e0" : "#ccc"), borderRadius: 8, fontSize: 12, cursor: step === 0 ? "not-allowed" : "pointer", fontWeight: 600 }}>
            {tl.bk}
          </button>
          {step < 5 ? (
            <button onClick={() => { if (canNext()) setStep((s) => s + 1) }} disabled={!canNext()} style={{ padding: "8px 22px", background: canNext() ? "#1a4fd6" : "#b0c4e8", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: canNext() ? "pointer" : "not-allowed", fontWeight: 700 }}>
              {step === 4 ? tl.gen : tl.nxt}
            </button>
          ) : (
            <span style={{ fontSize: 11, color: "#888", alignSelf: "center" }}>Haz clic en "Generar SVG" para obtener los archivos</span>
          )}
        </div>
      </div>
    </div>
  )
}
