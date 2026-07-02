# Roadmap

## v0.1 (shipped)
- [x] Multi-garment architecture (`src/garments/*.js` registry instead of hardcoded cap data)
- [x] First fully-supported garment: **Cap** (parts spec sheet, 4-view diagram with callouts, per-design Pantone/Madeira color specs, embroidery tech sheet, PDF-derived embroidery extraction, ES/EN/ZH export)

## v0.2 — AI intake + flexible layout engine (in progress)
The big shift: from a **fixed** coordinate layout to an **AI-driven, flexbox-style**
tech pack generator. Two pillars, built on a hardened, secret-safe backend.

### Phase 0 — Security & backend scaffold
- [x] Server-side proxy (`api/deepseek.js`) so the NVIDIA/DeepSeek key never reaches the browser
- [x] `SECURITY.md`, secret scanning + push protection, gitleaks in CI, Dependabot
- [ ] Rate limiting / origin check on the proxy before any public deployment

### Phase 1 — Flexbox layout engine (`src/layout/`)
- [ ] Region tree model (header/membrete → body{ spec tables, blank design area } → footer with page number) with flex properties (grow / min / max / direction)
- [ ] Solver that resolves the tree to absolute boxes, then renders each to SVG
- [ ] Refactor the cap pages to use the engine (must reproduce current output first, then flex by data volume)
- [ ] Unit tests for the solver

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
