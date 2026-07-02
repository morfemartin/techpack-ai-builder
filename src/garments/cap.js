// First fully-supported garment type. Every other garment (t-shirt, hoodie,
// polo, ...) should follow this same shape - see ROADMAP.md "Add a garment type".
export const capGarment = {
  id: "cap",
  icon: "checkroom", // Material Symbols name (no emojis anywhere in the UI)
  label: { ES: "Gorra", EN: "Cap", ZH: "帽子" },

  defaultParts: [
    { id: 1, val: "Gorra Entallada", on: true }, { id: 2, val: "100% Poliester", on: true }, { id: 3, val: "6 Paneles", on: true },
    { id: 4, val: "Visera Plana", on: true }, { id: 5, val: "Entallado", on: true }, { id: 6, val: "Boton Blanco", on: true },
    { id: 7, val: "Ojetes a Juego", on: true }, { id: 8, val: "Tafetan", on: true }, { id: 9, val: "Ninguno", on: true },
    { id: 10, val: "Ninguno", on: true }, { id: 11, val: "Bordado 3D", on: true }, { id: 12, val: "Bordado 3D", on: true },
    { id: 13, val: "Bordado Plano", on: true }, { id: 14, val: "Ninguno", on: false }, { id: 15, val: "Ninguno", on: false },
    { id: 16, val: "Ninguno", on: false }, { id: 17, val: "S / M / L / XL", on: true },
  ],

  partLabels: {
    ES: { 1: "Estilo", 2: "Tela Copa", 3: "Paneles", 4: "Visera", 5: "Cierre", 6: "Boton", 7: "Ojetes", 8: "Sudadera Int.", 9: "Bajo Visera", 10: "Cinta Int.", 11: "Diseno Frontal", 12: "Diseno Trasero", 13: "Diseno Izq.", 14: "Diseno Der.", 15: "Top Visera", 16: "Bajo Visera", 17: "Tallas" },
    EN: { 1: "Style", 2: "Crown Fabric", 3: "Panels", 4: "Visor", 5: "Closure", 6: "Top Button", 7: "Eyelets", 8: "Sweatband", 9: "Underbill", 10: "Inner Tape", 11: "Front Design", 12: "Back Design", 13: "Left Design", 14: "Right Design", 15: "Visor Top", 16: "Under Visor", 17: "Size Range" },
    ZH: { 1: "款式", 2: "帽身面料", 3: "片数", 4: "帽檐", 5: "后调", 6: "顶扣", 7: "透气孔", 8: "汗带", 9: "檐底", 10: "内条", 11: "正面设计", 12: "背面设计", 13: "左侧设计", 14: "右侧设计", 15: "帽檐顶", 16: "帽檐底", 17: "尺码" },
  },

  // Design-placement options. Keep the "whole garment" concept present in the
  // first couple of entries via the words toda/full/全 (see core/helpers.js).
  positions: {
    ES: ["Toda la gorra", "Tela base", "Copa completa", "Panel Frontal", "Panel Trasero", "Izquierda", "Derecha", "Visera", "Bajo Visera", "Interior/Sudadera"],
    EN: ["Full cap", "Base fabric", "Full crown", "Front Panel", "Back Panel", "Left", "Right", "Visor", "Under Visor", "Interior"],
    ZH: ["全帽", "底布", "帽身全部", "正面", "背面", "左侧", "右侧", "帽沿", "帽沿底", "内里"],
  },

  // Silhouette guide paths for the 4-view diagram (front/back/left/right), in a 0-200x0-150 viewBox.
  guides: [
    "M22 128 C20 52 88 4 100 4 C112 4 180 52 178 128 M8 124 Q100 142 192 124 L192 132 Q100 150 8 132 Z",
    "M22 128 C20 52 88 4 100 4 C112 4 180 52 178 128 M8 124 Q100 142 192 124 L192 132 Q100 150 8 132 Z",
    "M18 128 C16 52 78 4 100 4 C112 4 163 52 163 128 M4 124 L163 124 L163 132 L4 132",
    "M37 128 C35 52 88 4 100 4 C122 4 182 52 180 128 M37 124 L196 124 L196 132 L37 132",
  ],

  // Callout pointers per view: [partId, labelX, labelY, pointX, pointY]
  callouts: [
    [[6, 100, 6, 120, 8], [2, 36, 65, 8, 58], [11, 100, 70, 128, 58], [7, 24, 76, 4, 70], [3, 158, 42, 178, 34], [4, 100, 132, 100, 148]],
    [[6, 100, 6, 120, 8], [12, 100, 70, 128, 58], [5, 100, 120, 100, 138], [8, 168, 118, 185, 112]],
    [[6, 100, 6, 120, 8], [13, 75, 70, 48, 60], [4, 22, 126, 4, 136], [9, 100, 134, 100, 150]],
    [[6, 100, 6, 120, 8], [14, 125, 70, 152, 60], [4, 178, 126, 196, 136]],
  ],
}
