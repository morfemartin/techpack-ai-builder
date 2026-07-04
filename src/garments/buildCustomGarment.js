// Turns the "prenda desde 0" AI chat's draft (GarmentChat.jsx) into the same
// shape every registered garment (src/garments/cap.js) has, MINUS
// guides/callouts - those need real hand-drawn vector art, which a chat
// can't produce reliably. Everything downstream (buildPages.js, Preview.jsx)
// already falls back to a generic silhouette when guides/callouts are
// absent, and every `garment.X[lang]` read in the app already falls back to
// `.ES` when a language key is missing - so an ES-only draft "just works"
// without needing translated copies.
export function buildCustomGarment(draft) {
  const parts = Array.isArray(draft.parts) ? draft.parts : []
  const defaultParts = parts.map((p, i) => ({ id: i + 1, val: p.val || "", on: true }))

  const partLabelsES = {}
  parts.forEach((p, i) => {
    partLabelsES[i + 1] = p.label || "Pieza " + (i + 1)
  })

  const positions = Array.isArray(draft.positions) && draft.positions.length > 0 ? draft.positions : ["Toda la prenda"]

  const id = "custom-" + slugify(draft.id || draft.label || "prenda")

  return {
    id,
    icon: "auto_awesome",
    label: { ES: draft.label || "Prenda nueva" },
    defaultParts,
    partLabels: { ES: partLabelsES },
    positions: { ES: positions },
    // No guides/callouts on purpose - see genericSilhouette.js.
    designNotes: draft.notes || "",
  }
}

// Converts the chat's structured draft.designs (name/pos/tec/driveLink -
// see GarmentChat.jsx's system prompt) into the partial shape App.jsx merges
// onto newDesign() via Object.assign(newDesign(), mapped) - same pattern
// csvImport.js's designs already use. Kept here as a pure, exported function
// so this mapping is unit-testable without mounting App.jsx.
export function mapChatDesignsToDesigns(draftDesigns, fallbackPosition) {
  const list = Array.isArray(draftDesigns) ? draftDesigns : []
  if (list.length === 0) return [{ pos: fallbackPosition }]
  return list.map((dd) => ({
    name: dd.name || "Nuevo Diseno",
    pos: dd.pos || fallbackPosition,
    posDetail: dd.posDetail || "",
    tec: dd.tec || "Bordado 3D",
    driveLink: dd.driveLink || "",
  }))
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents (e.g. "camisón" -> "camison")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "prenda"
  )
}
