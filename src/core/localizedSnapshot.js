function translatedAt(values, index, fallback) {
  return Array.isArray(values) && typeof values[index] === "string" ? values[index] : fallback
}

export function buildLocalizedSnapshot({ hdr, parts, designs, fabricColors, sizeChart }, tx) {
  const translation = tx && typeof tx === "object" ? tx : {}
  let activeIndex = 0
  const localizedParts = (Array.isArray(parts) ? parts : []).map((part) => {
    if (!part || part.on === false) return part
    const value = translatedAt(translation.parts, activeIndex, part.val)
    const label = translatedAt(translation.partLabels, activeIndex, part.customName || part.label || "")
    activeIndex += 1
    return {
      ...part,
      val: value,
      ...(label ? { label, customName: label } : {}),
    }
  })

  const localizedDesigns = (Array.isArray(designs) ? designs : []).map((design, index) => {
    const translated = Array.isArray(translation.designs) ? translation.designs[index] : null
    if (!translated) return design
    return {
      ...design,
      name: translated.name,
      pos: translated.pos,
      posDetail: translated.posDetail,
      tec: translated.technique,
      illustrationBrief: translated.illustrationBrief,
      colors: (Array.isArray(design.colors) ? design.colors : []).map((color, colorIndex) => ({
        ...color,
        ...(translated.colors && translated.colors[colorIndex] ? { name: translated.colors[colorIndex].name } : {}),
      })),
    }
  })

  const localizedFabricColors = (Array.isArray(fabricColors) ? fabricColors : []).map((color, index) => ({
    ...color,
    ...(translation.fabricColors && translation.fabricColors[index] ? { name: translation.fabricColors[index].name } : {}),
  }))

  const sourceChart = sizeChart && typeof sizeChart === "object" ? sizeChart : { poms: [], constants: [] }
  const translatedChart = translation.sizeChart || { poms: [], constants: [] }
  const localizedSizeChart = {
    ...sourceChart,
    poms: (Array.isArray(sourceChart.poms) ? sourceChart.poms : []).map((pom, index) => ({
      ...pom,
      ...(translatedChart.poms && translatedChart.poms[index]
        ? { label: translatedChart.poms[index].label, howToMeasure: translatedChart.poms[index].howToMeasure }
        : {}),
    })),
    constants: (Array.isArray(sourceChart.constants) ? sourceChart.constants : []).map((constant, index) => ({
      ...constant,
      ...(translatedChart.constants && translatedChart.constants[index] ? { label: translatedChart.constants[index].label } : {}),
    })),
  }

  return {
    hdr: { ...(hdr || {}), ...(typeof translation.pname === "string" ? { pname: translation.pname } : {}) },
    parts: localizedParts,
    designs: localizedDesigns,
    fabricColors: localizedFabricColors,
    sizeChart: localizedSizeChart,
    partLabels: Object.fromEntries(localizedParts.filter((part) => part && part.id != null).map((part) => [part.id, part.customName || part.label || ""])),
  }
}
