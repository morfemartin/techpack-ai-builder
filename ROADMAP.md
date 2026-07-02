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
- [x] Two typefaces / three roles: Space Grotesk (display+ui) + JetBrains Mono (data); Material Symbols icons, zero emojis, zero border-radius
- [x] Layout engine extended to resolve **percentage** basis/gap/padding — the "márgenes por porcentaje entre retículas"
- [ ] Recolor the generated SVG pages with the same role tokens (currently only the wizard UI uses them)

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
- [ ] Adaptive, garment-aware questionnaire that offers options as it goes
- [ ] Shared general survey (cover-page fields common to almost every tech pack) + garment-specific specs
- [ ] Client logo intake + file uploads

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
