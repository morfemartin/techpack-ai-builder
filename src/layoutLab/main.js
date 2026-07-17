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
import { planDocumentOutline, planPageLayout } from "../core/documentPlan.js"
import { validateOutline, validatePage } from "../pages/pageContracts.js"
import { COL } from "../design/metrics.js"
import { FIXTURES } from "./fixtures.js"
import { DATASETS, ctxFor } from "./datasets.js"

const PAGE_W = 1200
const PAGE_H = 900
const PAGE_PAD = 26

const state = { mono: false, grid: false, tab: "design", aiDataset: "parka", aiPages: null, aiLog: [], aiRunning: false }

// Grid overlay in page coordinates: the outer margin, a whole-pixel baseline
// every 32px (ROW.table), and the shared COL column stops (index/label/value)
// as vertical guides - so a block's rules and text can be checked against the
// exact template every renderer now shares.
function gridOverlay() {
  const inner = PAGE_W - PAGE_PAD * 2
  let rows = ""
  for (let y = PAGE_PAD; y <= PAGE_H - PAGE_PAD; y += 32) {
    rows += `<line x1="${PAGE_PAD}" y1="${y}" x2="${PAGE_W - PAGE_PAD}" y2="${y}" stroke="#E5352B" stroke-width="0.4" opacity="0.22"/>`
  }
  let stops = ""
  for (const frac of [COL.index, COL.label, COL.value]) {
    const x = PAGE_PAD + inner * frac
    stops += `<line x1="${x.toFixed(1)}" y1="${PAGE_PAD}" x2="${x.toFixed(1)}" y2="${PAGE_H - PAGE_PAD}" stroke="#1A3FB0" stroke-width="0.5" opacity="0.3" stroke-dasharray="4,4"/>`
  }
  const margin = `<rect x="${PAGE_PAD}" y="${PAGE_PAD}" width="${inner}" height="${PAGE_H - PAGE_PAD * 2}" fill="none" stroke="#E5352B" stroke-width="0.8" opacity="0.5"/>`
  return `<svg class="overlay" viewBox="0 0 ${PAGE_W} ${PAGE_H}" preserveAspectRatio="xMidYMid meet">${rows}${stops}${margin}</svg>`
}

function pageFigure(p) {
  return `
    <figure class="page">
      <div class="page-frame">
        ${p.svg}
        ${state.grid ? gridOverlay() : ""}
      </div>
      <figcaption>${p.name}</figcaption>
    </figure>`
}

function renderFixture(fx) {
  const dataset = DATASETS[fx.dataset]
  let pagesHtml = ""
  let error = ""
  try {
    const pages = buildPlannedPages(fx.plan, ctxFor(dataset), { mono: state.mono })
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
      ${error}
      <div class="pages">${pagesHtml}</div>
    </section>`
}

function designTab() {
  return `<main>${FIXTURES.map(renderFixture).join("")}</main>`
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
  const planCtx = { garmentType: dataset.label, parts: dataset.parts, designs: dataset.designs, lang: "ES" }
  state.aiRunning = true
  state.aiPages = null
  state.aiLog = ["Outline: asking the model which pages the document needs…"]
  render()
  try {
    const outline = await planDocumentOutline(planCtx)
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
        p = await planPageLayout(page, planCtx)
      } catch (e) {
        p = { ...page, regions: [{ type: "header", weight: 10 }, { type: "illustration", weight: 60, slots: 1 }, { type: "disclaimer", weight: 8 }] }
        state.aiLog[state.aiLog.length - 1] += " (fell back)"
      }
      const viol = validatePage(p, planCtx)
      state.aiLog[state.aiLog.length - 1] = `Page ${i + 1}/${outline.pages.length} (${page.purpose}): ${p.regions.map((r) => r.type).join(", ")} · contract clean: ${viol.length === 0 ? "yes" : "NO"}`
      planned.push(p)
      state.aiPages = buildPlannedPages({ pages: planned }, ctx, { mono: state.mono })
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
        <button class="tab ${state.tab === "ai" ? "on" : ""}" id="tab-ai">AI plan</button>
        <label><input type="checkbox" id="t-mono" ${state.mono ? "checked" : ""}/> Grayscale</label>
        <label><input type="checkbox" id="t-grid" ${state.grid ? "checked" : ""}/> Grid</label>
      </div>
      <nav class="toc">${toc}</nav>
    </header>
    ${state.tab === "design" ? designTab() : aiTab()}`

  document.getElementById("tab-design").addEventListener("click", () => { state.tab = "design"; render() })
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
