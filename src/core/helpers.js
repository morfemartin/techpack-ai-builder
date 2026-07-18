// Embroidery-spec shape shared by every garment type
export const EMPTY_EMB = {
  machine: "", stitches: "", colorChanges: "", stops: "", trims: "", fabric: "",
  stabTopping: "", stabBacking: "", appliques: "", w: "", h: "", area: "",
  maxStitch: "", minStitch: "", maxJump: "", totalThread: "", totalBobbin: "", stopSeq: [],
}

// An EMPTY_EMB-shaped object is present on every design created by the UI,
// so object truthiness cannot tell us whether an embroidery worksheet exists.
// Keep this predicate shared by contracts, measurement and review so all three
// layers agree about when embSpecs is meaningful.
export function hasEmbSpecs(emb) {
  if (!emb || typeof emb !== "object" || Array.isArray(emb)) return false
  return Object.entries(emb).some(([key, value]) => {
    if (key === "stopSeq") {
      return Array.isArray(value) && value.some((stop) =>
        stop && typeof stop === "object" && Object.values(stop).some((item) => String(item == null ? "" : item).trim())
      )
    }
    return String(value == null ? "" : value).trim() !== ""
  })
}

const EMB_TECS = ["Bordado", "Embroidery", "绣花", "平绣"]
export const isEmbTec = (tec) => EMB_TECS.some((e) => tec && tec.toLowerCase().includes(e.toLowerCase()))

// Generic "this covers the whole garment" keyword fragments (language-only, garment-independent).
// A garment's position list should include the word "Toda"/"Full"/"全" in whichever
// entries mean "no specific placement / covers everything".
const WHOLE_POS = ["toda", "full", "全"]
export const isWholePosF = (pos) => WHOLE_POS.some((p) => pos && pos.toLowerCase().includes(p))
