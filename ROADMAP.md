# Roadmap

## v0.1 (current)
- [x] Multi-garment architecture (`src/garments/*.js` registry instead of hardcoded cap data)
- [x] First fully-supported garment: **Cap** (parts spec sheet, 4-view diagram with callouts, per-design Pantone/Madeira color specs, embroidery tech sheet, PDF-derived embroidery extraction, ES/EN/ZH export)
- [ ] Publish v0.1.0 release with a recorded demo GIF

## v0.2 — more garment types
Adding a garment is meant to be a contained, well-scoped contribution — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the shape a `src/garments/<id>.js` file needs (parts, part labels per language, position list, 4-view silhouette guide paths, callout coordinates).

- [ ] T-shirt / crewneck
- [ ] Hoodie
- [ ] Polo

## v0.3 — export & data
- [ ] Multi-page PDF export (currently only per-page SVG download/copy)
- [ ] Save/load a tech pack as JSON (currently everything lives only in React state - a refresh loses your work)
- [ ] Persist to a backend (Supabase/GitHub Gist) instead of local-only

## Later / exploratory
- [ ] Localize the builder UI itself (currently the wizard chrome is hardcoded Spanish regardless of the export language)
- [ ] Move the Claude API calls (translation, PDF extraction) behind a small backend proxy instead of calling `api.anthropic.com` directly from the browser with a client-exposed key
- [ ] Panel for managing multiple tech packs in one session
