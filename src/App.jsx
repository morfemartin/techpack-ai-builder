import { useEffect, useRef, useState } from "react"
import { uid } from "./core/idGen.js"
import { T, UI, uiPhotosCount, uiSearchReferences, uiDevelopingPage, uiDocumentSectionsReady, uiAssigningDocumentBatch, uiResolvingBlock, uiApplyingRevision, uiPagesUsedFallback, uiPageDesignFailed, uiPlanContractAssisted, uiPlanFailed, uiPageUsedFallback, uiSinkOverflow } from "./core/i18n.js"
import { EMPTY_EMB, isEmbTec, isWholePosF, readDesignImageFile } from "./core/helpers.js"
import { DEFAULT_UNIT, UNITS, formatDimensions, normalizeUnit } from "./core/units.js"
import { buildTranslationPayload, combineTranslations, translateContent } from "./core/translate.js"
import { buildLocalizedSnapshot } from "./core/localizedSnapshot.js"
import { languageLabel, sortedTextileLanguages, toggleFactoryLanguage } from "./core/languageConfig.js"
import { importGarmentCSV, readFileText, buildExampleCSV, matchImagesToDesigns, csvSeedToRequirementsSeed, extractSeedFromDocument } from "./core/csvImport.js"
import { DeepSeekError, getLocalAIHealth, getTextAIProvider } from "./core/deepseekClient.js"
import { localProviderLabel } from "./core/hybridAI.js"
import { splitImageIntoQuadrants, extractGarmentFromImages } from "./core/visionExtract.js"
import { toGrayscale, hexToGray } from "./core/colorUtils.js"
import { hasColorData, madeiraColorsToStops, normalizeFabricColor } from "./core/colorSpecs.js"
import { newColorway, normalizeColorway, colorwaysFromFabricColors, renderColorwayDocument } from "./core/colorways.js"
import { buildDeterministicCustomDocument } from "./core/deterministicDocument.js"
import { newSizeChart, normalizeSizeChart, hasSizeChartData, seedSizesFromParts } from "./core/sizeChart.js"
import { SizeChartEditor } from "./components/SizeChartEditor.jsx"
import { analyzeRequirements, pendingFields } from "./core/techpackRequirements.js"
import { buildAllPages, renderSizeChart } from "./pages/buildPages.js"
import { sizeChartTableLayout } from "./pages/tableMetrics.js"
import { buildPlannedPages } from "./pages/interpretPlan.js"
import { repairPage } from "./pages/pageContracts.js"
import { fallbackDocumentOutline, planDocumentOutline, planPageLayout, withPlanningTimeout } from "./core/documentPlan.js"
import { GARMENTS, GARMENT_LIST } from "./garments/index.js"
import { buildCustomGarment, mapChatDesignsToDesigns } from "./garments/buildCustomGarment.js"
import { downloadGarmentFile } from "./garments/exportGarment.js"
import { Inp, Sel, Fld } from "./components/FormControls.jsx"
import { ColorsEditor } from "./components/ColorsEditor.jsx"
import { ColorwaysEditor } from "./components/ColorwaysEditor.jsx"
import { ImageUploader } from "./components/ImageUploader.jsx"
import { EmbForm } from "./components/EmbForm.jsx"
import { SvgModal } from "./components/SvgModal.jsx"
import { Preview } from "./components/Preview.jsx"
import { GarmentChat } from "./components/GarmentChat.jsx"
import { ReviewChat } from "./components/ReviewChat.jsx"
import { buildReviewFindings } from "./core/reviewDiff.js"
import { applyReviewAnswers } from "./core/applyReviewAnswers.js"
import { Icon } from "./components/Icon.jsx"
import { MorfeLogo } from "./components/MorfeLogo.jsx"
import { getPaletteNames, palette, role, setPalette, setCustomColor, CUSTOM_EDITABLE_KEYS, type, space } from "./design/tokens.js"
import { GRID, PAGE } from "./design/metrics.js"
import { deterministicPageLayout, withPartLabels, auditSinkOverflow } from "./core/semanticOutline.js"

// Material Symbols per wizard step (no emojis). Order matches T.*.steps.
const STEP_ICONS = ["checkroom", "translate", "badge", "widgets", "brush", "visibility", "straighten"]

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

// Turns a caught AI-call error into one short, honest phrase for a warning
// message - status/contract-violation/network detail instead of a bare
// "falló la IA" that discards the actual reason. Used by
// buildCustomDocumentPages's two catch blocks (outline + per-page layout).
function describeAIError(error) {
  if (!error) return ""
  if (error.contractViolation) return "el modelo no cumplio el contrato de la tarea"
  if (typeof error.status === "number") return "HTTP " + error.status + (error.detail ? ": " + error.detail : "")
  if (error.networkError) return "fallo de red"
  return String((error && error.message) || error).slice(0, 140)
}

// The 0-255 gray colorUtils.js's toGrayscale() actually prints for this hex -
// hexToGray() returns a "#rrggbb" gray string (R=G=B), so this just reads the
// number back out for display next to a swatch.
function grayValueOf(hex) {
  return parseInt(hexToGray(hex).slice(1, 3), 16)
}

function newDesign() {
  return {
    // `unit` is the unit w/h were TYPED in - not what the sheet prints (that
    // is the document-level dimensionUnit, converted at print time).
    id: uid(), name: "Nuevo Diseno", pos: "", posDetail: "", w: "", h: "", unit: DEFAULT_UNIT, tec: "Bordado 3D",
    colors: [], fileName: "", driveLink: "", imageData: null, imageType: null, imgNatW: null, imgNatH: null,
    illustrationBrief: "",
    emb: Object.assign({}, EMPTY_EMB, { stopSeq: [] }),
  }
}

export default function App() {
  const [textAIProvider] = useState(() => getTextAIProvider())
  const [localAIStatus, setLocalAIStatus] = useState(textAIProvider === "local" ? "starting" : "cloud")
  const [localAIModel, setLocalAIModel] = useState("")
  const [step, setStep] = useState(0)
  const [garmentId, setGarmentId] = useState("cap")
  const [factoryLanguages, setFactoryLanguages] = useState(["ES"])
  const [designerLanguage, setDesignerLanguage] = useState("ES")
  const [outputMode, setOutputMode] = useState("separate")
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
  // `colorways` replaces the old flat `fabricColors` array - N named
  // versions (Fair Green / Silver Lake Blue), each with its own swatches and
  // optional per-design thread overrides (colorways.js). `fabricColors`
  // below is DERIVED from colorways[0] so every one of the ~15 existing
  // consumers (translate.js, the outline planner, buildAllPages, the design
  // preview, ...) keeps working on the base colorway completely unchanged -
  // only the export path (generateResolvedDocument/finishReview) and the
  // editor UI need to know about `colorways` at all.
  const [colorways, setColorways] = useState(() => [newColorway({})])
  const fabricColors = colorways[0].fabricColors
  function setFabricColors(next) {
    setColorways((cws) => {
      const nextColors = typeof next === "function" ? next(cws[0].fabricColors) : next
      return [{ ...cws[0], fabricColors: nextColors }, ...cws.slice(1)]
    })
  }
  // Empty by default (no POMs) - hasSizeChartData() is false, so every
  // contract/layout gate this feature touches falls through to its
  // pre-existing behavior until the user actually fills in a measurement.
  const [sizeChart, setSizeChart] = useState(() => newSizeChart({}))
  // The document only ever replans against THIS copy, not the live
  // `sizeChart` the Tallaje step edits keystroke by keystroke - otherwise
  // every character typed into a POM cell would trigger a full outline
  // replan (real AI calls). Committed the moment the user LEAVES the
  // Tallaje step (see the effect below) - by "Aplicar al documento", the
  // Atras button, or even the stepper chip, all three just change `step`.
  const [committedSizeChart, setCommittedSizeChart] = useState(() => newSizeChart({}))
  // Leaving step 6 (Tallaje), by whatever path, commits the chart exactly
  // once - keyed on `step` itself so it fires on the transition, not on
  // every sizeChart edit while still on the step. Harmless when nothing
  // changed: committedSizeChart already holds this value, so previewPlanKey
  // does not change and no replan fires.
  useEffect(() => {
    if (step !== 6) setCommittedSizeChart(sizeChart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])
  // Arriving at Tallaje: seed sizes/baseSize from whatever the user already
  // answered ("Rango de talles" in the chat, or a registered garment's own
  // "Tallas" part row). `parts` itself only carries {id, val, on} - the
  // label lives separately in garment.partLabels, so it has to be joined in
  // here (same pattern the render code already uses via `pn[p.id]`) before
  // seedSizesFromParts has anything to match against. A safe no-op once the
  // chart stops being pristine, so firing this on every arrival is fine.
  useEffect(() => {
    if (step === 6 && garment) {
      const labels = (garment.partLabels && garment.partLabels.ES) || {}
      const labeledParts = parts.map((p) => ({ label: p.customName || labels[p.id] || "", val: p.val }))
      setSizeChart((chart) => seedSizesFromParts(chart, labeledParts))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])
  const [designs, setDesigns] = useState(() => [
    Object.assign(newDesign(), { name: "Logo Frontal", pos: GARMENTS.cap.positions.ES[3] || GARMENTS.cap.positions.ES[0], posDetail: "Centrado", colors: [{ name: "PANTONE 286 C", hex: "#003DA5" }, { name: "PANTONE White", hex: "#FFFFFF" }] }),
  ])
  const [logo, setLogo] = useState(null)
  const [prevLang, setPrevLang] = useState("ES")
  const [prevPage, setPrevPage] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [translationProgress, setTranslationProgress] = useState(null)
  const [translationError, setTranslationError] = useState(null)
  const translationRuns = useRef(0)
  const translationGeneration = useRef(0)
  const translationPromises = useRef(new Map())
  const translationControllers = useRef(new Map())
  const [translationRevision, setTranslationRevision] = useState(0)
  // The in-flight live-preview planning run, so a new one can cancel it (see
  // the preview effect) instead of leaving two runs racing for the same
  // runHybridAI task slot.
  const previewRunRef = useRef(null)
  const [txCache, setTxCache] = useState({})
  const [svgPages, setSvgPages] = useState(null)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvError, setCsvError] = useState(null)
  const [csvImages, setCsvImages] = useState([])
  const [csvImageNote, setCsvImageNote] = useState(null)
  const [visionEntry, setVisionEntry] = useState(false) // true once "Prenda desde foto" is chosen at step 0
  const [visionExtracting, setVisionExtracting] = useState(false)
  const [visionError, setVisionError] = useState(null)
  const [visionProgress, setVisionProgress] = useState(null)
  // Passes/photos the extraction skipped after a failure (extractGarmentFromImages's
  // warnings[] - visionExtract.js) - shown so a thinner seed is explained
  // instead of silently discovered later as "why didn't it catch the collar".
  const [visionWarnings, setVisionWarnings] = useState([])
  const [visionSeed, setVisionSeed] = useState(null) // { garmentType, seed } | null - feeds GarmentChat at the Piezas step
  // Same idea as visionSeed, for a person whose workflow already has most of
  // the data written down (a CSV or a Markdown/plain-text spec sheet) -
  // "muchas veces ya tengo gran parte de los datos recopilados". Feeds the
  // exact same GarmentChat props visionSeed does, so the chat opens straight
  // into analysis with this seed instead of a blank naming phase, and only
  // asks about whatever the document genuinely didn't cover.
  const [docExtracting, setDocExtracting] = useState(false)
  const [docError, setDocError] = useState(null)
  const [docSeed, setDocSeed] = useState(null) // { garmentType, seed } | null
  const [csvVerifying, setCsvVerifying] = useState(false) // true while the post-CSV gate chat is up
  const [csvVerifySeed, setCsvVerifySeed] = useState(null) // { garmentType, seed } for that gate chat
  // The unit the printed tech pack uses. Per-design `unit` records what was
  // TYPED; this is what the factory reads. Conversion happens at print time.
  const [dimensionUnit, setDimensionUnit] = useState(DEFAULT_UNIT)
  const [documentPlanning, setDocumentPlanning] = useState(false)
  const [documentPlanStatus, setDocumentPlanStatus] = useState("")
  // AI planning failures used to degrade to the deterministic outline/layout
  // with nothing telling the user - the document still came out fine, but
  // silently poorer (less deliberate block choices) with no way to know that
  // happened short of noticing the difference themselves.
  const [documentPlanWarnings, setDocumentPlanWarnings] = useState([])
  // Positive "it is actually finished" signal. Without it the only cue was the
  // progress text disappearing, which is indistinguishable from it never
  // having started - and the preview already looks like a document while it is
  // still being built.
  const [documentReady, setDocumentReady] = useState(false)
  const [plannedPreviewPages, setPlannedPreviewPages] = useState(null)
  const [plannedPreviewKey, setPlannedPreviewKey] = useState("")
  const [plannedPreviewError, setPlannedPreviewError] = useState(null)
  const [monoMode, setMonoMode] = useState(false) // grayscale toggle - render-time only, never re-triggers AI planning
  const [viewAllPages, setViewAllPages] = useState(false) // "see every page at once" contact sheet
  const [reviewFindings, setReviewFindings] = useState(null) // problems from the pre-download intent-vs-document diff
  const [pendingReview, setPendingReview] = useState(null) // {pages, plan, lang, tx, garmentType} held behind the review gate
  // The APP's OWN chrome language - also the source language Mistral authors
  // from before producing the independent factory/designer translations.
  // document's languages, picked in the wizard's own "Idioma" step). Persisted
  // so the choice survives a reload; a builder working in English shouldn't
  // have to re-pick it every session.
  const [uiLang, setUiLang] = useState(() => {
    try { return localStorage.getItem("techpack.uiLang") === "EN" ? "EN" : "ES" } catch { return "ES" }
  })
  useEffect(() => {
    try { localStorage.setItem("techpack.uiLang", uiLang) } catch {}
  }, [uiLang])
  const sourceLanguage = uiLang
  useEffect(() => {
    translationGeneration.current += 1
    translationControllers.current.forEach((controller) => controller.abort())
    translationControllers.current.clear()
    translationPromises.current.clear()
    setTxCache({})
    setTranslationError(null)
    setTranslationProgress(null)
  }, [sourceLanguage, hdr, parts, designs, fabricColors, sizeChart])
  useEffect(() => {
    if (!factoryLanguages.includes(prevLang)) setPrevLang(factoryLanguages[0])
  }, [factoryLanguages, prevLang])
  const tl = T[uiLang] || T.ES
  const ui = UI[uiLang] || UI.ES

  // Color palette preset - `setPalette()` MUTATES the shared `palette`/`role`
  // objects (see design/tokens.js), so a plain object mutation is invisible
  // to React's own change detection; only a STATE CHANGE forces this
  // component (and every child under it, since none are React.memo'd) to
  // re-render and read the new hex values. That's why the persisted preset
  // is applied INSIDE the useState initializer (runs synchronously during
  // this component's first render, before its JSX is built) rather than in
  // a useEffect - an effect fires after the first paint, so on reload the
  // page would flash bauhaus for a frame and then never even correct itself
  // (nothing re-renders after an effect-only mutation with no state change).
  const [paletteName, setPaletteName] = useState(() => {
    let name = "bauhaus"
    try { name = localStorage.getItem("techpack.palette") || "bauhaus" } catch {}
    setPalette(name)
    try {
      const custom = JSON.parse(localStorage.getItem("techpack.paletteCustom") || "{}")
      for (const key of CUSTOM_EDITABLE_KEYS) if (custom[key]) setCustomColor(key, custom[key])
    } catch {}
    return name
  })
  // Bumped on every freehand color edit - setCustomColor() mutates palette/
  // role in place (same reason as setPalette, see the comment above), so a
  // plain object mutation needs a state change to force this component (and
  // every uninvolved child, none memo'd) to actually re-render and pick it up.
  const [paletteVersion, setPaletteVersion] = useState(0)
  function choosePalette(name) {
    setPalette(name)
    setPaletteName(name)
    try {
      localStorage.setItem("techpack.palette", name)
      // Switching to a NAMED preset resets any freehand tweaks on top of it -
      // "pick bauhaus" should give you bauhaus, not bauhaus-plus-a-leftover-
      // custom-red from before.
      localStorage.removeItem("techpack.paletteCustom")
    } catch {}
    setPaletteVersion((v) => v + 1)
  }
  function updateCustomColor(key, hex) {
    setCustomColor(key, hex)
    setPaletteVersion((v) => v + 1)
    try {
      const custom = JSON.parse(localStorage.getItem("techpack.paletteCustom") || "{}")
      custom[key] = hex
      localStorage.setItem("techpack.paletteCustom", JSON.stringify(custom))
    } catch {}
  }

  useEffect(() => {
    if (textAIProvider !== "local") return undefined
    let active = true
    let timer
    const check = async () => {
      try {
        const health = await getLocalAIHealth()
        if (active) setLocalAIStatus(health.status === "ready" ? "ready" : "starting")
        if (active) setLocalAIModel(health.model || "")
        if (active && health.status !== "ready") timer = setTimeout(check, 3000)
      } catch {
        if (active) setLocalAIStatus("offline")
        if (active) timer = setTimeout(check, 3000)
      }
    }
    check()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [textAIProvider])

  function selectGarment(id, { vision = false } = {}) {
    if (id === garmentId && visionEntry === vision) return
    setGarmentId(id)
    setVisionEntry(vision)
    if (!vision) {
      setVisionSeed(null)
      setVisionError(null)
      setVisionProgress(null)
      setVisionWarnings([])
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
    setFabricColors([])
    setTxCache({})
    setPrevPage(0)
    setPlannedPreviewPages(null)
    setPlannedPreviewKey("")
    setPlannedPreviewError(null)
  }

  // F1: "ficha desde foto" entry point - splits each photo client-side into a
  // whole-image read PLUS 4 quadrant close-ups (F1.5: fixes the "vague on fine
  // detail" gap - the whole photo alone is great at identifying the garment
  // in general but misses costuras/hardware/texture; quadrants add detail
  // without ever overriding the whole photo's garmentType/general read - see
  // splitImageIntoQuadrants + extractGarmentFromImages in visionExtract.js).
  // Sends them to the vision model and stores the resulting {garmentType,
  // seed} to hand to GarmentChat at the Piezas step. A failed/skipped
  // extraction still lets the user continue - GarmentChat just starts from a
  // blank naming phase, same as picking "Prenda nueva (con IA)" directly.
  async function handleVisionUpload(e) {
    var files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setVisionExtracting(true)
    setVisionError(null)
    setVisionProgress(null)
    setVisionWarnings([])
    try {
      var split = await Promise.all(files.map((f) => splitImageIntoQuadrants(f)))
      var photoTotal = split.length
      var images = []
      split.forEach(function (s, photoIndex) {
        images.push(Object.assign({}, s.full, { photoIndex, photoTotal }))
        s.quadrants.forEach(function (q) {
          images.push(Object.assign({}, q, { photoIndex, photoTotal }))
        })
      })
      var result = await extractGarmentFromImages(images, {
        lang: "ES",
        onProgress: (progress) => {
          setVisionProgress(progress)
          if (progress.warning) setVisionWarnings((w) => [...w, progress.warning])
        },
      })
      setVisionSeed(result)
    } catch (err) {
      setVisionError(err instanceof DeepSeekError ? err.message : "No se pudo analizar la foto.")
    } finally {
      setVisionExtracting(false)
      setVisionProgress(null)
      e.target.value = ""
    }
  }

  // Reads a CSV or Markdown/plain-text document and turns it into the same
  // {garmentType, seed} shape visionSeed produces, so a person who already
  // has most of the tech pack's data written down can skip typing it in one
  // field at a time - the chat opens straight into analysis with this seed
  // and only asks about genuine gaps (extractSeedFromDocument never invents
  // what the document doesn't say).
  async function handleDocumentUpload(e) {
    var f = e.target.files[0]
    e.target.value = ""
    if (!f) return
    setDocExtracting(true)
    setDocError(null)
    try {
      var text = await readFileText(f)
      var result = await extractSeedFromDocument(text, { tecs: tl.tecs })
      setDocSeed(result)
    } catch (err) {
      setDocError(err instanceof DeepSeekError ? err.message : "No se pudo leer o interpretar el documento.")
    } finally {
      setDocExtracting(false)
    }
  }

  function handleGarmentChatComplete(draft) {
    const g = buildCustomGarment(draft)
    setCustomGarment(g)
    setParts(g.defaultParts.map((p) => Object.assign({}, p)))
    const mapped = mapChatDesignsToDesigns(draft.designs, g.positions.ES[0])
    setDesigns(mapped.map((d) => Object.assign(newDesign(), d)))
    if (Array.isArray(draft.fabricColors)) setFabricColors(draft.fabricColors.map(normalizeFabricColor))
    setPlannedPreviewPages(null)
    setPlannedPreviewKey("")
    setPlannedPreviewError(null)
  }
  function toggleLang(c) {
    setFactoryLanguages((languages) => toggleFactoryLanguage(languages, c))
  }
  function updPart(id, k, v) {
    setParts((p) => p.map((x) => (x.id === id ? Object.assign({}, x, { [k]: v }) : x)))
  }
  function updDesign(id, k, v) {
    setDesigns((p) => p.map((x) => (x.id === id ? Object.assign({}, x, { [k]: v }) : x)))
  }
  function updDesignColors(id, colors) {
    setDesigns((current) => current.map((design) => {
      if (design.id !== id) return design
      if (!isEmbTec(design.tec)) return { ...design, colors }
      const previousStops = design.emb && Array.isArray(design.emb.stopSeq) ? design.emb.stopSeq : []
      const stopSeq = madeiraColorsToStops(colors, previousStops)
      return { ...design, colors, emb: { ...(design.emb || EMPTY_EMB), stops: stopSeq.length, stopSeq } }
    }))
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

  async function handleCsvImages(e) {
    var files = Array.from(e.target.files || [])
    if (files.length === 0) return
    var read = await Promise.all(files.map(readDesignImageFile))
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

  function translationPartLabels() {
    return withPartLabels(parts, garment, sourceLanguage)
      .filter((part) => part && part.on !== false)
      .map((part) => part.label || "")
  }

  async function ensureTranslation(cacheKey, lang, audience) {
    if (txCache[cacheKey]) return txCache[cacheKey]
    if (translationPromises.current.has(cacheKey)) return translationPromises.current.get(cacheKey)
    const generation = translationGeneration.current
    const controller = new AbortController()
    translationControllers.current.set(cacheKey, controller)
    translationRuns.current += 1
    setTranslating(true)
    setTranslationError(null)
    const promise = (async () => {
      try {
        const tx = await translateContent(hdr, parts, designs, lang, {
          sourceLang: sourceLanguage,
          fabricColors,
          sizeChart,
          partLabels: translationPartLabels(),
          signal: controller.signal,
          onProgress: setTranslationProgress,
        })
        if (generation !== translationGeneration.current) throw new DOMException("Translation superseded", "AbortError")
        setTxCache((current) => Object.assign({}, current, { [cacheKey]: tx }))
        return tx
      } catch (error) {
        if (generation !== translationGeneration.current || (error && error.name === "AbortError")) throw error
        setDocumentReady(false)
        setPlannedPreviewPages([])
        setTranslationError({ language: lang, audience, message: (error && error.message) || "No se pudo traducir el documento." })
        throw error
      } finally {
        if (translationPromises.current.get(cacheKey) === promise) translationPromises.current.delete(cacheKey)
        if (translationControllers.current.get(cacheKey) === controller) translationControllers.current.delete(cacheKey)
        translationRuns.current = Math.max(0, translationRuns.current - 1)
        setTranslating(translationRuns.current > 0)
        if (translationRuns.current === 0) setTranslationProgress(null)
      }
    })()
    translationPromises.current.set(cacheKey, promise)
    return promise
  }

  async function ensureTx(lang) {
    return ensureTranslation(lang, lang, "factory")
  }

  async function ensureDesignerTx() {
    const key = "designer:" + designerLanguage
    return ensureTranslation(key, designerLanguage, "designer")
  }

  async function retryTranslation(error) {
    if (!error) return
    setDocumentReady(false)
    setPlannedPreviewPages([])
    setPlannedPreviewError(null)
    try {
      const result = await (error.audience === "designer" ? ensureDesignerTx() : ensureTx(error.language))
      setTranslationRevision((value) => value + 1)
      return result
    } catch {
      return null
    }
  }

  async function ensureFactoryTranslations() {
    const entries = await Promise.all(factoryLanguages.map(async (language) => [language, await ensureTx(language)]))
    return Object.fromEntries(entries)
  }

  function sourceDocumentTranslation() {
    return buildTranslationPayload(hdr, parts, designs, sourceLanguage, fabricColors, sizeChart, translationPartLabels())
  }

  function svgSafeText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/'/g, "&apos;")
  }

  function plannedPageName(page, i) {
    var raw = (page && (page.id || page.title)) || "page-" + (i + 1)
    return String(raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "page_" + (i + 1)
  }

  // A page that is not finished must never look like one that is.
  //
  // The preview used to publish the fully rendered deterministic plan first,
  // which reads as a completed tech pack - so the wait looked like the result,
  // and there was no way to tell a real page from a placeholder. This draws an
  // unmistakably in-progress sheet instead: the page's own title, what is
  // happening to it right now, and how far the document as a whole has got.
  function placeholderSvg(page, i, total, state) {
    var W = PAGE.width
    var H = PAGE.height
    var status = (state && state.label) || ui.queued
    var detail = (state && state.detail) || ""
    var done = (state && state.done) || 0
    var title = svgSafeText((page && page.title) || ui.page + " " + (i + 1))
    var barX = 80
    var barW = W - 160
    var ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
    return (
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + H + "' width='" + PAGE.physicalWidth + "' height='" + PAGE.physicalHeight + "'>" +
      "<rect width='" + W + "' height='" + H + "' fill='" + C.white.hex + "' stroke='" + C.ink.hex + "' stroke-width='1.5'/>" +
      // dashed frame = this sheet is still being built
      "<rect x='" + GRID.margin + "' y='" + GRID.margin + "' width='" + (W - GRID.margin * 2) + "' height='" + (H - GRID.margin * 2) + "' fill='none' stroke='#C6CAD2' stroke-width='1' stroke-dasharray='10 8'/>" +
      "<rect x='" + GRID.margin + "' y='" + GRID.margin + "' width='8' height='" + (H - GRID.margin * 2) + "' fill='" + role.highlight.fill + "'/>" +
      "<text x='80' y='120' font-family='" + type.svgFonts.data + "' font-size='13' fill='#8A909A'>PAGINA " + (i + 1) + " DE " + total + "</text>" +
      "<text x='80' y='168' font-family='" + type.svgFonts.ui + "' font-size='28' font-weight='bold' fill='" + C.ink.hex + "'>" + title + "</text>" +
      "<text x='80' y='214' font-family='" + type.svgFonts.data + "' font-size='16' fill='" + role.priority.fill + "'>" + svgSafeText(status) + "</text>" +
      (detail ? "<text x='80' y='246' font-family='" + type.svgFonts.ui + "' font-size='14' fill='" + C.ink.hex + "'>" + svgSafeText(detail) + "</text>" : "") +
      // document-level progress, so the wait has a visible end
      "<rect x='" + barX + "' y='" + (H - 150) + "' width='" + barW + "' height='6' fill='#E6E8EC'/>" +
      "<rect x='" + barX + "' y='" + (H - 150) + "' width='" + Math.round(barW * ratio) + "' height='6' fill='" + role.priority.fill + "'/>" +
      "<text x='80' y='" + (H - 118) + "' font-family='" + type.svgFonts.data + "' font-size='13' fill='#8A909A'>" + done + " de " + total + " paginas resueltas</text>" +
      "<text x='80' y='" + (H - 92) + "' font-family='" + type.svgFonts.ui + "' font-size='13' fill='#8A909A'>Esta hoja todavia no es definitiva.</text>" +
      "</svg>"
    )
  }

  function fallbackPageLayout(page, context = { parts, designs, fabricColors }) {
    return deterministicPageLayout(page, context)
  }

  // Translation and layout are independent contracts. If a provider cannot
  // translate, the document still goes through the measured semantic engine;
  // it must never fall back to the old fixed template with floating tables.
  function buildDeterministicCustomPages(lang, tx, designerTx, renderColorways) {
    const localized = buildLocalizedSnapshot({ hdr, parts, designs, fabricColors, sizeChart }, tx)
    var garmentType = localized.hdr.pname || (garment && garment.label ? garment.label[lang] || garment.label.ES : "Custom garment")
    var baseContext = { garmentType, parts: localized.parts, designs: localized.designs, fabricColors: localized.fabricColors, sizeChart: localized.sizeChart, lang, sourceLanguage, designerLanguage }
    var ctx = { lang, ...localized, logo, txData: tx, designerTx, garment, dimensionUnit }
    return buildDeterministicCustomDocument({ baseContext, renderContext: ctx, colorways: renderColorways || [colorways[0]] })
  }

  // `signal` is what stops two overlapping runs from sabotaging each other.
  // runHybridAI keys its in-flight operations by TASK and aborts the previous
  // one whenever a new call arrives with the same task - so a second run
  // (the live preview re-firing on any edit, or Generar landing on top of it)
  // silently killed the first run's outline/page calls, which surfaced to the
  // user as "El plan de documento con IA fallo ... (aborted)" plus a pile of
  // pages on the deterministic layout. Cancelling the OLD run explicitly means
  // only the run nobody is waiting for dies, and it dies quietly.
  // `renderColorways` defaults to the base colorway ONLY - the live preview
  // effect calls this on every edit and must keep showing one document (see
  // its own "Preview renders colorway[0] only" comment); only the real
  // Generar path (generateResolvedDocument) opts into the full colorway set.
  async function buildCustomDocumentPages(lang, tx, { showModal = true, onPages, onPlan, designerTx = null, signal, renderColorways } = {}) {
    const localized = buildLocalizedSnapshot({ hdr, parts, designs, fabricColors, sizeChart }, tx)
    var garmentType = localized.hdr.pname || (garment && garment.label ? garment.label[lang] || garment.label.ES : "Custom garment")
    // Distinguishes "we cancelled this run" from "the AI could not do it".
    // Checks the signal too, because an abort can surface as a plain rejection
    // from whichever await was in flight rather than as a named AbortError.
    function wasCancelled(error) {
      if (signal && signal.aborted) return true
      return !!(error && (error.name === "AbortError" || error.name === "DOMException"))
    }
    function publishPages(pages) {
      if (onPages) onPages(pages)
      if (showModal) setSvgPages(pages)
    }
    setDocumentPlanning(true)
    setDocumentReady(false)
    setDocumentPlanStatus(ui.structuringDocument)
    setDocumentPlanWarnings([])
    try {
      // The planner never saw what a field is CALLED, only its raw value
      // ("180-220 GSM" instead of "Gramaje") - garment.partLabels holds the
      // name for a chat-built custom garment, but baseContext never carried
      // `garment` before, so nothing downstream could resolve it.
      var baseContext = { garmentType, parts: localized.parts, designs: localized.designs, fabricColors: localized.fabricColors, sizeChart: localized.sizeChart, lang, sourceLanguage, designerLanguage }
      var provisionalOutline = fallbackDocumentOutline(baseContext)
      var provisionalPlan = { pages: provisionalOutline.pages.map((page) => deterministicPageLayout(page, baseContext)) }
      var ctx = { lang, ...localized, logo, txData: tx, designerTx, garment, dimensionUnit }
      // Deliberately NOT publishing the rendered provisional plan here. It
      // looks exactly like a finished document, so the preview showed a
      // complete-looking tech pack while the AI had not started - the user
      // could not tell the wait from the result. The plan itself still goes to
      // the caller (the review gate needs something to diff against).
      if (onPlan) onPlan(provisionalPlan)

      function drawWaiting(pages, state) {
        publishPages(pages.map((page, i) => ({
          name: plannedPageName(page, i),
          svg: placeholderSvg(page, i, pages.length, typeof state === "function" ? state(i) : state),
        })))
      }

      drawWaiting(provisionalOutline.pages, { label: ui.analyzingGarment, detail: ui.decidingPages, done: 0 })

      var outline
      try {
        outline = await planDocumentOutline(baseContext, {
          signal,
          onStatus: (status) => {
            setDocumentPlanStatus(status)
            drawWaiting(provisionalOutline.pages, { label: ui.structuringDocument, detail: status, done: 0 })
          },
          onSections: (sections) => {
            var detail = uiDocumentSectionsReady(uiLang, sections.length)
            setDocumentPlanStatus(detail)
            var sectionPreview = [
              { id: "cover", title: garmentType, purpose: "cover" },
              ...sections,
              ...provisionalOutline.pages.filter((page) => page.purpose && page.purpose.indexOf("design:") === 0),
            ]
            drawWaiting(sectionPreview, { label: ui.structuringDocument, detail: detail, done: 0 })
          },
          onBatch: (batch) => {
            var detail = uiAssigningDocumentBatch(uiLang, batch.index, batch.total)
            setDocumentPlanStatus(detail)
          },
          // Mirrors planPageLayout's onResult below - the outline call can
          // resolve NORMALLY with the deterministic fallback's content (every
          // provider either failed or failed the outline's own validator),
          // which never throws and so never hit the catch block - the whole
          // document structure came from fallbackDocumentOutline() with zero
          // visible warning. Observed live even after the id-type-mismatch
          // fix: the fallback is a legitimate, honest outcome, it just must
          // not be silent.
          onProposal: (proposal) => {
            if (proposal && proposal.aiResult && proposal.aiResult.provider === "contract") {
              const stages = proposal.aiResult.degradedStages
              if (stages && !stages.index && stages.assignmentBatches.length > 0) {
                setDocumentPlanWarnings((w) => [...w, { level: "assisted", text: uiPlanContractAssisted(uiLang, stages.assignmentBatches.length) }])
              } else {
                setDocumentPlanWarnings((w) => [...w, { level: "document", text: uiPlanFailed(uiLang, proposal.aiResult.fallbackReason) }])
              }
            }
          },
        })
      } catch (error) {
        // A run the app itself cancelled is not a planning failure: reporting
        // it told the user "El plan de documento con IA fallo ... (aborted)"
        // about work nobody was waiting for any more, while the run that
        // replaced it was still going fine. Bail out instead of warning and
        // then planning ~30 pages that will be thrown away.
        if (wasCancelled(error)) throw error
        outline = provisionalOutline
        setDocumentPlanWarnings((w) => [...w, { level: "document", text: uiPlanFailed(uiLang, describeAIError(error)) }])
      }
      // Built and unit-tested since the semantic-outline work, but never
      // actually called from the app - the "the sink page is overflowing,
      // the taxonomy came up short" signal existed only in tests. A
      // data:general page this full means real construction facts landed in
      // the catch-all instead of a real section, which is worth surfacing
      // even though nothing failed outright.
      var sinkAudit = auditSinkOverflow(outline.pages)
      if (sinkAudit.overflowing) {
        setDocumentPlanWarnings((w) => [...w, { level: "document", text: uiSinkOverflow(uiLang, sinkAudit.count) }])
      }
      var total = outline.pages.length
      var placeholders = outline.pages.map((page, i) => ({ name: plannedPageName(page, i), svg: placeholderSvg(page, i, total, { label: ui.queued, done: 0 }) }))
      publishPages(placeholders)
      var plannedPages = []
      for (var i = 0; i < total; i++) {
        var page = outline.pages[i]
        var human = uiDevelopingPage(uiLang, i + 1, total)
        setDocumentPlanStatus(human + "...")
        // Repaint the queue on every tick so the sheet being worked on says so,
        // the ones already resolved show their real render, and the rest read
        // "queued" - the wait becomes legible instead of a frozen spinner.
        var repaint = (function (index, detail) {
          var resolved = buildPlannedPages({ pages: plannedPages }, ctx, { documentMode: "illustration-handoff" })
          publishPages(outline.pages.map(function (p, idx) {
            if (idx < resolved.length) return resolved[idx]
            var state = idx === index
              ? { label: ui.designingThisPage, detail: detail, done: index }
              : { label: ui.queued, done: index }
            return { name: plannedPageName(p, idx), svg: placeholderSvg(p, idx, total, state) }
          }))
        })
        repaint(i, ui.aiDecidingBlocks)
        try {
          var planned = await planPageLayout(
              page,
              baseContext,
              {
                signal,
                onStatus: setDocumentPlanStatus,
                onProgress: (function (index, label) {
                  return function (progress) {
                    var detail = progress.lastLabel ? uiResolvingBlock(uiLang, progress.lastLabel) : ui.aiDecidingBlocks
                    setDocumentPlanStatus(label + (progress.lastLabel ? ": " + progress.lastLabel : "..."))
                    repaint(index, detail)
                  }
                })(i, human),
                // The call can resolve NORMALLY with fallback content (every
                // provider failed or failed the task's own validator, so
                // runHybridAI shipped the deterministic layout instead) -
                // that never threw, so the catch below never saw it and the
                // page rendered with zero warning. onResult exposes exactly
                // that via result.provider === "contract".
                onResult: (function (index, pageName) {
                  return function (result) {
                    if (result && result.provider === "contract") {
                      setDocumentPlanWarnings((w) => [...w, { level: "page", text: uiPageUsedFallback(uiLang, index + 1, pageName, result.fallbackReason) }])
                    }
                  }
                })(i, plannedPageName(page, i)),
              },
            )
          plannedPages.push(planned)
        } catch (error) {
          // Same rule as the outline above: a cancelled run stops here rather
          // than filling the remaining pages with the deterministic layout and
          // reporting each one as an AI failure ("29 paginas usaron layout
          // estandar" came from exactly this loop running on after an abort).
          if (wasCancelled(error)) throw error
          plannedPages.push(fallbackPageLayout(page, baseContext))
          setDocumentPlanWarnings((w) => [...w, { level: "page", text: uiPageDesignFailed(uiLang, i + 1, plannedPageName(page, i), describeAIError(error)) }])
        }
        var rendered = buildPlannedPages({ pages: plannedPages }, ctx, { documentMode: "illustration-handoff" })
        publishPages(outline.pages.map(function (p, idx) {
          if (idx < rendered.length) return rendered[idx]
          return { name: plannedPageName(p, idx), svg: placeholderSvg(p, idx, total, { label: ui.queued, done: rendered.length }) }
        }))
      }
      // Hand the planned document (pages with their regions) to the caller so
      // the pre-download review can diff intake intent against what each page
      // actually carries.
      if (onPlan) onPlan({ pages: plannedPages })
      // Re-renders this SAME plan once per colorway (renderColorwayDocument
      // is buildPlannedPages underneath) - zero extra AI calls, since colors
      // are render-time data the planner never reasoned about. With exactly
      // one colorway this is byte-identical to the old plain buildPlannedPages
      // call, so a document with no second colorway is unaffected.
      var finalPages = renderColorwayDocument({ pages: plannedPages }, ctx, renderColorways || [colorways[0]], { documentMode: "illustration-handoff", includeIndex: true })
      setDocumentReady(true)
      return finalPages
    } finally {
      setDocumentPlanning(false)
      setDocumentPlanStatus("")
    }
  }

  // Applies grayscale (if toggled) and opens the SVG export modal. The single
  // choke point every export path funnels through, AFTER the review gate.
  function publishForExport(pages) {
    if (monoMode) pages = pages.map((p) => ({ ...p, svg: toGrayscale(p.svg) }))
    setSvgPages(pages)
  }

  async function handleGenerate(lang) {
    try {
      var results = await Promise.all([ensureTx(lang), ensureDesignerTx()])
      return generateResolvedDocument(lang, results[0], results[1])
    } catch {
      // ensureTx/ensureDesignerTx already leave a recoverable, language-specific
      // error in the UI. The original-language export remains available.
      return null
    }
  }

  async function handleGenerateMultilingual() {
    try {
      var results = await Promise.all([ensureFactoryTranslations(), ensureDesignerTx()])
      var combined = combineTranslations(results[0], factoryLanguages)
      return generateResolvedDocument(factoryLanguages[0], combined, results[1])
    } catch {
      return null
    }
  }

  function handleGenerateSource() {
    var source = sourceDocumentTranslation()
    return generateResolvedDocument(sourceLanguage, source, source)
  }

  async function generateResolvedDocument(lang, tx, designerTx) {
    var pages
    var plan = null
    if (garmentId === "custom" && customGarment) {
      // The live preview may still be planning the very same document. Both
      // runs would claim the same runHybridAI task slots and abort each
      // other's calls, so the real generation takes precedence explicitly.
      if (previewRunRef.current) {
        previewRunRef.current.abort()
        previewRunRef.current = null
      }
      try {
        pages = await buildCustomDocumentPages(lang, tx, { showModal: false, onPlan: (p) => (plan = p), designerTx, renderColorways: colorways })
      } catch {
        pages = buildDeterministicCustomPages(lang, tx, designerTx, colorways)
      }
    } else {
      pages = buildAllPages(lang, hdr, parts, designs, logo, tx, garment, fabricColors)
    }

    // Pre-download review round: hold behind the review chat whenever the
    // AI-planned custom path has a plan to review - the chat itself decides
    // what (if anything) actually needs asking. Round 1 diffs intake intent
    // against the generated document (missing/unplaced data); round 2 (the
    // 4th review overall) then reasons like a technical designer over
    // everything already decided for production-critical gaps - it runs
    // even when round 1 found nothing, so it is NOT gated on `problems`.
    // ReviewChat auto-skips itself (equivalent to `skipReview` below) if
    // BOTH rounds end up empty, so a clean intake never sees an empty modal.
    // Registered garments use the fixed template and have no plan to review.
    if (plan) {
      var findings = buildReviewFindings({ hdr, parts, designs }, plan)
      var garmentType = garment && garment.label ? garment.label[lang] || garment.label.ES : "Custom garment"
      setPendingReview({ pages, plan, lang, tx, designerTx, garmentType })
      setReviewFindings(findings)
      return
    }
    publishForExport(pages)
  }

  function skipReview() {
    const pages = pendingReview && pendingReview.pages
    setReviewFindings(null)
    setPendingReview(null)
    if (pages) publishForExport(pages)
  }

  async function finishReview(answers) {
    if (!pendingReview) return
    const pending = pendingReview
    const applied = applyReviewAnswers({ hdr, parts, designs, plan: pending.plan }, answers)
    const planCtx = {
      garmentType: pending.garmentType,
      parts: applied.parts,
      designs: applied.designs,
      fabricColors,
      sizeChart,
      lang: pending.lang,
    }
    const affected = new Set(applied.affectedPageIds)
    const revisedPlan = { pages: [] }

    setDocumentPlanning(true)
    try {
      for (var i = 0; i < applied.plan.pages.length; i++) {
        var page = applied.plan.pages[i]
        if (!affected.has(page.id)) {
          revisedPlan.pages.push(page)
          continue
        }

        setDocumentPlanStatus(uiApplyingRevision(uiLang, i + 1, applied.plan.pages.length))
        try {
          var replanned = await withPlanningTimeout(planPageLayout(page, planCtx))
          revisedPlan.pages.push(replanned)
        } catch {
          // Review completion cannot be held hostage by the provider. The
          // deterministic contract already knows the required page shape.
          revisedPlan.pages.push(repairPage(page, planCtx).page)
        }
      }

      const renderCtx = {
        lang: pending.lang,
        hdr: applied.hdr,
        parts: applied.parts,
        designs: applied.designs,
        fabricColors,
        sizeChart,
        logo,
        txData: pending.tx,
        designerTx: pending.designerTx,
        garment,
        dimensionUnit,
      }
      // Same colorway replay as buildCustomDocumentPages' final render - the
      // review round only ever revises ONE plan, so this stays correct for
      // every colorway without re-running the review itself per colorway.
      const rendered = renderColorwayDocument(revisedPlan, renderCtx, colorways, { documentMode: "illustration-handoff", includeIndex: true })

      // Commit the snapshots only after the corrected document rendered.
      setHdr(applied.hdr)
      setParts(applied.parts)
      setDesigns(applied.designs)
      setTxCache({})
      setPlannedPreviewPages(rendered)
      setPlannedPreviewKey("")
      setReviewFindings(null)
      setPendingReview(null)
      publishForExport(rendered)
    } finally {
      setDocumentPlanning(false)
      setDocumentPlanStatus("")
    }
  }

  // Gated on step 5 OR 6 (Vista Previa / Tallaje) so moving to the Tallaje
  // step never wipes the already-planned preview (see the effect below) -
  // only actually leaving both steps should drop it. Note this reads
  // `committedSizeChart`, NOT the live `sizeChart` the Tallaje step edits -
  // a replan is a real AI cost, and nobody should pay it per keystroke.
  var previewPlanKey = (step === 5 || step === 6) && garmentId === "custom" && customGarment
    ? JSON.stringify({
        lang: prevLang,
        sourceLanguage,
        designerLanguage,
        factoryLanguages,
        outputMode,
        hdr,
        parts,
        // Superset of `fabricColors` (which is only colorways[0]) - without
        // this, editing colorway 2's swatches or thread overrides would
        // never re-trigger the live preview, since the preview key only
        // reacted to the base colorway.
        colorways,
        sizeChart: committedSizeChart,
        designs: designs.map((d) => ({
          name: d.name,
          pos: d.pos,
          posDetail: d.posDetail,
          tec: d.tec,
          colors: d.colors,
          driveLink: d.driveLink,
          fileName: d.fileName,
          illustrationBrief: d.illustrationBrief,
          emb: d.emb,
        })),
        hasLogo: !!logo,
      })
    : ""

  useEffect(() => {
    if (!previewPlanKey) {
      setPlannedPreviewPages(null)
      setPlannedPreviewKey("")
      setPlannedPreviewError(null)
      return
    }
    if (plannedPreviewKey === previewPlanKey && plannedPreviewPages && plannedPreviewPages.length > 0) return

    var active = true
    // Cancels the PREVIOUS preview run before starting this one. Without it
    // both runs stayed alive and fought over runHybridAI's per-task slot, so
    // the surviving run reported its own calls as aborted (see
    // buildCustomDocumentPages). `active` alone was not enough: it only
    // ignored the stale RESULT, it never stopped the stale WORK.
    if (previewRunRef.current) previewRunRef.current.abort()
    var controller = new AbortController()
    previewRunRef.current = controller
    setPlannedPreviewKey(previewPlanKey)
    setPlannedPreviewPages(null)
    setPlannedPreviewError(null)
    setDocumentReady(false)
    Promise.allSettled([ensureTx(prevLang), ensureDesignerTx()])
      .then(([factoryResult, designerResult]) => {
        var factoryOk = factoryResult.status === "fulfilled"
        if (!factoryOk) {
          if (!active) return null
          setPlannedPreviewPages([])
          setPlannedPreviewError(
            uiLang === "EN"
              ? `The ${prevLang} document was not generated. The source-language document will not be shown as ${prevLang}. Retry the translation.`
              : `No se genero el documento ${prevLang}. El original no se mostrara como si estuviera en ${prevLang}. Reintenta la traduccion.`
          )
          return null
        }
        var renderLang = prevLang
        var tx = factoryResult.value
        var designerTx = designerResult.status === "fulfilled" ? designerResult.value : sourceDocumentTranslation()
        return buildCustomDocumentPages(renderLang, tx, {
        showModal: false,
        designerTx,
        signal: controller.signal,
        onPages: (pages) => {
          if (!active) return
          setPlannedPreviewPages(pages)
          setPrevPage((p) => Math.min(p, Math.max(0, pages.length - 1)))
        },
        })
      })
      .then((pages) => {
        if (!active || !pages) return
        setPlannedPreviewPages(pages)
        setPrevPage((p) => Math.min(p, Math.max(0, pages.length - 1)))
      })
      .catch((error) => {
        // A run we cancelled on purpose is not a failure to report - showing
        // "no se pudo disenar el documento" for the run the user themselves
        // superseded is exactly the misleading message this fix removes.
        if (!active || (error && error.name === "AbortError")) return
        var tx = txCache[prevLang] || sourceDocumentTranslation()
        var renderLang = txCache[prevLang] ? prevLang : sourceLanguage
        setPlannedPreviewError("No se pudo completar el plan con IA; mostrando la composición semántica medida.")
        setPlannedPreviewPages(buildDeterministicCustomPages(renderLang, tx, sourceDocumentTranslation()))
      })

    return () => {
      active = false
      controller.abort()
      if (previewRunRef.current === controller) previewRunRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPlanKey, translationRevision])

  function canNext() {
    if (step === 0) return !!garmentId && !visionExtracting
    if (step === 1) return factoryLanguages.length > 0 && !!designerLanguage
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
              {ui.newGarmentAI}
            </Chip>
            <Chip selected={garmentId === "custom" && visionEntry} onClick={() => selectGarment("custom", { vision: true })} iconName="photo_camera">
              {ui.garmentFromPhoto}
            </Chip>
          </div>
          {garmentId === "custom" && !visionEntry && (
            <div style={{ marginTop: space(3), maxWidth: 480, display: "flex", flexDirection: "column", gap: space(2) }}>
              <p style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, margin: 0 }}>
                {ui.garmentHelp}
              </p>
              <label style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: C.white.hex, border: `1px dashed ${C.ink.hex}`, cursor: docExtracting ? "wait" : "pointer", fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon name="upload_file" size={18} />
                {docExtracting ? ui.analyzingDocument : docSeed ? ui.changeDocument : ui.uploadDocument}
                <input type="file" accept=".csv,text/csv,.md,text/markdown,.txt,text/plain" disabled={docExtracting} onChange={handleDocumentUpload} style={{ display: "none" }} />
              </label>
              {docError && (
                <p style={{ fontSize: type.size.xs, color: role.index.fill, margin: 0 }}>
                  <Icon name="error" size={14} color={role.index.fill} /> {docError}
                </p>
              )}
              {docSeed && (
                <div style={{ border: hair, padding: space(2), fontSize: type.size.xs, color: C.ink.hex, background: C.white.hex }}>
                  <div style={{ fontWeight: 700, marginBottom: space(1) }}>{ui.detected}: {docSeed.garmentType || ui.notIdentified}</div>
                  {Object.keys(docSeed.seed || {}).length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: space(4) }}>
                      {Object.entries(docSeed.seed).map(([k, v]) => (
                        <li key={k}>{k}: {v}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ opacity: 0.7 }}>{ui.noAttributesDetected}</div>
                  )}
                </div>
              )}
            </div>
          )}
          {garmentId === "custom" && visionEntry && (
            <div style={{ marginTop: space(3), maxWidth: 480, display: "flex", flexDirection: "column", gap: space(2) }}>
              <p style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, margin: 0 }}>
                {ui.visionHelp}
              </p>
              <label style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: C.white.hex, border: `1px dashed ${C.ink.hex}`, cursor: visionExtracting ? "wait" : "pointer", fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon name="add_photo_alternate" size={18} />
                {visionExtracting ? ui.analyzingPhotos : visionSeed ? ui.changePhotos : ui.uploadPhotos}
                <input type="file" accept="image/png,image/jpeg" multiple disabled={visionExtracting} onChange={handleVisionUpload} style={{ display: "none" }} />
              </label>
              {visionExtracting && visionProgress && (
                <div style={{ border: hair, padding: space(2), fontSize: type.size.xs, color: C.ink.hex, background: C.white.hex }}>
                  <div style={{ fontWeight: 700, marginBottom: space(1) }}>{visionProgress.label}</div>
                  {visionProgress.partialText && <div style={{ fontFamily: type.fonts.data, opacity: 0.75, wordBreak: "break-word" }}>{visionProgress.partialText}</div>}
                  {visionProgress.warning && <div style={{ color: role.index.fill, marginTop: space(1) }}>{visionProgress.warning}</div>}
                </div>
              )}
              {visionError && (
                <p style={{ fontSize: type.size.xs, color: role.index.fill, margin: 0 }}>
                  <Icon name="error" size={14} color={role.index.fill} /> {visionError}
                </p>
              )}
              {visionSeed && (
                <div style={{ border: hair, padding: space(3), fontSize: type.size.xs, color: C.ink.hex }}>
                  <div style={{ fontWeight: 700, marginBottom: space(1) }}>{ui.detected}: {visionSeed.garmentType || ui.notIdentified}</div>
                  {Object.keys(visionSeed.seed || {}).length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: space(4) }}>
                      {Object.entries(visionSeed.seed).map(([k, v]) => (
                        <li key={k}>
                          {k}: {v}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ opacity: 0.7 }}>{ui.noAttributesDetected}</div>
                  )}
                </div>
              )}
              {visionWarnings.length > 0 && (
                <div style={{ border: hair, borderLeft: `${space(1)}px solid ${role.index.fill}`, padding: space(2), fontSize: type.size.xs, color: C.ink.hex, background: C.white.hex }}>
                  <div style={{ fontWeight: 700, marginBottom: space(1) }}>
                    {uiLang === "EN"
                      ? (visionWarnings.length === 1 ? "1 analysis step did not complete:" : visionWarnings.length + " analysis steps did not complete:")
                      : (visionWarnings.length === 1 ? "1 paso del análisis no se completó:" : visionWarnings.length + " pasos del análisis no se completaron:")}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: space(4), opacity: 0.85 }}>
                    {visionWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )

    if (step === 1)
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: space(5) }}>
          <div>
            {stepHelp(uiLang === "EN" ? "Language or languages for the factory:" : "Idioma o idiomas para la fabrica:")}
            <div style={{ display: "flex", gap: space(2), flexWrap: "wrap" }}>
              {sortedTextileLanguages(uiLang).map((item) => (
                <Chip key={item.code} selected={factoryLanguages.includes(item.code)} onClick={() => toggleLang(item.code)}>
                  {languageLabel(item.code, uiLang)}
                </Chip>
              ))}
            </div>
          </div>
          <Fld lbl={uiLang === "EN" ? "Language for the designer" : "Idioma para el disenador"}>
            <select value={designerLanguage} onChange={(event) => setDesignerLanguage(event.target.value)} style={{ width: "100%", padding: `${space(2)}px ${space(3)}px`, border: hair, background: C.white.hex, fontFamily: type.fonts.ui, fontSize: type.size.sm }}>
              {sortedTextileLanguages(uiLang).map((item) => <option key={item.code} value={item.code}>{languageLabel(item.code, uiLang)}</option>)}
            </select>
          </Fld>
          <Fld lbl={uiLang === "EN" ? "Multiple-language delivery" : "Entrega con varios idiomas"}>
            <div style={{ display: "flex", gap: 0 }}>
              {[{ value: "separate", label: uiLang === "EN" ? "One document per language" : "Un documento por idioma" }, { value: "multilingual", label: uiLang === "EN" ? "Languages in one document" : "Idiomas en un documento" }].map((option) => (
                <button key={option.value} type="button" onClick={() => setOutputMode(option.value)} style={{ padding: `${space(2)}px ${space(3)}px`, border: hair, background: outputMode === option.value ? role.priority.fill : C.white.hex, color: outputMode === option.value ? role.priority.on : C.ink.hex, fontWeight: 700, cursor: "pointer" }}>
                  {option.label}
                </button>
              ))}
            </div>
          </Fld>
          <div style={{ fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.65 }}>
            {uiLang === "EN" ? "Mistral drafts in the app language, then translates the factory and removable designer layers independently." : "Mistral redacta en el idioma de la app y luego traduce por separado la informacion de fabrica y la capa borrable del disenador."}
          </div>
        </div>
      )

    if (step === 2) {
      const reqEmpty = (k) => !hdr[k].trim()
      const RequiredLabel = ({ text, field }) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: space(1) }}>
          {text}
          {reqEmpty(field) && (
            <span title={ui.required} style={{ width: space(2), height: space(2), background: role.highlight.fill, boxShadow: `0 0 0 1px ${role.highlight.keyline}` }} />
          )}
        </span>
      )
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: space(4) }}>
          <Fld lbl={ui.brandLogo}>
            <div style={{ display: "flex", alignItems: "center", gap: space(3), flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(4)}px`, background: C.white.hex, border: `1px dashed ${logo ? role.priority.fill : C.ink.hex}`, cursor: "pointer", fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Icon name="upload_file" size={18} />
                {logo ? ui.changeLogo : ui.uploadLogoImage}
                <input type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} />
              </label>
              {logo && <img src={logo} style={{ height: 46, maxWidth: 100, objectFit: "contain", border: hair, padding: 4 }} alt="logo" />}
              {logo && (
                <button onClick={() => setLogo(null)} style={iconBtn(role.index.fill)} title={ui.remove}>
                  <Icon name="delete" size={20} color={role.index.fill} />
                </button>
              )}
            </div>
          </Fld>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space(4) }}>
            {[[tl.brand, "brand", "Ej: New Era", true], [tl.season, "season", "Ej: 2027 SS/FW"], [tl.sno, "sno", "Ej: 2ACP002"], [tl.fab, "fab", "Ej: 100% Poliester"], [tl.fac, "fac", "Ej: Venezuela"], [tl.ind, "ind", "18/10/2027"], [tl.outd, "outd", "20/11/2027"]].map((row) => (
              <Fld key={row[1]} lbl={row[3] ? <RequiredLabel text={row[0]} field={row[1]} /> : row[0]}>
                <Inp v={hdr[row[1]]} ch={(v) => setHdr((p) => Object.assign({}, p, { [row[1]]: v }))} ph={row[2]} />
              </Fld>
            ))}
            <Fld lbl={tl.cat}>
              <Sel v={hdr.cat} ch={(v) => setHdr((p) => Object.assign({}, p, { cat: v }))} opts={tl.cats} />
            </Fld>
            <Fld lbl={<RequiredLabel text={tl.pname} field="pname" />} span={2}>
              <Inp v={hdr.pname} ch={(v) => setHdr((p) => Object.assign({}, p, { pname: v }))} ph="Ej: Gorra New Era 59FIFTY Los Angeles" />
            </Fld>
          </div>
        </div>
      )
    }

    if (step === 3 && garmentId === "custom") {
      // docSeed (a CSV/Markdown upload, see handleDocumentUpload) and
      // visionSeed (a photo, "Prenda desde foto") are mutually exclusive
      // entry paths (chosen at step 0) - never both set, but docSeed wins if
      // they somehow were, since it's the more literal/explicit source.
      return (
        <GarmentChat
          onComplete={handleGarmentChatComplete}
          tecs={tl.tecs}
          seed={docSeed ? docSeed.seed : visionSeed ? visionSeed.seed : undefined}
          initialGarmentType={docSeed ? docSeed.garmentType : visionSeed ? visionSeed.garmentType : undefined}
          uiLang={uiLang}
        />
      )
    }

    if (step === 3 && csvVerifying) {
      return (
        <div>
          <p style={{ marginBottom: space(3), fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, maxWidth: 480 }}>
            El CSV no cubre todo lo que esta ficha necesita — respondé lo que falta y despues seguís editando la tabla de piezas como siempre.
          </p>
          <GarmentChat generalOnly onComplete={handleCsvVerificationComplete} tecs={tl.tecs} seed={csvVerifySeed.seed} initialGarmentType={csvVerifySeed.garmentType} uiLang={uiLang} />
        </div>
      )
    }

    if (step === 3) {
      const pn = garment.partLabels.ES
      const garmentTypeLabel = (garment.label && (garment.label.ES || Object.values(garment.label)[0])) || ""
      function searchPieceReference(pieceLabel) {
        const q = [garmentTypeLabel, pieceLabel].filter(Boolean).join(" ")
        window.open("https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(q), "_blank", "noopener,noreferrer")
      }
      let idx = 0
      return (
        <div>
          <div style={{ marginBottom: space(4), padding: space(3), border: `1px dashed ${role.priority.fill}`, background: C.white.hex }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space(3), flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: type.size.sm, fontWeight: 700, fontFamily: type.fonts.ui, color: C.ink.hex, textTransform: "uppercase", letterSpacing: "0.04em" }}>{ui.importFromCsv}</div>
                <div style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, marginTop: 2, maxWidth: 480 }}>
                  {ui.csvHelp}
                </div>
              </div>
              <div style={{ display: "flex", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={downloadCsvTemplate} style={secondaryBtnStyle}>
                  <Icon name="description" size={16} /> {ui.viewExample}
                </button>
                <label style={secondaryBtnStyle}>
                  <Icon name="add_photo_alternate" size={16} /> {csvImages.length > 0 ? uiPhotosCount(uiLang, csvImages.length) : ui.uploadPhotosOptional}
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" multiple onChange={handleCsvImages} style={{ display: "none" }} />
                </label>
                <label style={{ ...primaryBtnStyle(true), cursor: csvImporting ? "wait" : "pointer", opacity: csvImporting ? 0.6 : 1 }}>
                  <Icon name="upload_file" size={16} color={C.white.hex} /> {csvImporting ? ui.analyzing : ui.uploadCsv}
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
                  <span style={{ width: 132, display: "flex", alignItems: "center", gap: space(1), fontSize: type.size.sm, fontWeight: 700, color: C.ink.hex, flexShrink: 0, fontFamily: type.fonts.ui }}>
                    {nm}
                    <button
                      onClick={() => searchPieceReference(nm)}
                      title={uiSearchReferences(uiLang, nm)}
                      style={{ ...iconBtn(C.ink.hex), opacity: 0.4, flexShrink: 0 }}
                    >
                      <Icon name="help" size={14} />
                    </button>
                  </span>
                  <input value={p.val} onChange={(e) => updPart(p.id, "val", e.target.value)} style={{ flex: 1, padding: `${space(1)}px ${space(2)}px`, border: hair, fontSize: type.size.sm, outline: "none", background: C.white.hex, fontFamily: type.fonts.ui }} />
                  {p.customName && (
                    <button onClick={() => setParts((prev) => prev.filter((x) => x.id !== p.id))} style={iconBtn(role.index.fill)} title={ui.remove}>
                      <Icon name="delete" size={18} color={role.index.fill} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <button onClick={() => setParts((p) => [...p, { id: uid(), val: "", on: true, customName: ui.customPiece }])} style={dashedActionStyle}>
            <Icon name="add" size={16} color={role.priority.fill} /> {ui.addPiece}
          </button>
        </div>
      )
    }

    if (step === 4) {
      const positions = garment.positions.ES
      // Where the user asked for this, not App.jsx's own header: "un
      // marcador antes o en el momento donde se ponen los disenos que te
      // permita elegir la paleta, senalando cual es cada color en escala de
      // grises" - the header select (further down) picks the SAME palette,
      // this is just the place a designer is actually looking at when the
      // choice matters (about to add colors/artwork), with the printed-gray
      // check right there instead of buried in the app chrome.
      // `key` is the underlying tokens.js primitive setCustomColor() edits -
      // not just a display label, so each swatch's own <input type="color">
      // can write straight back to it (index->red, priority->blue, etc).
      const paletteRoles = [
        { key: "red", label: uiLang === "EN" ? "Index" : "Índice", fill: role.index.fill },
        { key: "blue", label: uiLang === "EN" ? "Priority" : "Prioridad", fill: role.priority.fill },
        { key: "yellow", label: uiLang === "EN" ? "Highlight" : "Resaltado", fill: role.highlight.fill },
        { key: "ink", label: uiLang === "EN" ? "Structure" : "Estructura", fill: role.structure.fill },
      ]
      return (
        <div>
          <div style={{ marginBottom: space(4), border: hair, background: C.white.hex, padding: space(3) }}>
            <div style={{ marginBottom: space(2), fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase" }}>
              {uiLang === "EN" ? "Fabric colorways / Pantone" : "Colores de tela / Pantone"}
            </div>
            <ColorwaysEditor colorways={colorways} onChange={setColorways} designs={designs} />
          </div>
          <div style={{ marginBottom: space(4), border: hair, background: C.white.hex, padding: space(3) }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space(2), marginBottom: space(2) }}>
              <span style={{ fontSize: type.size.xs, fontFamily: type.fonts.ui, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: C.ink.hex }}>
                {uiLang === "EN" ? "Document palette" : "Paleta del documento"}
              </span>
              <select
                value={paletteName}
                onChange={(e) => choosePalette(e.target.value)}
                title={uiLang === "EN" ? "Start from a preset" : "Partir de una paleta preestablecida"}
                style={{ padding: `${space(1)}px ${space(2)}px`, border: hair, background: C.white.hex, color: C.ink.hex, fontSize: type.size.xs, fontFamily: type.fonts.data, textTransform: "uppercase", cursor: "pointer" }}
              >
                {getPaletteNames().map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ margin: "0 0 " + space(2) + "px", fontSize: type.size.xs, fontFamily: type.fonts.ui, color: C.ink.hex, opacity: 0.65 }}>
              {uiLang === "EN"
                ? "Pick a preset to start, then click any swatch below to set that exact color yourself."
                : "Elegí una paleta para arrancar, y despues tocá cualquier color de abajo para ponerle el tono exacto que quieras."}
            </p>
            <div style={{ display: "flex", gap: space(3), flexWrap: "wrap" }}>
              {paletteRoles.map((r) => (
                <label
                  key={r.label}
                  title={uiLang === "EN" ? "Click to pick this exact color" : "Tocá para elegir este color exacto"}
                  style={{ display: "flex", flexDirection: "column", gap: space(1), padding: space(2), border: hair, cursor: "pointer", background: C.white.hex, position: "relative" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, fontFamily: type.fonts.ui, fontWeight: 700, color: C.ink.hex }}>
                    <Icon name="edit" size={13} color={role.priority.fill} /> {r.label}
                  </span>
                  <span style={{ display: "flex" }}>
                    <span style={{ width: 34, height: 34, background: r.fill, border: hair, display: "block" }} />
                    <span style={{ width: 34, height: 34, background: hexToGray(r.fill), border: hair, display: "block" }} title={uiLang === "EN" ? "Grayscale equivalent" : "Equivalente en gris"} />
                  </span>
                  <span style={{ fontSize: 9, fontFamily: type.fonts.data, color: C.ink.hex, opacity: 0.75 }}>
                    {r.fill.toUpperCase()} · {uiLang === "EN" ? "gray" : "gris"} {grayValueOf(r.fill)}
                  </span>
                  <input
                    type="color"
                    value={r.fill}
                    onChange={(e) => updateCustomColor(r.key, e.target.value)}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: 0, padding: 0 }}
                  />
                </label>
              ))}
            </div>
          </div>
          {designs.map((d, i) => {
            var isEmb = isEmbTec(d.tec), isWhole = isWholePosF(d.pos)
            return (
              <div key={d.id} style={{ marginBottom: space(4), border: hair, background: C.white.hex }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${space(2)}px ${space(3)}px`, background: role.priority.fill, color: role.priority.on }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space(2), fontSize: type.size.base, fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <IndexChip n={i + 1} /> {d.name}
                  </span>
                  <button onClick={() => setDesigns((p) => p.filter((x) => x.id !== d.id))} style={iconBtn(C.white.hex)} title={ui.removeDesign}>
                    <Icon name="close" size={20} color={C.white.hex} />
                  </button>
                </div>
                <div style={{ padding: space(3) }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space(3) }}>
                    <Fld lbl={ui.name}>
                      <Inp v={d.name} ch={(v) => updDesign(d.id, "name", v)} />
                    </Fld>
                    <Fld lbl={ui.position}>
                      <Sel v={d.pos} ch={(v) => updDesign(d.id, "pos", v)} opts={positions} />
                    </Fld>
                    <Fld lbl={ui.technique}>
                      <Sel v={d.tec} ch={(v) => updDesign(d.id, "tec", v)} opts={tl.tecs} />
                    </Fld>
                    {!isWhole ? (
                      <Fld lbl={tl.posDetail}>
                        <Inp v={d.posDetail || ""} ch={(v) => updDesign(d.id, "posDetail", v)} ph="Ej: Panel frontal centrado" />
                      </Fld>
                    ) : (
                      <div />
                    )}
                    {!isWhole && (
                      <Fld lbl={(uiLang === "EN" ? "Width (" : "Ancho (") + normalizeUnit(d.unit) + ")"}>
                        <Inp v={d.w || ""} ch={(v) => updDesign(d.id, "w", v)} ph="Ej: 111.6" mono={true} />
                      </Fld>
                    )}
                    {!isWhole && (
                      <Fld lbl={(uiLang === "EN" ? "Height (" : "Alto (") + normalizeUnit(d.unit) + ")"}>
                        <Inp v={d.h || ""} ch={(v) => updDesign(d.id, "h", v)} ph="Ej: 59.1" mono={true} />
                      </Fld>
                    )}
                    {/* The unit the numbers were TYPED in. Switching it never
                        rewrites what was entered - retyping a converted value
                        back into the field is how rounding error accumulates.
                        Conversion happens once, at print time. */}
                    {!isWhole && (
                      <Fld lbl={ui.unitOfMeasure}>
                        <Sel v={normalizeUnit(d.unit)} ch={(v) => updDesign(d.id, "unit", v)} opts={UNITS} />
                      </Fld>
                    )}
                    {!isWhole && (
                      <Fld lbl={ui.printIn}>
                        <Sel v={normalizeUnit(dimensionUnit)} ch={setDimensionUnit} opts={UNITS} />
                      </Fld>
                    )}
                    {!isWhole && normalizeUnit(d.unit) !== normalizeUnit(dimensionUnit) && formatDimensions(d.w, d.h, d.unit, dimensionUnit) && (
                      <div style={{ gridColumn: "span 2", padding: `${space(1)}px ${space(2)}px`, background: C.white.hex, border: `1px solid ${role.highlight.keyline}`, borderLeft: `${space(1)}px solid ${role.highlight.fill}`, fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.ink.hex }}>
                        {ui.willShowAs}: {formatDimensions(d.w, d.h, d.unit, dimensionUnit)}
                      </div>
                    )}
                    {isWhole && (
                      <div style={{ gridColumn: "span 2", display: "inline-flex", alignItems: "center", gap: space(2), padding: `${space(2)}px ${space(3)}px`, background: C.white.hex, border: `1px solid ${role.highlight.keyline}`, borderLeft: `${space(1)}px solid ${role.highlight.fill}`, fontSize: type.size.sm, color: C.ink.hex }}>
                        <Icon name="info" size={18} /> {tl.noApplica}.
                      </div>
                    )}
                    <Fld lbl={tl.fileName}>
                      <Inp v={d.fileName || ""} ch={(v) => updDesign(d.id, "fileName", v)} ph="Ej: SUNNER_HAWAII_LOGO_v3.ai" mono={true} />
                    </Fld>
                    <Fld lbl={tl.driveLink}>
                      <Inp v={d.driveLink || ""} ch={(v) => updDesign(d.id, "driveLink", v)} ph="Ej: drive.google.com/..." mono={true} />
                    </Fld>
                  </div>
                  <div style={{ marginTop: space(3) }}>
                    <Fld lbl={ui.colorsFieldLabel}>
                      <ColorsEditor colors={d.colors || []} onChange={(c) => updDesignColors(d.id, c)} madeira={isEmb} />
                    </Fld>
                  </div>
                  <div style={{ marginTop: space(3) }}>
                    <Fld lbl={ui.designImageFieldLabel}>
                      <ImageUploader d={d} onUpdate={(obj) => updDesignMulti(d.id, obj)} />
                    </Fld>
                  </div>
                  {isEmb && <EmbForm emb={d.emb || Object.assign({}, EMPTY_EMB, { stopSeq: [] })} onChange={(emb) => updDesign(d.id, "emb", emb)} />}
                </div>
              </div>
            )
          })}
          <button onClick={() => setDesigns((p) => [...p, Object.assign(newDesign(), { pos: positions[0] })])} style={dashedActionStyle}>
            <Icon name="add" size={16} color={role.priority.fill} /> {ui.addDesign}
          </button>
        </div>
      )
    }

    if (step === 5) {
      var plannedMode = garmentId === "custom" && customGarment
      var activePlannedPages = plannedMode && plannedPreviewPages ? plannedPreviewPages : []
      var hasFabricColorPage = fabricColors.some(hasColorData)
      var designPageOffset = hasFabricColorPage ? 2 : 1
      var allPgs = plannedMode
        ? activePlannedPages.map((p, i) => ({ l: p.name || "pagina_" + (i + 1), i }))
        : [
            { l: ui.mainPage, i: 0 },
            ...(hasFabricColorPage ? [{ l: "Colores de tela", i: 1 }] : []),
            ...designs.map((d, i) => ({ l: tl.pageDesign + " " + (i + 1), i: i + designPageOffset })),
          ]
      var activePlannedIndex = activePlannedPages.length > 0 ? Math.min(prevPage, activePlannedPages.length - 1) : 0
      var activePlannedPage = activePlannedPages[activePlannedIndex]
      const miniBtn = (active, activeColor) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: space(1),
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
              <span style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, marginRight: space(1), textTransform: "uppercase", letterSpacing: "0.08em" }}>{ui.view}</span>
              {allPgs.length > 0 ? allPgs.map((p) => (
                <button key={p.i} onClick={() => { setPrevPage(p.i); ensureTx(prevLang) }} style={miniBtn(prevPage === p.i, role.priority.fill)}>
                  {p.l}
                </button>
              )) : (
                <span style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7 }}>{ui.designingPages}</span>
              )}
              <span style={{ width: 1, alignSelf: "stretch", background: C.ink.hex, margin: `0 ${space(1)}px` }} />
              {factoryLanguages.map((l) => (
                <button key={l} onClick={() => { setPrevLang(l); ensureTx(l) }} style={miniBtn(prevLang === l, C.ink.hex)}>
                  {l}
                </button>
              ))}
              <span style={{ width: 1, alignSelf: "stretch", background: C.ink.hex, margin: `0 ${space(1)}px` }} />
              <button onClick={() => setViewAllPages((v) => !v)} title={ui.viewAllTitle} style={miniBtn(viewAllPages, role.priority.fill)}>
                <Icon name="grid_view" size={14} /> {ui.viewAll}
              </button>
              <button onClick={() => setMonoMode((v) => !v)} title={ui.grayscaleTitle} style={miniBtn(monoMode, C.ink.hex)}>
                <Icon name="contrast" size={14} /> {ui.grayscale}
              </button>
            </div>
            <div style={{ display: "flex", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
              {translating && <span style={{ fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>{ui.translating}{translationProgress ? ` ${translationProgress.completed}/${translationProgress.total}` : ""}</span>}
              {translationError && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>
                  {translationError.message}
                  <button type="button" onClick={() => retryTranslation(translationError)} style={{ border: hair, background: C.white.hex, color: C.ink.hex, cursor: "pointer", fontSize: type.size.xs }}>{ui.retry}</button>
                </span>
              )}
              {documentPlanning && <span style={{ fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}>{documentPlanStatus || ui.designingDocument}</span>}
              {!documentPlanning && documentReady && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, color: role.priority.fill, fontWeight: 700 }}>
                  <Icon name="check" size={14} color={role.priority.fill} /> {ui.documentReadyLabel}
                </span>
              )}
              {documentPlanWarnings.length > 0 && (() => {
                // A document-level failure (the outline call) is not "N
                // pages used the fallback" - it means the WHOLE plan came
                // from fallbackDocumentOutline(). Kept as a separate badge so
                // it stops being miscounted as "1 página" (see i18n's
                // uiPagesUsedFallback vs uiPlanFailed).
                var pageWarnings = documentPlanWarnings.filter((w) => w.level === "page")
                var docWarnings = documentPlanWarnings.filter((w) => w.level === "document")
                var assistedWarnings = documentPlanWarnings.filter((w) => w.level === "assisted")
                return (
                  <>
                    {assistedWarnings.length > 0 && (
                      <span
                        title={assistedWarnings.map((w) => w.text).join("\n")}
                        style={{ display: "inline-flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, color: role.priority.fill, fontWeight: 700 }}
                      >
                        <Icon name="check" size={14} color={role.priority.fill} />
                        {assistedWarnings[assistedWarnings.length - 1].text}
                      </span>
                    )}
                    {docWarnings.length > 0 && (
                      <span
                        title={docWarnings.map((w) => w.text).join("\n")}
                        style={{ display: "inline-flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}
                      >
                        <Icon name="error" size={14} color={role.index.fill} />
                        {docWarnings[docWarnings.length - 1].text}
                      </span>
                    )}
                    {pageWarnings.length > 0 && (
                      <span
                        title={pageWarnings.map((w) => w.text).join("\n")}
                        style={{ display: "inline-flex", alignItems: "center", gap: space(1), fontSize: type.size.xs, color: role.index.fill, fontWeight: 700 }}
                      >
                        <Icon name="error" size={14} color={role.index.fill} />
                        {uiPagesUsedFallback(uiLang, pageWarnings.length)}
                      </span>
                    )}
                  </>
                )
              })()}
              {garmentId === "custom" && customGarment && (
                <button
                  onClick={() => downloadGarmentFile(customGarment)}
                  title={ui.downloadGarmentFileTitle}
                  style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: C.white.hex, color: C.ink.hex, border: hair, fontSize: type.size.xs, cursor: "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}
                >
                  <Icon name="download" size={16} color={C.ink.hex} /> {ui.downloadGarmentFile}
                </button>
              )}
              {!factoryLanguages.includes(sourceLanguage) && (
                <button onClick={handleGenerateSource} disabled={documentPlanning} style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: documentPlanning ? C.canvas.hex : C.white.hex, color: documentPlanning ? "#9AA0AB" : C.ink.hex, border: hair, fontSize: type.size.xs, cursor: documentPlanning ? "wait" : "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Icon name="download" size={16} color={C.ink.hex} /> {ui.generateSourceSvg} [{sourceLanguage}]
                </button>
              )}
              {outputMode === "separate" ? factoryLanguages.map((l) => (
                <button key={l} onClick={() => handleGenerate(l)} disabled={documentPlanning || translating} style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: documentPlanning || translating ? C.canvas.hex : role.priority.fill, color: documentPlanning || translating ? "#9AA0AB" : role.priority.on, border: hair, borderColor: documentPlanning || translating ? "#C6CAD2" : role.priority.fill, fontSize: type.size.xs, cursor: documentPlanning || translating ? "wait" : "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Icon name="bolt" size={16} color={C.white.hex} /> {tl.gen} SVG [{l}]
                </button>
              )) : (
                <button onClick={handleGenerateMultilingual} disabled={documentPlanning || translating} style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(2)}px ${space(3)}px`, background: documentPlanning || translating ? C.canvas.hex : role.priority.fill, color: documentPlanning || translating ? "#9AA0AB" : role.priority.on, border: hair, fontSize: type.size.xs, cursor: documentPlanning || translating ? "wait" : "pointer", fontWeight: 700, fontFamily: type.fonts.ui, textTransform: "uppercase" }}>
                  <Icon name="translate" size={16} color={C.white.hex} /> {tl.gen} SVG [{factoryLanguages.join("+")}]
                </button>
              )}
            </div>
          </div>
          {viewAllPages ? (
            // "Ver todas" contact sheet - every page stacked in one scrollable
            // view instead of one tab at a time, for a final look-over pass.
            <div style={{ display: "flex", flexDirection: "column", gap: space(4), overflow: "auto", background: C.canvas.hex, padding: 10 }}>
              {plannedMode
                ? activePlannedPages.map((p, i) => (
                    <div key={i}>
                      <div style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, fontFamily: type.fonts.data, marginBottom: space(1) }}>
                        {i + 1}. {p.name}
                      </div>
                      <div style={{ width: PAGE.width * 0.54, height: PAGE.height * 0.54, position: "relative" }}>
                        <div
                          style={{ width: PAGE.width, height: PAGE.height, transformOrigin: "top left", transform: "scale(0.54)", background: C.white.hex, border: `1.5px solid ${C.ink.hex}`, overflow: "hidden" }}
                          dangerouslySetInnerHTML={{ __html: monoMode ? toGrayscale(p.svg) : p.svg }}
                        />
                      </div>
                    </div>
                  ))
                : allPgs.map((p) => (
                    <div key={p.i}>
                      <div style={{ fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, fontFamily: type.fonts.data, marginBottom: space(1) }}>{p.l}</div>
                      <div style={{ filter: monoMode ? "grayscale(1)" : "none" }}>
                        <Preview lang={prevLang} hdr={hdr} parts={parts} designs={designs} fabricColors={fabricColors} logo={logo} page={p.i} txCache={txCache} garment={garment} />
                      </div>
                    </div>
                  ))}
            </div>
          ) : plannedMode ? (
            <div style={{ overflow: "auto", background: C.canvas.hex, padding: 10 }}>
              {plannedPreviewError && (
                <div style={{ marginBottom: space(2), padding: space(2), border: hair, borderLeft: `${space(1)}px solid ${role.highlight.fill}`, background: C.white.hex, color: C.ink.hex, fontSize: type.size.xs }}>
                  {plannedPreviewError}
                </div>
              )}
              {activePlannedPage ? (
                <div style={{ width: PAGE.width * 0.54, height: PAGE.height * 0.54, position: "relative" }}>
                  <div
                    style={{ width: PAGE.width, height: PAGE.height, transformOrigin: "top left", transform: "scale(0.54)", background: C.white.hex, border: `1.5px solid ${C.ink.hex}`, overflow: "hidden" }}
                    dangerouslySetInnerHTML={{ __html: monoMode ? toGrayscale(activePlannedPage.svg) : activePlannedPage.svg }}
                  />
                </div>
              ) : (
                <div style={{ height: PAGE.height * 0.54, border: hair, background: C.white.hex, color: C.ink.hex, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: space(2) }}>
                  <div style={{ height: 6, width: 260, background: C.canvas.hex, border: hair }}>
                    <div style={{ height: "100%", width: documentPlanning ? "45%" : "0%", background: role.priority.fill }} />
                  </div>
                  <div style={{ fontSize: type.size.xs, fontFamily: type.fonts.data }}>{documentPlanStatus || ui.structuringDocument}</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ filter: monoMode ? "grayscale(1)" : "none" }}>
              <Preview lang={prevLang} hdr={hdr} parts={parts} designs={designs} fabricColors={fabricColors} logo={logo} page={prevPage} txCache={txCache} garment={garment} />
            </div>
          )}
        </div>
      )
    }

    if (step === 6) {
      const pn = garment.partLabels.ES
      const garmentTypeLabel = (garment.label && (garment.label.ES || Object.values(garment.label)[0])) || ""
      // Same lookup for both flows: the custom-chat garment sets `parts`
      // from its chat draft (handleGarmentChatComplete), a registered
      // garment's parts table is `parts` directly - one scan covers both,
      // same as seedSizesFromParts does on arrival at this step.
      const generalFields = parts.filter((p) => p.on && p.val).map((p) => ({ label: p.customName || pn[p.id] || "Pieza", val: p.val }))
      // The AI-planned document only ever replans against `committedSizeChart`
      // (see previewPlanKey) - this flags when the live edit is ahead of what
      // Vista Previa actually shows, and the cost of catching up (a real
      // outline replan) rather than hiding it.
      const hasUnappliedChanges = garmentId === "custom" && customGarment && JSON.stringify(sizeChart) !== JSON.stringify(committedSizeChart)
      // A local, zero-AI preview of just the size-chart page(s) - the exact
      // same pure renderSizeChart/sizeChartTableLayout the real document
      // uses, so what you see here is not a mockup, it just isn't full-page
      // paginated. Scaled the same way the Vista Previa page thumbnail is.
      const previewBox = { x: GRID.margin, y: GRID.margin + 40, width: PAGE.width - GRID.margin * 2 }
      const previewInner = hasSizeChartData(sizeChart) ? renderSizeChart(previewBox, { chart: sizeChart, outUnit: dimensionUnit, title: tl.sizeChartTitle }) : ""
      const previewSvg = previewInner
        ? "<svg viewBox='0 0 " + PAGE.width + " " + PAGE.height + "' xmlns='http://www.w3.org/2000/svg'><rect x='0' y='0' width='" + PAGE.width + "' height='" + PAGE.height + "' fill='" + C.white.hex + "'/>" + previewInner + "</svg>"
        : ""
      return (
        <div>
          <p style={{ marginBottom: space(3), fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, maxWidth: 560 }}>{ui.sizeChartHelp}</p>
          {garmentId !== "custom" && (
            <div style={{ marginBottom: space(3), display: "flex", alignItems: "flex-start", gap: space(2), padding: space(3), border: `1px dashed ${role.index.fill}`, background: C.white.hex, fontSize: type.size.xs, color: C.ink.hex }}>
              <Icon name="info" size={16} color={role.index.fill} />
              <span>{ui.sizeChartNotPrintedYet}</span>
            </div>
          )}
          <SizeChartEditor chart={sizeChart} onChange={setSizeChart} garmentType={garmentTypeLabel || "prenda"} generalFields={generalFields} />
          {previewSvg && (
            <div style={{ marginTop: space(4) }}>
              <div style={{ marginBottom: space(2), fontSize: type.size.xs, fontWeight: 700, color: C.ink.hex, textTransform: "uppercase" }}>{ui.localPreviewTitle}</div>
              <div style={{ width: PAGE.width * 0.54, height: PAGE.height * 0.54, position: "relative" }}>
                <div
                  style={{ width: PAGE.width, height: PAGE.height, transformOrigin: "top left", transform: "scale(0.54)", background: C.white.hex, border: `1.5px solid ${C.ink.hex}`, overflow: "hidden" }}
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
              </div>
            </div>
          )}
          {garmentId === "custom" && customGarment && (
            <div style={{ marginTop: space(4), display: "flex", alignItems: "center", gap: space(3), flexWrap: "wrap" }}>
              <button
                onClick={() => setCommittedSizeChart(sizeChart)}
                disabled={documentPlanning}
                style={{ ...primaryBtnStyle(!documentPlanning), cursor: documentPlanning ? "wait" : "pointer" }}
              >
                {documentPlanning ? ui.applyingChanges : ui.applyToDocument} <Icon name={documentPlanning ? "sync" : "arrow_forward"} size={18} color={C.white.hex} />
              </button>
              {documentPlanning && (
                <span style={{ fontSize: type.size.xs, color: C.ink.hex, opacity: 0.7, display: "inline-flex", alignItems: "center", gap: space(1) }}>
                  {documentPlanStatus || ui.structuringDocument}
                </span>
              )}
              {!documentPlanning && !hasUnappliedChanges && plannedPreviewPages && plannedPreviewKey === previewPlanKey && (
                <span style={{ fontSize: type.size.xs, color: "#2a7a2a", display: "inline-flex", alignItems: "center", gap: space(2) }}>
                  <Icon name="check_circle" size={16} color="#2a7a2a" /> {ui.documentUpdated}
                  <button onClick={() => setStep(5)} style={{ background: "none", border: "none", color: role.priority.fill, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: type.fonts.ui, fontSize: type.size.xs, textDecoration: "underline" }}>
                    {ui.viewInPreview}
                  </button>
                </span>
              )}
              {hasUnappliedChanges && (
                <span style={{ fontSize: type.size.xs, color: role.index.fill, display: "inline-flex", alignItems: "center", gap: space(1) }}>
                  <Icon name="warning" size={14} color={role.index.fill} /> {ui.unappliedChanges}
                </span>
              )}
            </div>
          )}
        </div>
      )
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.shell.hex, display: "flex", flexDirection: "column", alignItems: "center", padding: `${space(6)}px 4%`, fontFamily: type.fonts.ui, color: C.white.hex }}>
      {svgPages && <SvgModal pages={svgPages} onClose={() => setSvgPages(null)} uiLang={uiLang} />}
      {reviewFindings && <ReviewChat findings={reviewFindings} hdr={hdr} parts={parts} designs={designs} onComplete={finishReview} onSkip={skipReview} uiLang={uiLang} />}
      <div style={{ width: "100%", maxWidth: 960, marginBottom: space(3) }}>
        {/* Wordmark — Morfe mark in white on the black shell */}
        <div style={{ display: "flex", alignItems: "center", gap: space(3), marginBottom: space(3) }}>
          <MorfeLogo size={44} color={C.white.hex} />
          <div>
            <h1 style={{ margin: 0, fontSize: type.size.lg, fontFamily: type.fonts.display, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase", color: C.white.hex }}>TechPack AI Builder</h1>
            <p style={{ margin: 0, fontSize: type.size.xs, fontFamily: type.fonts.data, color: C.white.hex, opacity: 0.55 }}>por Morfe · Generador Open Source de Fichas Técnicas · v0.2</p>
          </div>
          {/* App UI language - independent of the export "Idioma" step below.
              Only ES/EN for now: the export table already covers ZH, but this
              is the builder's OWN chrome, not document content. */}
          <button
            onClick={() => setUiLang((l) => (l === "ES" ? "EN" : "ES"))}
            title={uiLang === "ES" ? "Switch app to English" : "Cambiar la app a español"}
            style={{ marginLeft: "auto", padding: `${space(1)}px ${space(2)}px`, border: `1px solid ${C.white.hex}`, background: "none", color: C.white.hex, fontSize: type.size.xs, fontFamily: type.fonts.data, textTransform: "uppercase", cursor: "pointer" }}
          >
            {uiLang === "ES" ? "EN" : "ES"}
          </button>
          {/* Color palette preset - which colors carry the index/priority/
              highlight roles across both screen and export. Independent of
              monoMode (a render-time grayscale toggle) and of uiLang. */}
          <select
            value={paletteName}
            onChange={(e) => choosePalette(e.target.value)}
            title={uiLang === "ES" ? "Paleta de colores" : "Color palette"}
            style={{ padding: `${space(1)}px ${space(2)}px`, border: `1px solid ${C.white.hex}`, background: C.shell.hex, color: C.white.hex, fontSize: type.size.xs, fontFamily: type.fonts.data, textTransform: "uppercase", cursor: "pointer" }}
          >
            {getPaletteNames().map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {/* The badge already says WHICH build you are in, so it doubles as
              the way to reach the other one - studio.html was deployed but
              unreachable, with no link to it anywhere. BASE_URL keeps this
              correct under the repo-name base path on Pages and at '/' in dev. */}
          <a
            href={import.meta.env.BASE_URL + (textAIProvider === "local" ? "index.html" : "studio.html")}
            title={textAIProvider === "local" ? ui.goToPublic : ui.goToStudio}
            style={{ display: "inline-flex", alignItems: "center", gap: space(1), padding: `${space(1)}px ${space(2)}px`, border: `1px solid ${localAIStatus === "ready" ? role.highlight.fill : C.white.hex}`, color: C.white.hex, fontSize: type.size.xs, fontFamily: type.fonts.data, textTransform: "uppercase", textDecoration: "none" }}
          >
            {textAIProvider === "local" ? `Studio AI · ${localAIStatus === "ready" ? localProviderLabel(localAIModel) + " " + ui.ready : localAIStatus === "offline" ? ui.offline : ui.loading}` : "AI · NVIDIA"}
            <span style={{ opacity: 0.55 }}>{textAIProvider === "local" ? ui.toPublic : ui.toStudio}</span>
          </a>
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
          {step < 6 ? (
            <button onClick={() => { if (canNext()) setStep((s) => s + 1) }} disabled={!canNext()} style={primaryBtnStyle(canNext())}>
              {step === 4 ? tl.gen : tl.nxt} <Icon name="arrow_forward" size={18} color={canNext() ? C.white.hex : "#9AA0AB"} />
            </button>
          ) : (
            // Tallaje (the new last step) puts its own primary action
            // ("Aplicar al documento") inline in the step content, next to
            // the chart it applies - repeating it here would be a second,
            // redundant button for the same action.
            <span />
          )}
        </div>
      </div>
    </div>
  )
}
