export function ImageUploader({ d, onUpdate }) {
  function handleFile(e) {
    var f = e.target.files[0]
    if (!f) return
    var issvg = f.type === "image/svg+xml"
    var reader = new FileReader()
    reader.onload = function (ev) {
      var result = ev.target.result
      var img = new Image()
      img.onload = function () {
        onUpdate({ imageData: result.split(",")[1], imageType: issvg ? "svg" : "png", imgNatW: img.naturalWidth, imgNatH: img.naturalHeight })
      }
      img.src = result
    }
    reader.readAsDataURL(f)
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ padding: "7px 14px", background: d.imageData ? "#FFFFFF" : "#FFFFFF", border: "1.5px dashed " + (d.imageData ? "#1A3FB0" : "#1A3FB0"), borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, color: d.imageData ? "#1A3FB0" : "#1A3FB0" }}>
          {d.imageData ? "Imagen cargada - cambiar" : "Subir PNG o SVG del diseno"}
          <input type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {d.imageData && (
          <button onClick={() => onUpdate({ imageData: null, imageType: null, imgNatW: null, imgNatH: null })} style={{ background: "none", border: "none", color: "#E5352B", cursor: "pointer", fontSize: 13 }}>
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
            <div style={{ color: "#E5352B", fontWeight: 600 }}>Las cotas se muestran con los valores de Ancho/Alto (mm) que ingresaste arriba</div>
          </div>
        </div>
      )}
    </div>
  )
}
