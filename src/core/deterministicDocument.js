import { renderColorwayDocument } from "./colorways.js"
import { fallbackDocumentOutline } from "./documentPlan.js"
import { deterministicPageLayout } from "./semanticOutline.js"

// Last-resort rendering for a custom garment. This deliberately stays on the
// same semantic outline -> measured candidate compositor pipeline as the AI
// path. Provider or translation failures may change the copy, never the layout
// engine or its production constraints.
export function buildDeterministicCustomDocument({ baseContext, renderContext, colorways, options } = {}) {
  const outline = fallbackDocumentOutline(baseContext || {})
  const plan = {
    pages: outline.pages.map((page) => deterministicPageLayout(page, baseContext || {})),
  }
  return renderColorwayDocument(plan, renderContext || {}, colorways, {
    documentMode: "illustration-handoff",
    includeIndex: true,
    ...(options || {}),
  })
}
