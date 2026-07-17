# Layout Lab

A developer-only harness for testing the tech-pack **layout engine in isolation** — no AI, no network, no six-step wizard, no chat. It renders the real page compositor against fixed inputs so layout behavior (grid, alignment, whitespace, and the row-vs-stack decision) can be inspected deterministically and reviewed visually.

> Open it with the dev server running: **`npm run dev`** → [http://localhost:3001/layout-lab.html](http://localhost:3001/layout-lab.html)
> It is **not** part of the production build — `vite build` only bundles `index.html`.

---

## Why this exists

A generated tech-pack page is produced in two independent stages:

1. **The plan** — *which* regions a page has, their weights, and how they compose (e.g. a `split` placing a narrow parts list beside a wide illustration). This is authored by the AI (`documentPlan.js`).
2. **The layout** — *how* those regions resolve into absolute boxes on a 1200×900 artboard, via the deterministic flex solver (`src/layout/solve.js`) and the page interpreter (`src/pages/interpretPlan.js`).

When a page looks wrong, the first question is always: *is it a bad plan, or a bad layout?* You can't answer that while the plan is coming from a live, non-deterministic model that is also subject to network timeouts. So the Lab freezes stage 1 with hand-written **fixtures** and exercises only stage 2. Same inputs, same output, every time.

This is **Phase 1** of a two-phase test plan:

| Phase | What's fixed | What's tested | AI / network |
| --- | --- | --- | --- |
| **1 · Design system** (this doc) | The plan (hand-written fixtures) | The layout engine only | None |
| **2 · Plan + design** (next) | Only the garment datasets | The AI planner **and** the layout | AI planner, no wizard/chat |

Phase 2 reuses the exact same garment datasets but lets `planDocumentOutline` + `planPageLayout` generate the plan, so the whole pipeline is exercised while still skipping the questionnaire and the chat.

---

## What's in it

- **`datasets.js`** — 5 complex garments with unique designs, each defining the `ctx` (header, parts, designs) the engine consumes: a technical 3-in-1 parka, an oversized hoodie, a pleated midi skirt, a wool/leather varsity jacket, and a sublimated bikini set.
- **`fixtures.js`** — 9 scenario plans, each pinned to a dataset and labelled with **what it tests** and the **expected** result.
- **`main.js`** — renders every fixture with `buildPlannedPages(...)`, plus **grayscale** and **grid-overlay** toggles (the overlay draws a 12-column grid + baseline + margin so alignment can be judged by eye).

---

## The compositor decision this Lab drove

The layout engine has a **content-aware split compositor**. A `split` region normally lays its children side by side (a parts list beside an illustration — the real tech-pack idiom). But when a `split` pairs an illustration with a **short** block, stretching that block into a full-height side column leaves an obvious band of dead white space. The compositor detects this ahead of time (it estimates the block's natural height from its data volume) and, when the block would fill less than half its column, **stacks** instead: illustration on top at full width, the block below at its natural height.

The Lab surfaced a subtlety that decided *which* blocks are allowed to stack.

### Parts list → stacks (good)

A parts-list row is a wide, three-column record (`#` / spec / detail) that reads well stretched to the full page width. A one-row table becomes a clean full-width strip under the illustration, no wasted space:

![Short parts list stacks as a full-width strip under the illustration](./img/b-stack.png)

### Color / embroidery specs → do **not** stack

A color card is the opposite: narrow, left-weighted content (a swatch + one line per color). Stacking it full width doesn't remove the dead space — it just **moves it from below a side column to the right of a wide band**, which looks worse:

| Before — color card stacked full width (dead space at right) | After — color card kept as a side column |
| --- | --- |
| ![10-color card stacked full width, ~85% of the band empty on the right](./img/c-before.png) | ![Same 10-color card as a narrow side column beside the illustration](./img/c-after.png) |

So stacking is restricted to `STACKABLE_TYPES` (currently `partsList`). Color and embroidery specs stay as side columns — their tech-pack idiom — even when short, accepting some room beneath them, which reads as designed rather than as an error. The rule lives in `src/pages/interpretPlan.js` and is locked by unit tests in `interpretPlan.test.js`.

---

## Fixture matrix

Compositor decision was verified against the layout tree directly, not by eye.

| Fixture | Garment | Tests | Result |
| --- | --- | --- | --- |
| **A** · split row | Parka (16 parts) | Full parts list beside illustration | **Row** — table fills its column |
| **B** · split stack | Bikini (1 part) | Very short parts list beside illustration | **Stack** — full-width strip below |
| **C** · colorSpecs heavy | Skirt (10 colorways) | Heavy color card beside illustration | **Row** — side column |
| **C2** · colorSpecs short | Skirt (2 colorways) | Short color card | **Row** — stays a side column (by design) |
| **D** · embSpecs heavy | Hoodie | Embroidery sheet beside illustration | **Row** — side column |
| **E** · illustration grid | Varsity (4 views) | 2×2 illustration grid + short parts list | **Stack** — grid on top, strip below |
| **F** · pagination | Parka (16 parts) | Parts list in a short band | **2 pages** — continues 1…16, nothing dropped |
| **G** · note block | Bikini | Note band + full-width illustration | No split — note over illustration |
| **H** · full document | Varsity | 4-page doc (overview + 3 designs) | Coherent; each design uses its own data |

A few of the results rendered:

| A · row (parts list fills column) | E · 2×2 illustration grid + short strip |
| --- | --- |
| ![Parka overview, parts list beside illustration](./img/a-row.png) | ![Varsity four-view grid over a short parts strip](./img/e-grid.png) |

| D · embroidery sheet as side column | F · paginated BOM (page 2 of 2) |
| --- | --- |
| ![Hoodie embroidery spec sheet beside illustration](./img/d-emb.png) | ![Second page of a paginated bill of materials](./img/f-pagination-2.png) |

---

## AI-plan tab (Phase 2)

The **AI plan** tab runs the real pipeline — `planDocumentOutline` +
`planPageLayout` + the page contracts — against a chosen dataset through the
dev proxy, so the whole plan → contract → render path can be watched end to
end without the six-step wizard. Pick a garment, hit **Plan with AI**, and the
log shows each outline and per-page call, whether the contract validated
clean after repair, and the rendered pages as they arrive. (Needs `npm run
dev` and a working DeepSeek proxy; it degrades to a logged error if the
upstream times out.)

The **Grid** toggle overlays the shared `COL` column template (blue dashed
guides) and a whole-pixel baseline, so P1 alignment can be checked against the
exact metrics every renderer now shares.

See [../layout-contracts.md](../layout-contracts.md) for the full architecture
behind these tabs.

## Adding a scenario

1. Add or extend a garment in `datasets.js` (it only needs `hdr`, `parts`, `designs`, `garment.partLabels`).
2. Add a fixture in `fixtures.js` with a `plan` (pages → regions, using the closed vocabulary in `interpretPlan.js`: `header, titleBar, illustration, partsList, colorSpecs, embSpecs, note, spacer, disclaimer`, plus the `split` composite) and fill in `tests` / `expected`.
3. Reload the Lab — Vite HMR picks it up live.
