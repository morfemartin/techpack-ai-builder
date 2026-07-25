import { readDesignImageFile } from "../core/helpers.js"
import { palette, role } from "../design/tokens.js"

export function ImageUploader({ d, onUpdate }) {
  function handleFile(e) {
    var f = e.target.files[0]
    if (!f) return
    readDesignImageFile(f).then(({ imageData, imageType, imgNatW, imgNatH }) => {
      onUpdate({ imageData, imageType, imgNatW, imgNatH })
    })
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ padding: "7px 14px", background: palette.white.hex, border: "1.5px dashed " + role.priority.fill, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, color: role.priority.fill }}>
          {d.imageData ? "Imagen cargada - cambiar" : "Subir PNG o SVG del diseno"}
          <input type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {d.imageData && (
          <button onClick={() => onUpdate({ imageData: null, imageType: null, imgNatW: null, imgNatH: null })} style={{ background: "none", border: "none", color: role.index.fill, cursor: "pointer", fontSize: 13 }}>
            x quitar
          </button>
        )}
      </div>
      {d.imageData && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <img src={"data:" + (d.imageType === "svg" ? "image/svg+xml" : "image/png") + ";base64," + d.imageData} style={{ height: 60, maxWidth: 120, objectFit: "contain", border: "1px solid #eee", borderRadius: 4, background: "#fff", padding: 4 }} alt="preview" />
          <div style={{ fontSize: 10, color: "#888" }}>
            <div>Tipo: {d.imageType}</div>
            <div>
              Dim. nativas: {d.imgNatW}x{d.imgNatH}px
            </div>
            <div style={{ color: role.index.fill, fontWeight: 600 }}>Las cotas se muestran con los valores de Ancho/Alto (mm) que ingresaste arriba</div>
          </div>
        </div>
      )}
    </div>
  )
}
