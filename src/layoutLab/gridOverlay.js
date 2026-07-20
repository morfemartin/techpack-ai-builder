import { CHROME, GRID, PAGE, PAGE_BODY, gridColumnBoxes } from "../design/metrics.js"

export function gridGeometry() {
  const columns = gridColumnBoxes()
  const gutters = columns.slice(0, -1).map((column, index) => ({
    index,
    x: column.x + column.width,
    width: GRID.gutter,
  }))
  const baselines = []
  for (let y = GRID.margin; y <= PAGE.height - GRID.margin; y += GRID.baseline) {
    baselines.push({ y, major: (y - GRID.margin) % (GRID.baseline * 4) === 0 })
  }
  const bodyY = GRID.margin + CHROME.header + CHROME.gap + CHROME.titleBar + CHROME.gap
  return {
    columns,
    gutters,
    baselines,
    content: { x: GRID.margin, y: GRID.margin, width: GRID.span(GRID.columns), height: PAGE.height - GRID.margin * 2 },
    body: { x: GRID.margin, y: bodyY, width: PAGE_BODY.width, height: PAGE_BODY.height },
  }
}

function line(x1, y1, x2, y2, color, opacity, width = 1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`
}

export function renderGridOverlay() {
  const geometry = gridGeometry()
  const columnBands = geometry.columns.map((column) =>
    `<rect x="${column.x}" y="${geometry.content.y}" width="${column.width}" height="${geometry.content.height}" fill="#1A3FB0" opacity="0.025"/>`
  ).join("")
  const gutterBands = geometry.gutters.map((gutter) =>
    `<rect x="${gutter.x}" y="${geometry.content.y}" width="${gutter.width}" height="${geometry.content.height}" fill="#1A3FB0" opacity="0.08"/>`
  ).join("")
  const verticals = geometry.columns.flatMap((column) => [
    line(column.x, geometry.content.y, column.x, geometry.content.y + geometry.content.height, "#1A3FB0", 0.5),
    line(column.x + column.width, geometry.content.y, column.x + column.width, geometry.content.y + geometry.content.height, "#1A3FB0", 0.5),
  ]).join("")
  const baselines = geometry.baselines.map((baseline) =>
    line(geometry.content.x, baseline.y, geometry.content.x + geometry.content.width, baseline.y, "#E5352B", baseline.major ? 0.38 : 0.16, baseline.major ? 1.2 : 0.7)
  ).join("")
  const contentFrame = `<rect x="${geometry.content.x}" y="${geometry.content.y}" width="${geometry.content.width}" height="${geometry.content.height}" fill="none" stroke="#E5352B" stroke-width="1.2" opacity="0.65" vector-effect="non-scaling-stroke"/>`
  const bodyFrame = `<rect x="${geometry.body.x}" y="${geometry.body.y}" width="${geometry.body.width}" height="${geometry.body.height}" fill="none" stroke="#1A3FB0" stroke-width="1.2" opacity="0.65" vector-effect="non-scaling-stroke"/>`
  return `<svg class="overlay" viewBox="0 0 ${PAGE.width} ${PAGE.height}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><g data-grid-role="columns">${columnBands}${gutterBands}${verticals}</g><g data-grid-role="baselines">${baselines}</g><g data-grid-role="frames">${contentFrame}${bodyFrame}</g></svg>`
}
