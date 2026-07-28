// Reads one image file into the shape every design-image consumer needs:
// base64 without the "data:" prefix, its natural pixel dimensions (via a
// throwaway Image()), and its fileName for callers that reference it by name
// (e.g. DeepSeek's text-only extraction). Shared by ImageUploader.jsx,
// App.jsx's CSV image intake and GarmentChat.jsx's inline design upload -
// three call sites used to each read a FileReader+Image pair themselves.
export function readDesignImageFile(file) {
  return new Promise((resolve, reject) => {
    const isSvg = file.type === "image/svg+xml"
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target.result
      const img = new Image()
      img.onload = () => {
        resolve({ fileName: file.name, imageData: result.split(",")[1], imageType: isSvg ? "svg" : "png", imgNatW: img.naturalWidth, imgNatH: img.naturalHeight })
      }
      img.onerror = reject
      img.src = result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Embroidery-spec shape shared by every garment type
export const EMPTY_EMB = {
  machine: "", stitches: "", colorChanges: "", stops: "", trims: "", fabric: "",
  stabTopping: "", stabBacking: "", appliques: "", w: "", h: "", area: "",
  maxStitch: "", minStitch: "", maxJump: "", totalThread: "", totalBobbin: "", stopSeq: [],
}

// The exact emb key list, shared by every AI extraction path that produces
// an EMPTY_EMB-shaped object (csvImport.js's CSV interpreter and
// embExtract.js's Wilcom-PDF OCR extractor) - one prompt fragment instead of
// two independently-drifting copies of the same key list.
export const EMB_FIELDS_PROMPT =
  "machine, stitches, colorChanges, stops, trims, fabric, stabTopping, stabBacking, appliques, w, h, area, maxStitch, minStitch, maxJump, totalThread, totalBobbin, stopSeq (array de {stop,color,stitches,code,name})"

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
