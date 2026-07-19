# Layout Engine v3 — production grid and illustration handoff

This is the architecture behind the generated tech-pack document: how a weak
model's proposal becomes a correct, aligned, dead-space-free page. The guiding
principle is a division of labor — **the AI proposes, deterministic code
disposes**. DeepSeek (a small model) only ever makes small, closed-vocabulary
decisions; every guarantee lives in code that validates and repairs whatever
it returns. A bad AI answer degrades to a sensible default, it can never break
a page.

Verify any of this visually in the [Layout Lab](layout-lab/README.md):
`npm run dev` → http://localhost:3001/layout-lab.html.

---

## The two problems this solves

**P1 — misalignment.** Every block renderer used to invent its own geometry:
left insets of 8/10/12/14/38/44px, value columns at 0.5/0.52/0.55, six
different row-height regimes, a parts-table header whose captions never sat
over its own rows. Rules and columns from different blocks never lined up.

**P2 — dead white space.** The solver handed each region a box sized by the
AI's weight; the renderer drew its natural-size content and stopped, leaving
the rest of the box blank. Nothing shrank a block to its content or gave the
freed space back. (The intentional blank of an illustration placeholder is
*not* this — that's where art goes.)

---

## The pipeline

```
intake (parts, designs, header)
        │
        ▼
planDocumentOutline ──► repairOutline ──► [cover, overview, design:…, …]
   (AI: which pages)     (contract)         every design covered once,
                                            cover + full-BOM page guaranteed
        │
        ▼   per page
planPageLayout ──► normalizePlan ──► repairPage ──► regions
   (AI: regions,     (drop unknown)   (contract)     mandatory present,
    weights,                                          forbidden/empty/dupes
    briefs[])                                         gone, chrome ordered
        │
        ▼
candidate composer ──► layout AST ──► solveLayout ──► A4 SVG
 (grid search)          (rail/mosaic)   (whole-pixel)   (editable groups)
        │
        ▼
buildReviewFindings ──► ReviewChat (only if problems) ──► export
   (intent vs document)
```

---

## The five pieces

### 1. Shared metrics (`src/design/metrics.js`) — kills P1

One geometric source of truth on the tokens 4px grid, consumed by **every**
renderer: a single content `INSET`, one `COL` column template used by both
table headers and rows, a `ROW` height scale, one `CHIP` size, full-width
section bars (`svgSectionBar`), and a header grid where the width splits into
five modules so both header rows share every vertical edge. `solveLayout` then
snaps every box to whole pixels **edge-wise** (start and end rounded, size
derived) so adjacent boxes still share exactly one edge — crisp hairlines,
coincident edges across blocks.

### 2. Measure-then-solve (`src/pages/measure.js` + solver) — kills P2

`measureRegion()` answers, per region type, "how tall does this block want to
be for its actual data at this exact width?" — mirroring each renderer's exact
geometry. BOM rows use the same wrapping function in measurement and rendering,
so a long specification increases its row height instead of crossing a cell.
`interpretPagePlan` then sizes a page so **bounded data blocks take their
natural height** (`grow: 0`, compressible only toward a legible floor) and
**every leftover pixel flows to the absorbers** (illustration/spacer, or a
split containing one), divided by the plan weights. A page with no absorber
parks its slack in one invisible spacer above the bottom chrome, so the
disclaimer stays pinned. The AI's weights now express *priority among
absorbers*, not arbitrary heights for data — a two-row table can no longer be
stretched into a half-page band of white. The solver also runs the real
flexbox multi-pass loop, so a child that clamps at its max/min hands the
surplus back to its siblings instead of losing it.

### 3. Page contracts (`src/pages/pageContracts.js`) — the designer's brain

`CONTRACTS[purpose]` encodes, per page family
(`cover`/`overview`/`structure`/`lining`/`label`/`design`): which regions are
**mandatory**, which are **forbidden** (a `partsList` — the full BOM — is
forbidden on a design page; it lives once, on the overview), and which are
**conditionally mandatory** (a design page shows `colorSpecs` only if that
design has colors, `embSpecs` only if it has embroidery data).

- `validatePage` / `repairPage`: drop forbidden, empty-data, and duplicate
  regions (inside splits too), insert missing mandatory regions with
  per-purpose defaults, enforce canonical chrome order (header → title →
  content → disclaimer).
- `validateOutline` / `repairOutline`: cover page first, at least one full-BOM
  page, every design covered exactly once.

This is where the four designer questions become code: *what deserves its own
page* (outline), *what must be visually present* (mandatory), *what never
repeats* (forbidden + one-BOM rule), *how do I represent this most orderly*
(measure-then-solve + canonical order).

### 4. Structured illustrator briefs (`src/pages/briefs.js`)

Each illustration slot gets a brief that answers — inside the art board, never
taking layout space — which garment part goes here, what the drawing **must
mark**, which **measurements** to draw (with the dimension-line convention,
flagged per-size when they grade), and the **factory note**. The AI fills a
`briefs[]` array guided by two thinking models: (a) what drawn/dimensioned
elements keep the factory faithful to the client's intent, and (b) what a
skilled illustrator *without* textile knowledge needs to finish the
schematics. `normalizeSlotBriefs` guarantees the shape and derives defaults
from the design's own data; `briefLines` renders a standard template with a
degradation ladder (full → checklist → title) so every slot explains itself
legibly at any cell size.

### 5. Pre-download review (`src/core/reviewDiff.js` + `ReviewChat`)

Before export, `buildReviewFindings` diffs the intake truth against the
generated document: each datum is **confirmed** (lands on a page), **missing**
(empty in the intake), or **unplaced** (exists but no page carries it). Only
the problems become a short chat with numbered options
(`findingsToWalkFields`), so the review runs even with zero AI availability; a
bounded DeepSeek call just rephrases them conversationally. Confirmed data is
a one-line summary, never re-asked. Always skippable — the review protects the
user, it never holds the download hostage.

`applyReviewAnswers` is the write-back boundary. Completing the walk applies
answers to cloned intake data, repairs the outline and affected pages, then
commits the new state only after the corrected SVG document renders. Choosing
to remove a part, design, color card, or embroidery worksheet deletes that data
from the project. **Download anyway** is a separate path and performs no
mutation. Only structurally affected pages are sent back to the AI planner;
all provider failures fall back to `repairPage`.

The outline, every page, and each intake-analysis phase also have an external
time budget. When DeepSeek does not answer, the wizard uses the contractual
outline/layout fallback or continues without designs/briefs instead of staying
blocked behind the provider's internal retries.

After contract repair, every page is evaluated on an exact A4 landscape macro
grid: eight 32.5mm columns, 3mm gutters and 8mm margins. The composer compares
`hero-rail`, independent data columns, bottom bands, BOM/hero and
`data-slot-mosaic` candidates. Rails enumerate every grid span allowed by the
module's measured minimum width. A mosaic can place a short data block above
one artboard and tile the remaining views in the adjacent columns; scoring uses
the real area and minimum dimensions of every individual slot.
Completeness, 7pt print legibility and 60mm art slots are hard constraints;
artwork area, internal waste and page count are ordered tie-breakers.

Bounded tables keep their natural height when possible and may compress only to
the renderer's explicit legibility floor. If all rows still cannot fit, BOM,
color and embroidery data continue onto additional pages. This makes
`complete` a hard guarantee: a composition may change or paginate, but it does
not clip rows or silently shrink type below the contract.

Embroidery presence is based on `hasEmbSpecs`, not object truthiness. The UI
creates every design with an `EMPTY_EMB` object, and that empty form must not
create an embroidery page, consume layout height, or appear as an unplaced
review finding.

In `illustration-handoff` mode, every brief stays inside its corresponding art
board as provisional content with deterministic view, design, callout and
dimension IDs. It consumes no macro-grid rows or columns and is replaced by
the final technical artwork without reflowing the page.
Uploaded graphics render under `REFERENCES` as `NO A ESCALA`. The final SVG uses
named groups (`ARTWORK`, `TECH_DATA`, `ILLUSTRATOR_INSTRUCTIONS__V1`, `REFERENCES`,
`PAGE_CHROME`) and a visible not-approved-for-production status. Document
assembly paginates first, then creates the cover index and `P. XX / NN` footer.

---

## Why DeepSeek can execute this

Every runtime AI decision is a small closed-vocabulary JSON object
(`{regions:[{type, weight, slots, refs, briefs}]}`, `{pages:[{purpose,
pieces}]}`) that is normalized, validated, and repaired deterministically. The
prompt teaches the model to think like a designer; the code guarantees the
result regardless of how well it did. Several of the pure modules here
(`measure.js`, the solver's redistribution loop, `pageContracts` validate/
repair, `briefs` normalizer, `reviewDiff`) were drafted by the local DeepSeek
orchestrator against exact contract tests, then reviewed and integrated — the
same "delegate the self-contained, review the integration" split used
throughout this project's build-out.
