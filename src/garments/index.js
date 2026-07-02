import { capGarment } from "./cap.js"

// Garment registry. Add new garment types here once they exist under
// src/garments/<id>.js - see ROADMAP.md for the ones planned next
// (t-shirt, hoodie, polo) and CONTRIBUTING.md for the shape a garment needs.
export const GARMENTS = {
  cap: capGarment,
}

export const GARMENT_LIST = Object.values(GARMENTS)
