import { DATASETS, ctxFor } from "./datasets.js"

function repeated(source, count, makeFallback) {
  const base = Array.isArray(source) && source.length > 0 ? source : [makeFallback(0)]
  return Array.from({ length: count }, (_, index) => ({
    ...base[index % base.length],
    id: (base[index % base.length].id || "item") + "-density-" + index,
  }))
}

export function ctxForFixture(fixture) {
  const ctx = ctxFor(DATASETS[fixture.dataset])
  const density = fixture.density || {}
  if (Number.isInteger(density.parts)) {
    ctx.parts = repeated(ctx.parts, density.parts, (index) => ({ id: "part-" + index, val: "Technical specification", on: true }))
  }

  if (Number.isInteger(density.colors) || Number.isInteger(density.embStops)) {
    const targetName = String((fixture.plan.pages[0] && fixture.plan.pages[0].purpose) || "").replace(/^design:/, "").toLowerCase()
    const designIndex = Math.max(0, ctx.designs.findIndex((design) => String(design.name || "").toLowerCase() === targetName))
    const design = { ...ctx.designs[designIndex] }
    if (Number.isInteger(density.colors)) {
      const palette = Array.isArray(design.colors) && design.colors.length > 0 ? design.colors : [{ name: "Black", hex: "#111111" }]
      design.colors = Array.from({ length: density.colors }, (_, index) => ({
        ...palette[index % palette.length],
        name: (palette[index % palette.length].name || "Color") + " " + (index + 1),
      }))
    }
    if (Number.isInteger(density.embStops)) {
      const emb = { ...(design.emb || { machine: "Industrial embroidery", stitches: "N/A" }) }
      const sequence = Array.isArray(emb.stopSeq) && emb.stopSeq.length > 0 ? emb.stopSeq : [{ name: "Thread", stitches: 1000 }]
      emb.stopSeq = Array.from({ length: density.embStops }, (_, index) => ({
        ...sequence[index % sequence.length],
        stop: index + 1,
      }))
      emb.stops = density.embStops
      design.emb = emb
    }
    ctx.designs = ctx.designs.map((item, index) => index === designIndex ? design : item)
  }
  return ctx
}
