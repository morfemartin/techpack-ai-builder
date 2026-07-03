// A neutral placeholder outline for garments that don't have a hand-drawn
// silhouette yet (the "prenda desde 0" AI chat can gather parts/positions
// data, but a real 4-view garment silhouette with callout coordinates is
// bespoke vector art - see CONTRIBUTING.md "Add a garment type"). Same
// 0-200x0-150 viewBox convention every garment's `guides` array uses.
//
// Deliberately just a plain rectangle: inventing a fake-precise silhouette
// or callout pointers would misrepresent data we don't actually have.
export const GENERIC_SILHOUETTE = "M24 12 H176 V138 H24 Z"
