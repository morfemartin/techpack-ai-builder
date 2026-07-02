# Changelog

## [0.1.0] - 2026-07-01
### Added
- Initial public release.
- Multi-garment architecture: garments are registered in `src/garments/index.js`, each one supplying its own parts, part labels (ES/EN/ZH), design positions, and 4-view silhouette/callout diagram.
- First garment: **Cap** — full parts spec sheet, 4-view technical diagram with numbered callouts, per-design Pantone/Madeira color specs (auto CMYK from hex), embroidery tech sheet with stop-sequence, optional AI extraction of embroidery specs from a Wilcom PDF worksheet, and ES/EN/ZH export with optional AI translation.
- Per-page SVG export (copy to clipboard or download), one artboard-ready file per page.
