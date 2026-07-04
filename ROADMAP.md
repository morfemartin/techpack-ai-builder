# Roadmap

## v0.1 (shipped)
- [x] Multi-garment architecture (`src/garments/*.js` registry instead of hardcoded cap data)
- [x] First fully-supported garment: **Cap** (parts spec sheet, 4-view diagram with callouts, per-design Pantone/Madeira color specs, embroidery tech sheet, PDF-derived embroidery extraction, ES/EN/ZH export)

## v0.2 — AI intake + flexible layout engine (in progress)
The big shift: from a **fixed** coordinate layout to an **AI-driven, flexbox-style**
tech pack generator. Two pillars, built on a hardened, secret-safe backend.

### Design system — Bauhaus, computationally semantic (`src/design/`)
- [x] Single-source design tokens (`src/design/tokens.js`) → injected CSS vars + imported by SVG builders, so UI and printed page share one palette/type/grid
- [x] **Computational color model:** color = attention role, not decoration — red = numeric index markers, blue = priority blocks (white text), yellow = small high-priority highlights (always keylined), ink/white = 80% structure
- [x] Palette tuned to stay legible in **black & white / photocopy** (distinct grayscale levels); printable surface is pure white
- [x] Two typefaces / three roles, both **system fonts** (no webfont download): Helvetica/Arial (display+ui) + native OS monospace (data); Material Symbols icons (the one true webfont - it's an icon set, no system equivalent), zero emojis, zero border-radius
- [x] Layout engine extended to resolve **percentage** basis/gap/padding — the "márgenes por porcentaje entre retículas"
- [x] Recolor the generated SVG pages with the same role tokens (the printed tech pack, not just the wizard UI)

### Phase 0 — Security & backend scaffold
- [x] Server-side proxy (`api/deepseek.js`) so the NVIDIA/DeepSeek key never reaches the browser
- [x] `SECURITY.md`, secret scanning + push protection, gitleaks in CI, Dependabot
- [ ] Rate limiting / origin check on the proxy before any public deployment

### Phase 1 — Flexbox layout engine (`src/layout/`)
- [x] Region tree model (row/column containers, grow/shrink/basis/min/max, gap, padding, align, justify) — `src/layout/builders.js` + `solve.js`
- [x] Solver that resolves the tree to absolute boxes (`solveLayout`) + a renderer that walks it to SVG (`renderLayoutToSVG`)
- [x] `buildPage1` (parts spec sheet + 4-view diagram) rebuilt on the engine — part-table rows are now `leaf({ grow: 1, min: 16 })` instead of a hand-derived `Math.floor(bodyH / partsCount)` formula. Verified geometric parity against the old fixed-coordinate output in `src/pages/buildPages.test.js`, and fixed a real bug surfaced by the refactor: the 4-view grid used to start flush with the DETAILS bar's own top edge instead of below it, so its opaque background silently covered most of the "DETAILS" label.
- [ ] `buildDesignPage` still uses hand-computed pixel math — port it to the engine next (same pattern as `buildPage1`)
- [x] Unit tests for the solver (`src/layout/solve.test.js`, 16 cases: grow/shrink/clamping/nesting/justify/align/data-volume flexing)

### Phase 2 — AI intake (DeepSeek)
- [x] **Fase A — DeepSeek client foundation** (`src/core/deepseekClient.js`): `deepseekChat`/`extractStructured` against the proxy, with automatic retry on the NVIDIA free-tier's frequent transient `ResourceExhausted` 503s. Local dev gap closed: `api/deepseek.js` is a Vercel function that plain `vite dev` never executes - `npm run dev` now runs `scripts/dev.mjs`, a small local shim (same handler code, no Vercel account needed) proxied through Vite (`vite.config.js`). Verified with real end-to-end calls against the live NVIDIA endpoint, not just mocks.
- [x] **Fase B — CSV import** (registered garments) (`src/core/csvImport.js`): upload one CSV in the Piezas step, DeepSeek (not a rigid column parser - people fill these out however makes sense to them) extracts `{parts, designs}` and pre-fills the existing Piezas/Diseños steps for review. Matched part labels overlay onto the garment's canonical id/order (so the result is always complete even from a partial CSV); unrecognized rows become custom parts instead of being dropped. Verified live with a deliberately messy, non-tabular CSV (mixed `Etiqueta: valor` and comma-separated sections) - correctly extracted and mapped.
- [x] **Fase C — "Prenda desde 0"**: a DeepSeek chat builds a garment definition question by question (parts, positions, design/embroidery intent), generic-silhouette fallback in `buildPages.js`/`Preview.jsx` for garments with no hand-drawn `guides`/`callouts`, then the existing Diseños step for image+dimension upload. Draft is downloadable as a `garments/<id>.js` scaffold (placeholder silhouette, `// TODO` pointing at CONTRIBUTING.md) so it can be PR'd in as an officially-supported garment. Verified live end-to-end with a real DeepSeek conversation (Polo: cuello clásico con 3 botones nácar, mangas cortas con ribete, bajo cola de pato, logo bordado PANTONE 286C) through to Vista Previa (generic-silhouette rectangles, numbered part chips, no invented callouts) and a working "Descargar prenda (.js)" download (`custom-polo.js`). Also found and fixed live: a React lazy-initializer bug that crashed the wizard when switching to a custom garment, and added graceful degradation for turns where the model replies in plain text instead of the JSON envelope.
- [x] **Fase D — CSV/Wilcom import gets embroidery specs + companion photos** (`src/core/csvImport.js`): when the uploaded CSV describes embroidery digitizing data (stitches, color changes, stops/trims, stabilizer top/backing, thread/bobbin - the kind of sheet Wilcom exports), DeepSeek now also returns an `emb{}` object per design using the exact `EMPTY_EMB` field names, with an explicit prompt rule forcing `tec` to an exact recognized embroidery label so the `isEmbTec` gate reliably fires. A new optional multi-photo upload sits next to the CSV input in the Piezas step; `matchImagesToDesigns()` attaches photos via a DeepSeek-returned filename hint first (the model is text-only here - it never sees pixel data, only filenames), falling back to order-based pairing for anything left over, and surfaces any unmatched photos instead of dropping them silently. Verified live with a synthetic Wilcom-style CSV (12500 stitches, 4 color changes, 2 stops, 1 trim, soluble topping, cut-away backing, Rayon/bobbin thread) referencing a photo by filename - the extracted `emb` data and matched photo landed correctly in the existing Diseños step's `EmbForm`/`ImageUploader`, with zero new rendering code needed.
- [x] **Fase E — "Prenda desde 0" chat produces structured designs, not a discarded free-text summary**: fixed a real bug found in live use - the chat's `draft.designs` used to be one free-text string that `handleGarmentChatComplete` never even read, so anything said about custom buttons, embroidery, or Drive links silently never became a real page. `draft.designs` is now a structured array (`name/pos/posDetail/tec/driveLink/notes`), with an explicit prompt rule for when something gets its own page (has its own art, a Drive link, or an embroidery spec) vs. staying a flat `parts[]` attribute, plus a rule to probe construction-detail variants (cuffs or not, straight hem or shirttail, drawstring or not) before considering a piece complete. `GarmentChat` now takes a `tecs` prop (same list `csvImport.js` already uses) so `tec` lands on an exact recognized value. New `mapChatDesignsToDesigns()` (`buildCustomGarment.js`) converts the chat's designs into the same partial shape CSV import already produces, reusing `Object.assign(newDesign(), ...)` - zero new UI, the existing Diseños step just receives real pre-filled cards instead of one blank default. Verified live end-to-end with a real DeepSeek conversation (Polo: cuello con puño azul marino - a flat attribute; custom gold buttons with a Drive link - its own design; embroidered logo PANTONE 286C, `tec` landing on the exact "Bordado 3D" - its own design with the embroidery block firing correctly): the flat attribute stayed in Piezas, both customized elements appeared as separate entries in the live "Borrador" panel, Diseños arrived with both cards pre-filled (not one blank), and the generated tech pack showed 1 main page + 2 design pages - the concrete proof the layout responds to what's described, not just the data.

### Phase 3 — DeepSeek translation
- [ ] Replace the Anthropic translation path with DeepSeek via the proxy
- [ ] Remove the legacy `VITE_ANTHROPIC_API_KEY` client call

## v0.3 — more garment types
Reference tech packs collected for each (polo/chemise/hoodie). Adding a garment
is a contained `src/garments/<id>.js` contribution — see [CONTRIBUTING.md](CONTRIBUTING.md).
- [ ] Polo
- [ ] Hoodie (full-zip)
- [ ] Chemise / woven shirt

## Later / exploratory
- [ ] Multi-page PDF export (currently per-page SVG)
- [ ] Save/load a tech pack as JSON (align with the OpenTechPack schema)
- [ ] Localize the builder UI itself (chrome is currently Spanish regardless of export language)
- [ ] Panel for managing multiple tech packs in one session
