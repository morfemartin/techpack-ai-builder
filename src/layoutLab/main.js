// ─────────────────────────────────────────────────────────────────────────
// LAYOUT LAB · Harness (Fase 1 — sistema de diseño aislado)
//
// Renderiza cada fixture con buildPlannedPages (100% determinístico, sin IA
// ni red) para inspeccionar el motor de layout. Controles: escala de grises
// y una grilla superpuesta (12 columnas + baseline) para evaluar alineación.
//
// Servido por Vite en /layout-lab.html — HMR activo: editar datasets.js o
// fixtures.js actualiza en vivo.
// ─────────────────────────────────────────────────────────────────────────

import { buildPlannedPages } from "../pages/interpretPlan.js"
import { FIXTURES } from "./fixtures.js"
import { DATASETS, ctxFor } from "./datasets.js"

const PAGE_W = 1200
const PAGE_H = 900
const PAGE_PAD = 26
const GRID_COLS = 12
const GRID_GUTTER = 14

const state = { mono: false, grid: false }

// SVG de grilla superpuesto, mismo viewBox 1200x900 que la página: márgenes
// exteriores (PAGE_PAD) + 12 columnas con gutter, y baseline horizontal cada
// 30px. Se dibuja ENCIMA de cada página para juzgar alineación a ojo.
function gridOverlay() {
  const inner = PAGE_W - PAGE_PAD * 2
  const col = (inner - GRID_GUTTER * (GRID_COLS - 1)) / GRID_COLS
  let cols = ""
  for (let i = 0; i < GRID_COLS; i++) {
    const x = PAGE_PAD + i * (col + GRID_GUTTER)
    cols += `<rect x="${x.toFixed(1)}" y="${PAGE_PAD}" width="${col.toFixed(1)}" height="${PAGE_H - PAGE_PAD * 2}" fill="#1A3FB0" opacity="0.06"/>`
  }
  let rows = ""
  for (let y = PAGE_PAD; y <= PAGE_H - PAGE_PAD; y += 30) {
    rows += `<line x1="${PAGE_PAD}" y1="${y}" x2="${PAGE_W - PAGE_PAD}" y2="${y}" stroke="#E5352B" stroke-width="0.4" opacity="0.28"/>`
  }
  const margin = `<rect x="${PAGE_PAD}" y="${PAGE_PAD}" width="${inner}" height="${PAGE_H - PAGE_PAD * 2}" fill="none" stroke="#E5352B" stroke-width="0.8" opacity="0.5"/>`
  return `<svg class="overlay" viewBox="0 0 ${PAGE_W} ${PAGE_H}" preserveAspectRatio="xMidYMid meet">${cols}${rows}${margin}</svg>`
}

function renderFixture(fx) {
  const dataset = DATASETS[fx.dataset]
  let pagesHtml = ""
  let error = ""
  try {
    const pages = buildPlannedPages(fx.plan, ctxFor(dataset), { mono: state.mono })
    pagesHtml = pages
      .map(
        (p) => `
        <figure class="page">
          <div class="page-frame">
            ${p.svg}
            ${state.grid ? gridOverlay() : ""}
          </div>
          <figcaption>${p.name}</figcaption>
        </figure>`
      )
      .join("")
  } catch (e) {
    error = `<div class="err">Error al renderizar: ${String((e && e.message) || e)}</div>`
  }

  return `
    <section class="fixture" id="fx-${fx.id}">
      <div class="fx-head">
        <h2>${fx.title}</h2>
        <span class="chip">${dataset.label}</span>
      </div>
      <dl class="meta">
        <div><dt>Prueba</dt><dd>${fx.tests}</dd></div>
        <div><dt>Esperado</dt><dd>${fx.expected}</dd></div>
      </dl>
      ${error}
      <div class="pages">${pagesHtml}</div>
    </section>`
}

function render() {
  const app = document.getElementById("app")
  const toc = FIXTURES.map((fx) => `<a href="#fx-${fx.id}">${fx.id}</a>`).join("")
  app.innerHTML = `
    <header class="lab-head">
      <div class="title">
        <h1>Layout Lab</h1>
        <p>Fase 1 · Sistema de diseño aislado — sin IA, sin red, 100% determinístico</p>
      </div>
      <div class="controls">
        <label><input type="checkbox" id="t-mono" ${state.mono ? "checked" : ""}/> Escala de grises</label>
        <label><input type="checkbox" id="t-grid" ${state.grid ? "checked" : ""}/> Grilla</label>
      </div>
      <nav class="toc">${toc}</nav>
    </header>
    <main>${FIXTURES.map(renderFixture).join("")}</main>`

  document.getElementById("t-mono").addEventListener("change", (e) => {
    state.mono = e.target.checked
    render()
  })
  document.getElementById("t-grid").addEventListener("change", (e) => {
    state.grid = e.target.checked
    render()
  })
}

render()

if (import.meta.hot) import.meta.hot.accept()
