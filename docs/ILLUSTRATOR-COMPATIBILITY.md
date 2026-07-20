# Adobe Illustrator export contract

## Decision

TechPack AI Builder uses two complementary deliverables:

1. **SVG** remains the open, browser-generated vector source.
2. **AI** is created by Adobe Illustrator itself through the audited JSX importer.

A browser cannot generate Illustrator's private editing payload. Renaming an SVG to `.ai`, or adding Adobe-looking metadata, would be misleading. Adobe documents SVG, PDF, EPS and AI as supported formats, but only Illustrator can add **Preserve Illustrator Editing Capabilities** data to AI/PDF files.

The production target is therefore a package containing conservative SVG pages, a manifest and an Illustrator importer. The importer creates one AI document with named A4 artboards in a four-column grid and seven global semantic layers. A later milestone will add a multipage PDF as the visual/print reference.

## Format comparison

| Format | Browser generation | Visual fidelity | Clean editability | Multiple pages/artboards | Decision |
|---|---:|---:|---:|---:|---|
| SVG | Yes | High with a restricted profile | High, but import behavior must be normalized | One active artboard per file | Editable interchange source |
| PDF | Yes | Best print/reference option | Standard PDF objects, not guaranteed native Illustrator structure | Yes | Future visual master |
| AI | No supported open writer | Best when Illustrator creates it | Native | Yes | Created by the JSX bridge |
| EPS | Yes | Limited modern feature support | Legacy | Limited | Rejected |

Adobe references:

- [Supported file formats](https://helpx.adobe.com/illustrator/kb/supported-file-formats-illustrator.html)
- [Save artwork and preserve editing capabilities](https://helpx.adobe.com/illustrator/using/saving-artwork.html)
- [SVG export options](https://helpx.adobe.com/illustrator/using/exporting-artwork.html)
- [Create Adobe PDF files](https://helpx.adobe.com/illustrator/using/creating-pdf-files.html)
- [Install and run Illustrator scripts](https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/automate-actions/install-and-run-scripts.html)

## SVG profile v1

The Illustrator-targeted SVG is XML 1.0 UTF-8 and A4 landscape (`297 x 210 mm`, `viewBox 0 0 1188 840`). It uses only presentation attributes and basic vector primitives already produced by the document renderer.

The exporter additionally guarantees:

- explicit SVG 1.1, XLink and layer namespaces;
- deterministic metadata in CDATA;
- embedded images with both `href` and `xlink:href`;
- source font families and sizes preserved, with `dominant-baseline=central` converted to explicit baselines using the source font class metrics;
- unique names for anonymous groups;
- seven top-level semantic containers;
- no redundant `clipPath` nodes that trigger blocking Illustrator warnings;
- well-formed XML validation before release.

Layer contract, bottom to top:

1. `PAGE_BACKGROUND`
2. `ARTWORK`
3. `REFERENCES`
4. `TECH_DATA`
5. `DESIGNER_COMMUNICATION`
6. `CALLOUTS`
7. `PAGE_CHROME`

`DESIGNER_COMMUNICATION` must remain independently removable. Empty semantic layers are intentional: their stable presence lets later pages accept references or callouts without changing the document contract.

## Illustrator 2026 finding

The controlled test was run locally with Illustrator `30.4.0`. Illustrator preserved the seven top-level SVG containers and the A4 artboard, but discarded their SVG `id` names during direct import. The first importer therefore created seven named layers but could not move the unnamed containers into them.

The corrected importer uses two strategies:

1. use imported names when Illustrator preserves them;
2. otherwise map the seven top-level containers by their deterministic stack order.

Illustrator's generated report now records:

```text
Imported top-level groups: 7
Stack-order fallback: true
07 PAGE_CHROME | objects=1
06 CALLOUTS | objects=1
05 DESIGNER_COMMUNICATION | objects=1
04 TECH_DATA | objects=1
03 REFERENCES | objects=1
02 ARTWORK | objects=1
01 PAGE_BACKGROUND | objects=1
Missing wrappers: none
```

The final acceptance run produced 11 named artboards, seven global layers and
11 page groups per layer. The four-column grid avoids Illustrator's maximum
canvas width, which was reached when the tenth A4 page was placed in one row.
The user validated the final document in both Affinity 3.2.3 and Illustrator
30.4.0; the evidence and iteration history are in the comparison README.

An early comparison build replaced the source font stacks while also converting
the baseline. Illustrator opened it, but the changed font metrics displaced
elements and made type sizes appear inconsistent. Font replacement was removed.
The final profile preserves the original stacks and converts only SVG's poorly
interoperable `dominant-baseline=central` value to explicit baselines: `0.36em`
for the UI stack and `0.35em` for the monospaced data stack.

## Improvement plan

1. **Current comparison:** validate one dense design page against the legacy SVG and collect screenshots.
2. **Product integration (complete):** Blob downloads now offer original SVG, editable SVG, JSX and a complete ZIP from the export dialog.
3. **Multipage bridge (complete):** the JSX importer creates one named artboard per physical page and saves a single AI document.
4. **Visual master:** generate a multipage PDF and compare Illustrator output against it in automated visual regression tests.
5. **Typography modes:** ship editable text with a font preflight and an optional outlined-text copy for visual lockoff.
6. **Release gate:** validate XML, IDs, images, dimensions, layer/object counts, minimum text size and Illustrator import reports before publishing.

## Security

The JSX script is plain text, version controlled and contains no network access, shell execution, credentials or client data transmission. It reads only the adjacent comparison SVG, writes an AI file and a local report, and can be reviewed before execution through Illustrator's `File > Scripts > Other Script` flow.

The reproducible sample and instructions live in [`docs/illustrator-comparison/`](illustrator-comparison/README.md).
