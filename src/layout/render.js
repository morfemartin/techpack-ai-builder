// Walks a tree already resolved by solveLayout() and concatenates the SVG
// markup each leaf's render(box) produces, in tree order (which doubles as
// paint order - fine since regions in a tech pack page don't overlap).

export function renderLayoutToSVG(resolved) {
  let out = ""
  if (typeof resolved.render === "function") {
    out += resolved.render({ x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height })
  }
  if (resolved.children) {
    for (const child of resolved.children) out += renderLayoutToSVG(child)
  }
  return out
}
