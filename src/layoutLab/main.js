// ─────────────────────────────────────────────────────────────────────────
// LAYOUT LAB · Harness
//
// Two tabs:
//  · "Design system" (Phase 1) — renders fixed fixtures with buildPlannedPages,
//    100% deterministic, no AI, no network. For inspecting the layout engine
//    (alignment, dead space, the row-vs-stack compositor).
//  · "AI plan" (Phase 2) — runs the REAL pipeline (planDocumentOutline +
//    planPageLayout + the page contracts) against a chosen dataset through the
//    dev proxy, so the whole plan→contract→render path can be watched end to
//    end without the six-step wizard. Needs the dev server (npm run dev).
//
// Grid overlay draws the shared column template (metrics.js COL) + a whole-
// pixel baseline so P1 alignment is verifiable against the actual metrics.
// ─────────────────────────────────────────────────────────────────────────

import { buildPlannedPages } from "../pages/interpretPlan.js"
import { fallbackDocumentOutline, planDocumentOutline, planPageLayout } from "../core/documentPlan.js"
import { repairPage, validateOutline, validatePage } from "../pages/pageContracts.js"
import { buildReviewFindings, summarizeConfirmed } from "../core/reviewDiff.js"
import { auditSemanticCoverage } from "../core/semanticOutline.js"
import { renderGridOverlay } from "./gridOverlay.js"
import { FIXTURES } from "./fixtures.js"
import { DATASETS, ctxFor } from "./datasets.js"
import { ctxForFixture } from "./fixtureContext.js"

const state = { mono: false, grid: false, tab: "design", aiDataset: "traverseCargoBenchmark", aiPages: null, aiLog: [], aiRunning: false }
const AI_OUTLINE_TIMEOUT_MS = 12000
const AI_PAGE_TIMEOUT_MS = 10000

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timed out after " + Math.round(ms / 1000) + "s")), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function pageFigure(p) {
  return `
    <figure class="page">
      <div class="page-frame">
        ${p.svg}
        ${state.grid ? renderGridOverlay() : ""}
      </div>
      <figcaption>${p.name}</figcaption>
    </figure>`
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderFixture(fx) {
  const dataset = DATASETS[fx.dataset]
  let pagesHtml = ""
  let error = ""
  let diagnostics = []
  try {
    const ctx = { ...ctxForFixture(fx), documentMode: "illustration-handoff" }
    let plan = fx.plan
    if (fx.contractRepair) {
      plan = {
        pages: fx.plan.pages.map((page) => {
          const result = repairPage(page, ctx)
          diagnostics.push(...result.repairs.map((repair) => "contract: " + repair))
          const violations = validatePage(result.page, ctx)
          diagnostics.push("contract clean after repair: " + (violations.length === 0 ? "yes" : "NO"))
          return result.page
        }),
      }
    }
    if (fx.reviewSample) {
      const findings = buildReviewFindings(ctx, plan)
      const confirmed = summarizeConfirmed(findings)
      diagnostics.push(`confirmed: ${confirmed.header} header · ${confirmed.parts} parts · ${confirmed.designs} designs`)
      findings
        .filter((finding) => finding.kind !== "confirmed")
        .forEach((finding) => diagnostics.push(`${finding.kind}: ${finding.topic}:${finding.field}`))
    }
    if (fx.semanticAudit) {
      const coverage = auditSemanticCoverage(plan, ctx.parts)
      diagnostics.push(`semantic coverage: ${coverage.covered.length}/${ctx.parts.filter((part) => part.on !== false).length} exactly once · missing ${coverage.missing.length} · duplicated ${coverage.duplicated.length}`)
      plan.pages.filter((page) => Array.isArray(page.pieces)).forEach((page) => {
        diagnostics.push(`${page.id}: ${page.pieces.length} pieces · ${page.objective || "no objective"}`)
      })
    }
    const pages = buildPlannedPages(plan, ctx, { mono: state.mono, documentMode: "illustration-handoff", includeIndex: !!fx.includeIndex })
    pages.forEach((renderedPage, index) => {
      const decision = renderedPage.compositionDecision
      if (!decision) return
      if (decision.mode === "unchanged") return
      const widths = Array.isArray(decision.widths) ? " · widths " + decision.widths.map((value) => Math.round(value)).join("/") + "px" : ""
      diagnostics.push(
        `composition physical page ${index + 1}: ${decision.mode} · complete ${decision.complete ? "yes" : "NO"} · overflow ${Math.round(decision.overflow || 0)}px · smallest artboard ${Math.round(decision.smallestIllustrationArea || 0)}px² · unused page ${Math.round(decision.unusedPageArea || 0)}px² · illustration total ${Math.round(decision.illustrationArea || 0)}px²${widths}`
      )
      diagnostics.push("reason: " + decision.reason)
      ;(decision.candidates || []).forEach((candidate) => {
        diagnostics.push(`candidate ${candidate.mode}: ${candidate.valid ? "VALID" : "rejected"} · complete ${candidate.complete ? "yes" : "NO"} · slots ${candidate.slotValid ? "yes" : "NO"} · overflow ${candidate.overflow || 0}px · smallest artboard ${candidate.smallestIllustrationArea || 0}px² · unused page ${candidate.unusedPageArea || 0}px² · art total ${candidate.illustrationArea || 0}px² · data waste ${candidate.wastedDataArea || 0}px²`)
      })
    })
    pagesHtml = pages.map(pageFigure).join("")
  } catch (e) {
    error = `<div class="err">Error al renderizar: ${String((e && e.message) || e)}</div>`
  }
  return `
    <section class="fixture" id="fx-${fx.id}">
      <div class="fx-head"><h2>${fx.title}</h2><span class="chip">${dataset.label}</span></div>
      <dl class="meta">
        <div><dt>Tests</dt><dd>${fx.tests}</dd></div>
        <div><dt>Expected</dt><dd>${fx.expected}</dd></div>
      </dl>
      ${diagnostics.length ? `<details class="diagnostics"><summary>Diagnostico matematico · ${diagnostics.length} decisiones</summary>${diagnostics.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</details>` : ""}
      ${error}
      <div class="pages">${pagesHtml}</div>
    </section>`
}

function designTab() {
  return `<main>${FIXTURES.map(renderFixture).join("")}</main>`
}

function dataTable(headers, rows) {
  return `<div class="brief-table-wrap"><table class="brief-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
}

function bulletList(items) {
  return `<ul>${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
}

function benchmarkBriefTab() {
  const dataset = DATASETS.traverseCargoBenchmark
  const brief = dataset.brief
  const partGroups = dataset.parts.reduce((groups, part) => {
    if (!groups[part.system]) groups[part.system] = []
    groups[part.system].push(part)
    return groups
  }, {})
  const groupNames = {
    "waist-fly": "S01 - Pretina y bragueta",
    "upper-body": "S02 - Cuerpo superior y movilidad",
    pockets: "S03 - Bolsillos",
    "zip-off": "S04 - Interfaz convertible zip-off",
    "lower-leg": "S05 - Piernas inferiores, rodillas y bajos",
  }
  return `<main class="brief-main">
    <section class="fixture brief-hero">
      <div class="fx-head"><h2>${escapeHtml(dataset.hdr.pname)}</h2><span class="chip">FUENTE DE VERDAD</span></div>
      <p>${escapeHtml(dataset.note)}</p>
      <div class="brief-metrics"><strong>${dataset.parts.length} piezas</strong><strong>${brief.materials.length} materiales</strong><strong>${brief.trims.length} avios</strong><strong>${dataset.designs.length} aplicaciones</strong><strong>${brief.measurements.poms.length} POM</strong></div>
    </section>
    <section class="brief-section"><h2>Producto</h2>${dataTable(["Campo", "Dato"], [
      ["Style", dataset.hdr.sno], ["Categoria", dataset.hdr.cat], ["Uso", brief.product.use], ["Usuario", brief.product.user],
      ["Tallas", brief.product.sizes.join(", ")], ["Base", brief.product.baseSize], ["Proteccion", brief.product.protection], ["Transformacion", brief.product.transformation],
    ])}<h3>Prioridades</h3>${bulletList(brief.product.priorities)}</section>
    <section class="brief-section"><h2>Materiales</h2>${dataTable(["ID", "Material", "Especificacion"], brief.materials.map((item) => [item.id, item.name, item.spec]))}</section>
    <section class="brief-section"><h2>Avios</h2>${dataTable(["ID", "Especificacion"], brief.trims.map((item) => [item.id, item.spec]))}</section>
    <section class="brief-section"><h2>Colorways</h2>${dataTable(["Codigo", "Principal", "Refuerzo", "Avios", "Hilo"], brief.colorways.map((item) => [item.id, item.F01, item.F02, item.trims, item.thread]))}</section>
    <section class="brief-section"><h2>Mapa de piezas</h2>${Object.entries(partGroups).map(([system, items]) => `<h3>${escapeHtml(groupNames[system] || system)} - ${items.length} piezas</h3>${dataTable(["ID", "Pieza", "Material", "Corte", "Construccion"], items.map((item) => [item.id, item.label, item.material, item.cut, item.construction]))}`).join("")}</section>
    <section class="brief-section"><h2>Aplicaciones</h2>${dataset.designs.map((design) => `<article class="brief-design"><h3>${escapeHtml(design.id + " - " + design.name)}</h3>${dataTable(["Campo", "Dato"], [["Posicion", design.pos], ["Landmark", design.posDetail], ["Tecnica", design.tec], ["Medida", design.w + " x " + design.h + " mm"], ["Archivo", design.fileName]])}</article>`).join("")}</section>
    <section class="brief-section"><h2>Construccion</h2><h3>Costuras</h3>${bulletList(brief.construction.seams)}<h3>Presillas</h3>${bulletList(brief.construction.bartacks)}<h3>Orden critico</h3>${bulletList(brief.construction.criticalOrder)}</section>
    <section class="brief-section"><h2>Medidas - talla base ${brief.measurements.baseSize}</h2>${dataTable(["ID", "POM", "Valor", "Tolerancia"], brief.measurements.poms.map((item) => [item.id, item.name, item.value, item.tolerance]))}<h3>Gradacion</h3>${bulletList(brief.measurements.grading)}<p class="pending">${escapeHtml(brief.measurements.status)}</p></section>
    <section class="brief-section"><h2>Etiquetado y empaque</h2><h3>Etiquetas</h3>${bulletList(brief.labelsAndPackaging.labels)}<h3>Empaque</h3>${bulletList(brief.labelsAndPackaging.pack)}</section>
    <section class="brief-section"><h2>Control de calidad</h2>${bulletList(brief.quality)}</section>
    <section class="brief-section pending-section"><h2>Pendiente de confirmar - DeepSeek no puede inferir</h2>${bulletList(brief.openPoints)}</section>
  </main>`
}

function aiTab() {
  const options = Object.keys(DATASETS)
    .map((k) => `<option value="${k}" ${state.aiDataset === k ? "selected" : ""}>${DATASETS[k].label}</option>`)
    .join("")
  const log = state.aiLog.map((l) => `<div class="log-line">${l}</div>`).join("")
  const pages = state.aiPages ? `<div class="pages">${state.aiPages.map(pageFigure).join("")}</div>` : ""
  return `
    <main>
      <section class="fixture">
        <div class="fx-head"><h2>AI plan · end-to-end pipeline</h2></div>
        <dl class="meta">
          <div><dt>What</dt><dd>Runs the real planDocumentOutline + planPageLayout + page contracts against a dataset through the dev proxy — the plan the AI actually produces, contract-repaired and rendered. Needs <code>npm run dev</code>.</dd></div>
        </dl>
        <div class="ai-controls">
          <select id="ai-dataset">${options}</select>
          <button id="ai-run" ${state.aiRunning ? "disabled" : ""}>${state.aiRunning ? "Planning…" : "Plan with AI"}</button>
        </div>
        <div class="ai-log">${log}</div>
        ${pages}
      </section>
    </main>`
}

async function runAiPlan() {
  const key = state.aiDataset
  const dataset = DATASETS[key]
  const ctx = ctxFor(dataset)
  const planCtx = { garmentType: dataset.label, parts: dataset.parts, designs: dataset.designs, brief: dataset.brief, lang: "ES" }
  state.aiRunning = true
  state.aiPages = null
  state.aiLog = ["Outline: asking the model which pages the document needs…"]
  render()
  try {
    let outline
    try {
      outline = await withTimeout(planDocumentOutline(planCtx), AI_OUTLINE_TIMEOUT_MS, "Outline")
    } catch (e) {
      outline = fallbackDocumentOutline(planCtx)
      state.aiLog.push(`Outline: ${String((e && e.message) || e)} · using contract fallback [${outline.pages.map((p) => p.purpose).join(", ")}]`)
      render()
    }
    const outlineViolations = validateOutline(outline, planCtx)
    state.aiLog.push(`Outline: ${outline.pages.length} pages [${outline.pages.map((p) => p.purpose).join(", ")}] · contract clean after repair: ${outlineViolations.length === 0 ? "yes" : "NO (" + outlineViolations.length + ")"}`)
    render()
    const planned = []
    for (let i = 0; i < outline.pages.length; i++) {
      const page = outline.pages[i]
      state.aiLog.push(`Page ${i + 1}/${outline.pages.length} (${page.purpose}): laying out…`)
      render()
      let p
      try {
        p = await withTimeout(planPageLayout(page, planCtx), AI_PAGE_TIMEOUT_MS, "Page " + (i + 1))
      } catch (e) {
        p = repairPage(
          { ...page, regions: [{ type: "header", weight: 10 }, { type: "illustration", weight: 60, slots: 1 }, { type: "disclaimer", weight: 8 }] },
          planCtx
        ).page
        state.aiLog[state.aiLog.length - 1] += " (" + String((e && e.message) || e) + " · fell back)"
      }
      const viol = validatePage(p, planCtx)
      state.aiLog[state.aiLog.length - 1] = `Page ${i + 1}/${outline.pages.length} (${page.purpose}): ${p.regions.map((r) => r.type).join(", ")} · contract clean: ${viol.length === 0 ? "yes" : "NO"}`
      planned.push(p)
      state.aiPages = buildPlannedPages({ pages: planned }, ctx, { mono: state.mono, documentMode: "illustration-handoff", includeIndex: true })
      render()
    }
    state.aiLog.push("Done.")
  } catch (e) {
    state.aiLog.push(`Error: ${String((e && e.message) || e)}`)
  } finally {
    state.aiRunning = false
    render()
  }
}

function render() {
  const app = document.getElementById("app")
  const toc = state.tab === "design" ? FIXTURES.map((fx) => `<a href="#fx-${fx.id}">${fx.id}</a>`).join("") : ""
  app.innerHTML = `
    <header class="lab-head">
      <div class="title">
        <h1>Layout Lab</h1>
        <p>Design-system harness — deterministic fixtures + live AI-plan pipeline</p>
      </div>
      <div class="controls">
        <button class="tab ${state.tab === "design" ? "on" : ""}" id="tab-design">Design system</button>
        <button class="tab ${state.tab === "brief" ? "on" : ""}" id="tab-brief">Benchmark brief</button>
        <button class="tab ${state.tab === "ai" ? "on" : ""}" id="tab-ai">AI plan</button>
        <label><input type="checkbox" id="t-mono" ${state.mono ? "checked" : ""}/> Grayscale</label>
        <label><input type="checkbox" id="t-grid" ${state.grid ? "checked" : ""}/> Grid</label>
      </div>
      <nav class="toc">${toc}</nav>
    </header>
    ${state.tab === "design" ? designTab() : state.tab === "brief" ? benchmarkBriefTab() : aiTab()}`

  document.getElementById("tab-design").addEventListener("click", () => { state.tab = "design"; render() })
  document.getElementById("tab-brief").addEventListener("click", () => { state.tab = "brief"; render() })
  document.getElementById("tab-ai").addEventListener("click", () => { state.tab = "ai"; render() })
  document.getElementById("t-mono").addEventListener("change", (e) => { state.mono = e.target.checked; render() })
  document.getElementById("t-grid").addEventListener("change", (e) => { state.grid = e.target.checked; render() })
  const sel = document.getElementById("ai-dataset")
  if (sel) sel.addEventListener("change", (e) => { state.aiDataset = e.target.value })
  const run = document.getElementById("ai-run")
  if (run) run.addEventListener("click", runAiPlan)
}

render()

if (import.meta.hot) import.meta.hot.accept()
