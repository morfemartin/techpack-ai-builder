import { useState } from "react"
import { uid } from "./core/idGen.js"
import { T } from "./core/i18n.js"
import { EMPTY_EMB, isEmbTec, isWholePosF } from "./core/helpers.js"
import { translateContent } from "./core/claudeApi.js"
import { importGarmentCSV, readFileText, buildExampleCSV, matchImagesToDesigns, csvSeedToRequirementsSeed } from "./core/csvImport.js"
import { DeepSeekError } from "./core/deepseekClient.js"
import { downscaleImage, extractGarmentFromImages } from "./core/visionExtract.js"
import { analyzeRequirements, pendingFields } from "./core/techpackRequirements.js"
import { buildAllPages } from "./pages/buildPages.js"
import { buildPlannedPages } from "./pages/interpretPlan.js"
import { planDocumentOutline, planPageLayout } from "./core/documentPlan.js"
import { GARMENTS, GARMENT_LIST } from "./garments/index.js"
import { buildCustomGarment, mapChatDesignsToDesigns } from "./garments/buildCustomGarment.js"
import { downloadGarmentFile } from "./garments/exportGarment.js"
import { Inp, Sel, Fld } from "./components/FormControls.jsx"
import { ColorsEditor } from "./components/ColorsEditor.jsx"
import { ImageUploader } from "./components/ImageUploader.jsx"
import { EmbForm } from "./components/EmbForm.jsx"
import { SvgModal } from "./components/SvgModal.jsx"
import { Preview } from "./components/Preview.jsx"
import { GarmentChat } from "./components/GarmentChat.jsx"
import { Icon } from "./components/Icon.jsx"
import { MorfeLogo } from "./components/MorfeLogo.jsx"
import { palette, role, type, space } from "./design/tokens.js"

// Material Symbols per wizard step (no emojis). Order matches T.*.steps.
const STEP_ICONS = ["checkroom", "translate", "badge", "widgets", "brush", "visibility"]

const C = palette
const hair = `1px solid ${C.ink.hex}`

// ── shared style atoms, derived from tokens ──────────────────────────────────
// A red enumeration chip (role.index): a numeric marker the eye finds first.
function IndexChip({ n, active }) {
  return (
    <span
      style={{
        width: space(6),
        height: space(6),
        flexShrink: 0,
        background: role.index.fill,
        color: role.index.on,
        fontFamily: type.fonts.data,
        fontWeight: 700,
        fontSize: type.size.sm,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // active step gets a small yellow keyline: highest priority, tiny area.
        boxShadow: active ? `0 0 0 2px ${role.highlight.fill}` : "none",
      }}
    >
      {n}
    </span>
  )
}

function primaryBtnStyle(enabled) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: space(2),
    padding: `${space(2)}px ${space(5)}px`,
    background: enabled ? role.priority.fill : C.canvas.hex,
    color: enabled ? role.priority.on : "#9AA0AB",
    border: hair,
    borderColor: enabled ? role.priority.fill : "#C6CAD2",
    fontFamily: type.fonts.ui,
    fontWeight: 700,
    fontSize: type.size.base,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: enabled ? "pointer" : "not-allowed",
  }
}

const secondaryBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: space(2),
  padding: `${space(2)}px ${space(4)}px`,
  background: C.white.hex,
  color: C.ink.hex,
  border: hair,
  fontFamily: type.fonts.ui,
  fontWeight: 700,
  fontSize: type.size.base,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
}

const dashedActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: space(2),
  marginTop: space(3),
  padding: `${space(2)}px ${space(4)}px`,
  background: C.white.hex,
  border: `1px dashed ${role.priority.fill}`,
  color: role.priority.fill,
  fontFamily: type.fonts.ui,
  fontSize: type.size.sm,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
}

function iconBtn(color) {
  return { background: "none", border: "none", color, cursor: "pointer", display: "inline-flex", padding: 0 }
}

function newDesign() {
  return {
    id: uid(), name: "Nuevo Diseno", pos: "", posDetail: "", w: "", h: "", tec: "Bordado 3D",
    colors: [], fileName: "", driveLink: "", imageData: null, imageType: null, imgNatW: null, imgNatH: null,
    illustrationBrief: "",
    emb: Object.assign({}, EMPTY_EMB, { stopSeq: [] }),
  }
}

export default function App() {
  const [step, setStep] = useState(0)
  const [garmentId, setGarmentId] = useState("cap")
  const [langs, setLangs] = useState(["ES"])
  const [hdr, setHdr] = useState({ brand: "", season: "2027 SS/FW", sno: "", cat: "Accesorio", fab: "100% Poliester", fac: "", ind: "", outd: "", pname: "" })
  // "custom" is a chat-drafted garment (GarmentChat.jsx) - not in the static
  // registry, lives only in this state until/unless someone downloads it as
  // a scaffold to PR in (see garments/exportGarment.js).
  const [customGarment, setCustomGarment] = useState(null)
  const garment = garmentId === "custom" ? customGarment : GARMENTS[garmentId]
  // Lazy initializers (the `() => ...` form): a plain `useState(garment.defaultParts...)`
  // re-evaluates that expression on EVERY render (React only uses the result
  // on mount, but the expression itself still runs) - once `garment` can be
  // null (garmentId === "custom" before the chat finishes), that throws on
  // every re-render instead of just once safely at mount.
  const [parts, setParts] = useState(() => GARMENTS.cap.defaultParts.map((p) => Object.assign({}, p)))
  const [designs, setDesigns] = useState(() => [
    Object.assign(newDesign(), { name: "Logo Frontal", pos: GARMENTS.cap.positions.ES[3] || GARMENTS.cap.positions.ES[0], posDetail: "Centrado", colors: [{ name: "PANTONE 286 C", hex: "#003DA5" }, { name: "PANTONE White", hex: "#FFFFFF" }] }),
  ])
  const [logo, setLogo] = useState(null)
  const [prevLang, setPrevLang] = useState("ES")
  const [prevPage, setPrevPage] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [txCache, setTxCache] = useState({})
  const [svgPages, setSvgPages] = useState(null)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvError, setCsvError] = useState(null)
  const [csvImages, setCsvImages] = useState([])
  const [csvImageNote, setCsvImageNote] = useState(null)
  const [visionEntry, setVisionEntry] = useState(false) // true once "Prenda desde foto" is chosen at step 0
  const [visionExtracting, setVisionExtracting] = useState(false)
  const [visionError, setVisionError] = useState(null)
  const [visionSeed, setVisionSeed] = useState(null) // { garmentType, seed } | null - feeds GarmentChat at the Piezas step
  const [csvVerifying, setCsvVerifying] = useState(false) // true while the post-CSV gate chat is up
  const [csvVerifySeed, setCsvVerifySeed] = useState(null) // { garmentType, seed } for that gate chat
  const [documentPlanning, setDocumentPlanning] = useState(false)
  const [documentPlanStatus, setDocumentPlanStatus] = useState("")
  const tl = T.ES

  function selectGarment(id, { vision = false } = {}) {
    if (id === garmentId && visionEntry === vision) return
    setGarmentId(id)
    setVisionEntry(vision)
    if (!vision) {
      setVisionSeed(null)
      setVisionError(null)
    }
    if (id === "custom") {
      setCustomGarment(null)
      setParts([])
      setDesigns([])
    } else {
      const g = GARMENTS[id]
      setParts(g.defaultParts.map((p) => Object.assign({}, p)))
      setDesigns([Object.assign(newDesign(), { pos: g.positions.ES[0] })])
    }
    setTxCache({})
    setPrevPage(0)
  }

  // F1: "ficha desde foto" entry point - downscales each photo client-side
  // (stays under the proxy's body-size limit), sends them to the vision
  // model, and stores the resulting {garmentType, seed} to hand to
  // GarmentChat at the Piezas step. A failed/skipped extraction still lets
  // the user continue - GarmentChat just starts from a blank naming phase,
  // same as picking "Prenda nueva (con IA)" directly.
  async function handleVisionUpload(e) {
    var files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setVisionExtracting(true)
    setVisionError(null)
    try {
      var downscaled = await Promise.all(files.map((f) => downscaleImage(f)))
      var result = await extractGarmentFromImages(downscaled, { lang: "ES" })
      setVisionSeed(result)
    } catch (err) {
      setVisionError(err instanceof DeepSeekError ? err.message : "No se pudo analizar la foto.")
    } finally {
      setVisionExtracting(false)
      e.target.value = ""
    }
  }

  function handleGarmentChatComplete(draft) {
    const g = buildCustomGarment(draft)
    setCustomGarment(g)
    setParts(g.defaultParts.map((p) => Object.assign({}, p)))
    const mapped = mapChatDesignsToDesigns(draft.designs, g.positions.ES[0])
    setDesigns(mapped.map((d) => Object.assign(newDesign(), d)))
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

  // Reads one image file into the same shape ImageUploader.jsx produces
  // (base64 without the data: prefix, natural dimensions via Image()), plus
  // its fileName so DeepSeek's text-only extraction can reference it by name.
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      var issvg = file.type === "image/svg+xml"
      var reader = new FileReader()
      reader.onload = function (ev) {
        var result = ev.target.result
        var img = new Image()
        img.onload = function () {
          resolve({ fileName: file.name, imageData: result.split(",")[1], imageType: issvg ? "svg" : "png", imgNatW: img.naturalWidth, imgNatH: img.naturalHeight })
        }
        img.onerror = reject
        img.src = result
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleCsvImages(e) {
    var files = Array.from(e.target.files || [])
    if (files.length === 0) return
    var read = await Promise.all(files.map(readImageFile))
    setCsvImages((prev) => [...prev, ...read])
    e.target.value = ""
  }

  async function handleCsvUpload(e) {
    var f = e.target.files[0]
    if (!f) return
    setCsvImporting(true)
    setCsvError(null)
    setCsvImageNote(null)
    try {
      var text = await readFileText(f)
      var result = await importGarmentCSV(text, { garment, lang: "ES", tecs: tl.tecs, imageFileNames: csvImages.map((i) => i.fileName) })
      setParts(result.parts)
      if (result.designs.length > 0) {
        var matched = matchImagesToDesigns(result.designs, csvImages)
        setDesigns(matched.designs.map((d) => Object.assign(newDesign(), d)))
        if (matched.unmatchedImages.length > 0) {
          setCsvImageNote(matched.unmatchedImages.length + " imagen(es) no se pudieron emparejar automaticamente - agregalas a mano en el paso Disenos.")
        }
      }
      setCsvImages([])

      // F2: does this CSV actually cover what a tech pack for this garment
      // needs? Reuses the same reasoning core (F3) the custom-garment chat
      // and vision intake already share - if it finds genuine gaps, the gate
      // chat below asks exactly those before letting the user move on; if
      // not, this is a no-op and the flow stays exactly as direct as before.
      try {
        var seed = csvSeedToRequirementsSeed(result)
        var reqs = await analyzeRequirements({ garmentType: garment.label.ES, seed, tecs: tl.tecs, lang: "ES" })
        if (pendingFields(reqs, "general").length > 0) {
          setCsvVerifySeed({ garmentType: garment.label.ES, seed })
          setCsvVerifying(true)
        }
      } catch {
        // A failed verification check shouldn't undo a successful import -
        // degrade quietly, same as the CSV already worked without this gate.
      }
    } catch (err) {
      setCsvError(err instanceof DeepSeekError ? err.message : "No se pudo leer o interpretar el CSV.")
    } finally {
      setCsvImporting(false)
      e.target.value = ""
    }
  }

  // F2 gate completion: fold the answers for whatever the CSV didn't cover
  // back in as extra, editable part rows - same shape "Agregar Pieza" already
  // produces, so no fuzzy re-matching against the garment's canonical part
  // ids is needed, and the data stays visible/removable like any other row.
  function handleCsvVerificationComplete(draft) {
    var extra = (draft.parts || []).map((p) => ({ id: uid(), val: p.val, on: true, customName: p.label }))
    setParts((prev) => [...prev, ...extra])
    setCsvVerifying(false)
    setCsvVerifySeed(null)
  }

  function downloadCsvTemplate() {
    var csv = buildExampleCSV(garment, "ES")
    var uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv)
    var a = document.createElement("a")
    a.href = uri
    a.download = "ejemplo-" + garment.id + ".csv"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function ensureTx(lang) {
    if (lang === "ES" || txCache[lang]) return txCache[lang] || null
    setTranslating(true)
    var tx = await translateContent(hdr, parts, designs, lang)
    setTxCache((p) => Object.assign({}, p, { [lang]: tx }))
    setTranslating(false)
    return tx
  }

  function fallbackPageLayout(page) {
    return {
      ...page,
      regions: [
        { type: "header", weight: 10 },
        { type: "titleBar", weight: 6 },
        { type: "illustration", weight: 48, slots: 2, note: "Preparar ilustracion tecnica de esta pagina." },
        { type: "partsList", weight: 26 },
        { type: "disclaimer", weight: 10 },
      ],
    }
  }

  async function buildCustomDocumentPages(lang, tx) {
    var garmentType = garment && garment.label ? garment.label[lang] || garment.label.ES : "Custom garment"
    setDocumentPlanning(true)
    setDocumentPlanStatus("Estructurando el documento...")
    try {
      var outline = await planDocumentOutline({ garmentType, parts, designs, lang })
      var plannedPages = []
      for (var i = 0; i < outline.pages.length; i++) {
        var page = outline.pages[i]
        setDocumentPlanStatus("Desarrollando pagina " + (i + 1) + " de " + outline.pages.length + "...")
        try {
          var planned = await planPageLayout(
            page,
            { garmentType, parts, designs, lang },
            {
              onProgress: (progress) => {
                setDocumentPlanStatus("Desarrollando pagina " + (i + 1) + " de " + outline.pages.length + (progress.lastLabel ? ": " + progress.lastLabel : "..."))
              },
            }
          )
          plannedPages.push(planned)
        } catch {
          plannedPages.push(fallbackPageLayout(page))
        }
      }
      return buildPlannedPages({ pages: plannedPages }, { lang, hdr, parts, designs, logo, txData: tx, garment })
    } finally {
      setDocumentPlanning(false)
      setDocumentPlanStatus("")
    }
  }

  async function handleGenerate(lang) {
    var tx = await ensureTx(lang)
    var pages
    if (garmentId === "custom" && customGarment) {
      try {
        pages = await buildCustomDocumentPages(lang, tx)
      } catch {
        pages = buildAllPages(lang, hdr, parts, designs, logo, tx, garment)
      }
    } else {
      pages = buildAllPages(lang, hdr, parts, designs, logo, tx, garment)
    }
    setSvgPages(pages)
  }

  function canNext() {
    if (step === 0) return !!garmentId && !visionExtracting
    if (step === 1) return langs.length > 0
    if (step === 2) return hdr.brand.trim() && hdr.pname.trim()
    if (step === 3 && garmentId === "custom") return !!customGarment // chat must finish first
    if (step === 3 && csvVerifying) return false // F2 gate: answer what the CSV didn't cover first
    return true
  }

  // A selectable chip (garment / language), flat with an ink keyline; selected
  // gets a blue keyline + a blue check icon (role.priority).
  function Chip({ selected, onClick, iconName, children }) {
    return (
      <label
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: space(2),
          padding: `${space(3)}px ${space(4)}px`,
          border: `${selected ? 2 : 1}px solid ${selected ? role.priority.fill : C.ink.hex}`,
          background: C.white.hex,
          color: C.ink.hex,
          cursor: "pointer",
          fontFamily: type.fonts.ui,
          fontSize: type.size.base,
          fontWeight: selected ? 700 : 500,
        }}
      >
        {iconName && <Icon name={iconName} size={20} />}
        {children}
        {selected && <Icon name="check" size={18} color={role.priority.fill} />}
      </label>
    )
  }

  function stepHelp(text) {
    return <p style={{ color: C.ink.hex, opacity: 0.7, margin: `0 0 ${space(4)}px`, fontSize: type.size.base, fontFamily: type.fonts.ui }}>{text}</p>
  }

  function renderStep() {
    if (step === 0)
      return (
        <div>
          {stepHelp(tl.garmentStep)}
          <div style={{ display: "flex", gap: space(3), flexWrap: "wrap" }}>
            {GARMENT_LIST.map((g) => (
              <Chip key={g.id} selected={garmentId === g.id} onClick={() => selectGarment(g.id)} iconName={g.icon}>
                {g.label.ES}
              </Chip>
            ))}
            <Chip selected={garmentId === "custom" && !visionEntry} onClick={() => selectGarment("custom")} iconName="auto_awesome">
              Prenda nueva (con IA)
            </Chip>
            <Chip selected={garmentId === "custom" && visionEntry} onClick={() => selectGarment("custom", { vision: true })} iconName="photo_camera">
              Prenda desde foto (IA)
            </Chip>
          </div>
          {garmentId === "custom" && !visionEntry && (
            <p style={{ marginTop: space(3), fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, maxWidth: 480 }}>
              Vas a charlar con la IA en el paso "Piezas" para armar esta prenda desde cero — no tiene el dibujo de silueta a mano de las prendas ya registradas, pero la tabla de piezas y el resto de la ficha funcionan igual.
            </p>
          )}
          {garmentId === "custom" && visionEntry && (
            <div style={{ marginTop: space(3), maxWidth: 480, display: "flex", flexDirection: "column", gap: space(2) }}>
              <p style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, margin: 0 }}>
                Subí una o mas fotos de la prenda real. La IA identifica el tipo de prenda y lo que se ve con claridad (color, cuello, cierre, etc.); en el paso "Piezas" solo te va a preguntar lo que la foto no reveló.
              </p>
              <label style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: C.white.hex, border: `1px dashed ${C.ink.hex}`, cursor: visionExtracting ? "wait" : "pointer", fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon name="add_photo_alternate" size={18} />
                {visionExtracting ? "Analizando foto(s)…" : visionSeed ? "Cambiar foto(s)" : "Subir foto(s)"}
                <input type="file" accept="image/png,image/jpeg" multiple disabled={visionExtracting} onChange={handleVisionUpload} style={{ display: "none" }} />
              </label>
              {visionError && (
                <p style={{ fontSize: type.size.xs, color: role.index.fill, margin: 0 }}>
                  <Icon name="error" size={14} color={role.index.fill} /> {visionError}
                </p>
              )}
              {visionSeed && (
                <div style={{ border: hair, padding: space(3), fontSize: type.size.xs, color: C.ink.hex }}>
                  <div style={{ fontWeight: 700, marginBottom: space(1) }}>Detectado: {visionSeed.garmentType || "(no identificado)"}</div>
                  {Object.keys(visionSeed.seed || {}).length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: space(4) }}>
                      {Object.entries(visionSeed.seed).map(([k, v]) => (
                        <li key={k}>
                          {k}: {v}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ opacity: 0.7 }}>No se detectaron atributos con certeza - se preguntará todo en "Piezas".</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )

    if (step === 1)
      return (
        <div>
          {stepHelp(tl.langStep)}
          <div style={{ display: "flex", gap: space(3), flexWrap: "wrap" }}>
            {[{ c: "ES", l: "Espanol" }, { c: "EN", l: "English" }, { c: "ZH", l: "Zhongwen" }].map((item) => (
              <Chip key={item.c} selected={langs.includes(item.c)} onClick={() => toggleLang(item.c)}>
                {item.l}
              </Chip>
            ))}
          </div>
        </div>
      )

    if (step === 2) {
      const reqEmpty = (k) => !hdr[k].trim()
      const RequiredLabel = ({ text, field }) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: space(1) }}>
          {text}
          {reqEmpty(field) && (
            <span title="Requerido" style={{ width: space(2), height: space(2), background: role.highlight.fill, boxShadow: `0 0 0 1px ${role.highlight.keyline}` }} />
          )}
        </span>
      )
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: space(4) }}>
          <Fld lbl="Logo de la Marca">
            <div style={{ display: "flex", alignItems: "center", gap: space(3), flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: C.white.hex, border: `1px dashed ${logo ? role.priority.fill : C.ink.hex}`, cursor: "pointer", fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon name="upload_file" size={18} />
                {logo ? "Cambiar logo" : "Subir imagen (PNG, JPG, SVG)"}
                <input type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} />
              </label>
              {logo && <img src={logo} style={{ height: 46, maxWidth: 100, objectFit: "contain", border: hair, padding: 4 }} alt="logo" />}
              {logo && (
                <button onClick={() => setLogo(null)} style={iconBtn(role.index.fill)} title="Quitar">
                  <Icon name="delete" size={20} color={role.index.fill} />
                </button>
              )}
            </div>
          </Fld>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space(4) }}>
            {[["Marca", "brand", "Ej: New Era", true], ["Temporada", "season", "Ej: 2027 SS/FW"], ["Codigo", "sno", "Ej: 2ACP002"], ["Tela", "fab", "Ej: 100% Poliester"], ["Fabrica", "fac", "Ej: Colombia"], ["Fecha Entrada", "ind", "18/10/2027"], ["Fecha Salida", "outd", "20/11/2027"]].map((row) => (
              <Fld key={row[1]} lbl={row[3] ? <RequiredLabel text={row[0]} field={row[1]} /> : row[0]}>
                <Inp v={hdr[row[1]]} ch={(v) => setHdr((p) => Object.assign({}, p, { [row[1]]: v }))} ph={row[2]} />
              </Fld>
            ))}
            <Fld lbl="Categoria">
              <Sel v={hdr.cat} ch={(v) => setHdr((p) => Object.assign({}, p, { cat: v }))} opts={tl.cats} />
            </Fld>
            <Fld lbl={<RequiredLabel text="Nombre del Producto" field="pname" />} span={2}>
              <Inp v={hdr.pname} ch={(v) => setHdr((p) => Object.assign({}, p, { pname: v }))} ph="Ej: Gorra New Era 59FIFTY Los Angeles" />
            </Fld>
          </div>
        </div>
      )
    }

    if (step === 3 && garmentId === "custom") {
      return <GarmentChat onComplete={handleGarmentChatComplete} tecs={tl.tecs} seed={visionSeed ? visionSeed.seed : undefined} initialGarmentType={visionSeed ? visionSeed.garmentType : undefined} />
    }

    if (step === 3 && csvVerifying) {
      return (
        <div>
          <p style={{ marginBottom: space(3), fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, maxWidth: 480 }}>
            El CSV no cubre todo lo que esta ficha necesita — respondé lo que falta y despues seguís editando la tabla de piezas como siempre.
          </p>
          <GarmentChat generalOnly onComplete={handleCsvVerificationComplete} tecs={tl.tecs} seed={csvVerifySeed.seed} initialGarmentType={csvVerifySeed.garmentType} />
        </div>
      )
    }

    if (step === 3) {
      const pn = garment.partLabels.ES
      let idx = 0
      return (
        <div>
          <div style={{ marginBottom: space(4), padding: space(3), border: `1px dashed ${role.priority.fill}`, background: C.white.hex }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space(3), flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: type.size.sm, fontWeight: 700, fontFamily: type.fonts.ui, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>Importar desde CSV (opcional)</div>
                <div style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, marginTop: 2, maxWidth: 480 }}>
                  Subí un CSV con las piezas (y de paso los diseños, si los incluís) — la IA lo interpreta, no hace falta que el formato sea exacto.
                </div>
              </div>
              <div style={{ display: "flex", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={downloadCsvTemplate} style={secondaryBtnStyle}>
                  <Icon name="description" size={16} /> Ver ejemplo
                </button>
                <label style={secondaryBtnStyle}>
                  <Icon name="add_photo_alternate" size={16} /> {csvImages.length > 0 ? csvImages.length + " foto(s)" : "Subir fotos (opcional)"}
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" multiple onChange={handleCsvImages} style={{ display: "none" }} />
                </label>
                <label style={{ ...primaryBtnStyle(true), cursor: csvImporting ? "wait" : "pointer", opacity: csvImporting ? 0.6 : 1 }}>
                  <Icon name="upload_file" size={16} color={C.white.hex} /> {csvImporting ? "Analizando..." : "Subir CSV"}
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} disabled={csvImporting} style={{ display: "none" }} />
                </label>
              </div>
            </div>
            {csvError && (
              <div style={{ marginTop: space(2), display: "flex", alignItems: "center", gap: space(2), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>
                <Icon name="error" size={16} color={role.index.fill} /> {csvError}
              </div>
            )}
            {csvImageNote && (
              <div style={{ marginTop: space(2), display: "flex", alignItems: "center", gap: space(2), fontSize: type.size.xs, color: C.ink.hex, opacity: 0.75 }}>
                <Icon name="info" size={16} /> {csvImageNote}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: space(1), border: hair }}>
            {parts.map((p) => {
              var nm = p.customName || pn[p.id] || "P" + p.id
              const n = p.on ? ++idx : null
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: space(2), padding: space(2), borderBottom: `1px solid #E6E8EC`, background: C.white.hex, opacity: p.on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={p.on} onChange={() => updPart(p.id, "on", !p.on)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: role.priority.fill, flexShrink: 0 }} />
                  <span style={{ width: space(6), flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>
                    {n && <IndexChip n={n} />}
                  </span>
                  <span style={{ width: 132, fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, flexShrink: 0, fontFamily: type.fonts.ui }}>{nm}</span>
                  <input value={p.val} onChange={(e) => updPart(p.id, "val", e.target.value)} style={{ flex: 1, padding: `${space(1)}px ${space(2)}px`, border: hair, fontSize: type.size.sm, outline: "none", background: C.white.hex, fontFamily: type.fonts.ui }} />
                  {p.customName && (
                    <button onClick={() => setParts((prev) => prev.filter((x) => x.id !== p.id))} style={iconBtn(role.index.fill)} title="Quitar">
                      <Icon name="delete" size={18} color={role.index.fill} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <button onClick={() => setParts((p) => [...p, { id: uid(), val: "", on: true, customName: "Pieza personalizada" }])} style={dashedActionStyle}>
            <Icon name="add" size={16} color={role.priority.fill} /> Agregar Pieza
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
              <div key={d.id} style={{ marginBottom: space(4), border: hair, background: C.white.hex }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${space(2)}px ${space(3)}px`, background: role.priority.fill, color: role.priority.on }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space(2), fontSize: type.size.base, fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <IndexChip n={i + 1} /> {d.name}
                  </span>
                  <button onClick={() => setDesigns((p) => p.filter((x) => x.id !== d.id))} style={iconBtn(C.white.hex)} title="Quitar diseño">
                    <Icon name="close" size={20} color={C.white.hex} />
                  </button>
                </div>
                <div style={{ padding: space(3) }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space(3) }}>
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
                        <Inp v={d.w || ""} ch={(v) => updDesign(d.id, "w", v)} ph="Ej: 111.6" mono={true} />
                      </Fld>
                    )}
                    {!isWhole && (
                      <Fld lbl="Alto (mm)">
                        <Inp v={d.h || ""} ch={(v) => updDesign(d.id, "h", v)} ph="Ej: 59.1" mono={true} />
                      </Fld>
                    )}
                    {isWhole && (
                      <div style={{ gridColumn: "span 2", display: "inline-flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(3)}px`, background: C.white.hex, border: `1px solid ${role.highlight.keyline}`, borderLeft: `${space(1)}px solid ${role.highlight.fill}`, fontSize: type.size.sm, color: C.ink.hex }}>
                        <Icon name="info" size={18} /> Diseño cubre toda la prenda — medidas no aplican.
                      </div>
                    )}
                    <Fld lbl="Nombre del Archivo">
                      <Inp v={d.fileName || ""} ch={(v) => updDesign(d.id, "fileName", v)} ph="Ej: SUNNER_HAWAII_LOGO_v3.ai" mono={true} />
                    </Fld>
                    <Fld lbl="Enlace Drive">
                      <Inp v={d.driveLink || ""} ch={(v) => updDesign(d.id, "driveLink", v)} ph="Ej: drive.google.com/..." mono={true} />
                    </Fld>
                  </div>
                  <div style={{ marginTop: space(3) }}>
                    <Fld lbl="Colores (selector + nombre Pantone)">
                      <ColorsEditor colors={d.colors || []} onChange={(c) => updDesign(d.id, "colors", c)} />
                    </Fld>
                  </div>
                  <div style={{ marginTop: space(3) }}>
                    <Fld lbl="Imagen del diseno (PNG o SVG - se muestra con cotas)">
                      <ImageUploader d={d} onUpdate={(obj) => updDesignMulti(d.id, obj)} />
                    </Fld>
                  </div>
                  {isEmb && <EmbForm emb={d.emb || Object.assign({}, EMPTY_EMB, { stopSeq: [] })} onChange={(emb) => updDesign(d.id, "emb", emb)} />}
                </div>
              </div>
            )
          })}
          <button onClick={() => setDesigns((p) => [...p, Object.assign(newDesign(), { pos: positions[0] })])} style={dashedActionStyle}>
            <Icon name="add" size={16} color={role.priority.fill} /> Agregar Diseño
          </button>
        </div>
      )
    }

    if (step === 5) {
      var allPgs = [{ l: "Pag. Principal", i: 0 }, ...designs.map((d, i) => ({ l: "Diseno " + (i + 1), i: i + 1 }))]
      const miniBtn = (active, activeColor) => ({
        padding: `${space(1)}px ${space(2)}px`,
        background: active ? activeColor : C.white.hex,
        color: active ? C.white.hex : C.ink.hex,
        border: hair,
        fontSize: type.size.xs,
        fontFamily: type.fonts.ui,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
      })
      return (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space(3), flexWrap: "wrap", gap: space(2) }}>
            <div style={{ display: "flex", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, marginRight: space(1), textTransform: "uppercase", letterSpacing: "0.08em" }}>Vista</span>
              {allPgs.map((p) => (
                <button key={p.i} onClick={() => { setPrevPage(p.i); ensureTx(prevLang) }} style={miniBtn(prevPage === p.i, role.priority.fill)}>
                  {p.l}
                </button>
              ))}
              <span style={{ width: 1, alignSelf: "stretch", background: C.ink.hex, margin: `0 ${space(1)}px` }} />
              {langs.map((l) => (
                <button key={l} onClick={() => { setPrevLang(l); ensureTx(l) }} style={miniBtn(prevLang === l, C.ink.hex)}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
              {translating && <span style={{ fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>Traduciendo…</span>}
              {documentPlanning && <span style={{ fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>{documentPlanStatus || "Disenando documento..."}</span>}
              {garmentId === "custom" && customGarment && (
                <button
                  onClick={() => downloadGarmentFile(customGarment)}
                  title="Descarga un archivo .js de partida para contribuir esta prenda al repo - ver CONTRIBUTING.md"
                  style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: C.white.hex, color: C.ink.hex, border: hair, fontSize: type.size.xs, cursor: "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}
                >
                  <Icon name="download" size={16} color={C.ink.hex} /> Descargar prenda (.js)
                </button>
              )}
              {langs.map((l) => (
                <button key={l} onClick={() => handleGenerate(l)} disabled={documentPlanning} style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: documentPlanning ? C.canvas.hex : role.priority.fill, color: documentPlanning ? "#9AA0AB" : role.priority.on, border: hair, borderColor: documentPlanning ? "#C6CAD2" : role.priority.fill, fontSize: type.size.xs, cursor: documentPlanning ? "wait" : "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Icon name="bolt" size={16} color={C.white.hex} /> Generar SVG [{l}]
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
    <div style={{ minHeight: "100vh", background: C.shell.hex, display: "flex", flexDirection: "column", alignItems: "center", padding: `${space(6)}px 4%`, fontFamily: type.fonts.ui, color: C.white.hex }}>
      {svgPages && <SvgModal pages={svgPages} onClose={() => setSvgPages(null)} />}
      <div style={{ width: "100%", maxWidth: 960, marginBottom: space(3) }}>
        {/* Wordmark — Morfe mark in white on the black shell */}
        <div style={{ display: "flex", alignItems: "center", gap: space(3), marginBottom: space(3) }}>
          <MorfeLogo size={44} color={C.white.hex} />
          <div>
            <h1 style={{ margin: 0, fontSize: type.size.lg, fontFamily: type.fonts.display, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase", color: C.white.hex }}>TechPack AI Builder</h1>
            <p style={{ margin: 0, fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.white.hex, opacity: 0.55 }}>por Morfe · Generador Open Source de Fichas Técnicas · v0.2</p>
          </div>
        </div>
        {/* Stepper — red index numbers (enumeration seen first), blue underline = active */}
        <div style={{ display: "flex", border: hair, background: C.white.hex }}>
          {tl.steps.map((s, i) => {
            const active = i === step
            const done = i < step
            return (
              <div
                key={i}
                onClick={() => { if (done) setStep(i) }}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space(2),
                  padding: `${space(2)}px ${space(1)}px`,
                  borderRight: i < tl.steps.length - 1 ? hair : "none",
                  borderBottom: active ? `${space(1)}px solid ${role.priority.fill}` : `${space(1)}px solid transparent`,
                  background: C.white.hex,
                  color: C.ink.hex,
                  opacity: active || done ? 1 : 0.4,
                  cursor: done ? "pointer" : "default",
                }}
              >
                <IndexChip n={i + 1} active={active} />
                <span style={{ fontSize: type.size.xs, fontWeight: active ? 700 : 500, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{s}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Document panel */}
      <div style={{ width: "100%", maxWidth: 960, background: C.white.hex, border: hair }}>
        {/* Step title bar — blue block, white text + icon (role.priority) */}
        <div style={{ display: "flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: role.priority.fill, color: role.priority.on }}>
          <Icon name={STEP_ICONS[step]} size={22} color={C.white.hex} />
          <h2 style={{ margin: 0, fontSize: type.size.md, fontFamily: type.fonts.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em" }}>{tl.steps[step]}</h2>
        </div>
        <div style={{ padding: space(5), maxHeight: "64vh", overflowY: "auto" }}>{renderStep()}</div>
        {/* Nav */}
        <div style={{ padding: `${space(3)}px ${space(4)}px`, borderTop: hair, display: "flex", justifyContent: "space-between", background: C.white.hex }}>
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ ...secondaryBtnStyle, opacity: step === 0 ? 0.4 : 1, cursor: step === 0 ? "not-allowed" : "pointer" }}>
            <Icon name="arrow_back" size={18} /> {tl.bk}
          </button>
          {step < 5 ? (
            <button onClick={() => { if (canNext()) setStep((s) => s + 1) }} disabled={!canNext()} style={primaryBtnStyle(canNext())}>
              {step === 4 ? tl.gen : tl.nxt} <Icon name="arrow_forward" size={18} color={canNext() ? C.white.hex : "#9AA0AB"} />
            </button>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: space(2), fontSize: type.size.sm, color: C.ink.hex, opacity: 0.7, alignSelf: "center" }}>
              <Icon name="bolt" size={18} /> Genera el SVG por idioma arriba
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
