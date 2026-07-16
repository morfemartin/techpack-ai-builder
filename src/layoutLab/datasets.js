// ─────────────────────────────────────────────────────────────────────────
// LAYOUT LAB · Datasets (Fase 1 — sistema de diseño aislado)
//
// Cada dataset es una PRENDA COMPLEJA con diseños únicos: define el `ctx`
// (garment/parts/designs/hdr) que alimenta al motor de layout. NO define el
// plan de página - en Fase 1 los planes son fixtures a mano (fixtures.js)
// para aislar el renderizador; en Fase 2 el plan lo generará la IA a partir
// de este mismo ctx.
//
// Todo es data pura: ni una llamada a la API, ni al cuestionario, ni al chat.
// ─────────────────────────────────────────────────────────────────────────

function hdr(over) {
  return {
    brand: "ATELIER MORFE",
    season: "2027 FW",
    sno: "N/A",
    cat: "N/A",
    fab: "N/A",
    fac: "Portugal",
    ind: "12/01/2027",
    outd: "28/02/2027",
    pname: "N/A",
    ...over,
  }
}

// ── 1 · Parka técnica 3-en-1 ──────────────────────────────────────────────
// Stress: BOM grande (paginación), split partsList↔ilustración con contenido
// suficiente (debe quedar en fila), bordado reflectivo + print en espalda.
const parka = {
  id: "parka",
  label: "Parka técnica 3-en-1",
  note: "Shell + forro polar desmontable. BOM extenso, doble diseño.",
  hdr: hdr({ pname: "Parka Storm-Shell 3L", cat: "Prenda Superior", fab: "3L nylon ripstop / PFC-free DWR" }),
  garment: {
    label: { ES: "Parka técnica", EN: "Technical parka" },
    partLabels: {
      ES: {
        shell: "Shell exterior 3 capas",
        seams: "Costuras selladas",
        hood: "Capucha desmontable",
        hoodwire: "Visera con alambre",
        zip2way: "Cierre frontal 2-way",
        stormflap: "Tapeta antiviento",
        cargo: "Bolsillos cargo",
        handwarm: "Bolsillos térmicos",
        pitzip: "Ventilación axilar",
        cuff: "Puños ajustables velcro",
        hem: "Dobladillo con cordón",
        liner: "Forro polar desmontable",
        linerzip: "Cierre de unión forro",
        drawcord: "Cordón de cintura",
        rib: "Ribete reflectivo",
        label: "Etiqueta tejida interior",
      },
    },
  },
  parts: [
    { id: "shell", val: "Nylon ripstop 3L, 40D, PFC-free DWR", on: true },
    { id: "seams", val: "100% selladas, cinta 13mm", on: true },
    { id: "hood", val: "Desmontable con snaps, ajuste 3 puntos", on: true },
    { id: "hoodwire", val: "Alambre aluminio Ø1.2mm en visera", on: true },
    { id: "zip2way", val: "YKK Vislon #8 2-way, storm garage", on: true },
    { id: "stormflap", val: "Doble tapeta, velcro + snaps ocultos", on: true },
    { id: "cargo", val: "2x fuelle 220x200mm, solapa magnética", on: true },
    { id: "handwarm", val: "2x forro polar 200g, cierre YKK #5", on: true },
    { id: "pitzip", val: "YKK #5 invertido, 260mm", on: true },
    { id: "cuff", val: "Velcro 55mm + elástico interno", on: true },
    { id: "hem", val: "Cordón shock + toggles laterales", on: true },
    { id: "liner", val: "Polar 300g grid, cierre perimetral", on: true },
    { id: "linerzip", val: "YKK #5 continuo, unión shell", on: true },
    { id: "drawcord", val: "Cordón cintura interno, toggle central", on: true },
    { id: "rib", val: "Ribete 3M Scotchlite 8mm", on: true },
    { id: "label", val: "Tejido damasco 40x60mm, cuello interior", on: true },
  ],
  designs: [
    {
      name: "Logo pecho reflectivo",
      pos: "Pecho izquierdo",
      posDetail: "80mm sobre línea de pecho, centrado a costura frontal",
      tec: "Bordado Plano",
      w: 70,
      h: 22,
      fileName: "morfe_chest_reflective.emb",
      driveLink: "drive.morfe/parka/chest",
      illustrationBrief:
        "Dibujar el frente de la parka en plano técnico, acotando la posición exacta del bordado (80mm bajo costura de hombro, centrado). Mostrar dirección de puntada y borde reflectivo.",
      colors: [
        { name: "Reflective Silver", hex: "#C7CBD1" },
        { name: "Storm Black", hex: "#17181B" },
      ],
      emb: {
        machine: "Tajima TMEZ, hilo reflectivo",
        stitches: "9800",
        colorChanges: 2,
        stops: 2,
        trims: 4,
        fabric: "Nylon 3L sobre estabilizador cut-away",
        stabTopping: "Film soluble 1x",
        stabBacking: "Cut-away 2.5oz",
        w: 70,
        h: 22,
        area: 1540,
        maxStitch: 4.2,
        minStitch: 0.8,
        maxJump: 3.5,
        totalThread: "12.4 m",
        totalBobbin: "4.1 m",
        stopSeq: [
          { stop: 1, name: "Base Storm Black", stitches: 6100 },
          { stop: 2, name: "Contorno Reflective Silver", stitches: 3700 },
        ],
      },
    },
    {
      name: "Print espalda topográfico",
      pos: "Espalda completa",
      posDetail: "Centrado, 40mm bajo costura de cuello, 320mm ancho",
      tec: "Sublimacion",
      w: 320,
      h: 380,
      fileName: "morfe_back_topo.png",
      driveLink: "drive.morfe/parka/back",
      illustrationBrief:
        "Vista trasera plana. Ubicar el print topográfico centrado, 40mm bajo cuello. Indicar sangrado sobre costuras laterales y zona de no-impresión en ventilación.",
      colors: [
        { name: "Glacier Blue", hex: "#5B7C99" },
        { name: "Moss", hex: "#5A6247" },
        { name: "Storm Black", hex: "#17181B" },
        { name: "Ice", hex: "#D9E2E8" },
      ],
    },
  ],
}

// ── 2 · Hoodie oversized dropped-shoulder ─────────────────────────────────
// Stress: embSpecs pesado (secuencia de paradas larga) junto a ilustración
// → split en fila; colorSpecs medio.
const hoodie = {
  id: "hoodie",
  label: "Hoodie oversized dropped-shoulder",
  note: "French terry pesado. Bordado de pecho denso con secuencia larga.",
  hdr: hdr({ pname: "Hoodie Heavyweight OS", cat: "Prenda Superior", fab: "French terry 480 g/m² algodón peinado" }),
  garment: {
    label: { ES: "Hoodie oversized", EN: "Oversized hoodie" },
    partLabels: {
      ES: {
        body: "Cuerpo french terry",
        hood: "Capucha doble capa",
        drawcord: "Cordón plano + tips metálicos",
        kanga: "Bolsillo canguro",
        cuff: "Puños rib 2x2",
        hem: "Ribete inferior rib 2x2",
        shoulder: "Hombro caído",
        eyelet: "Ojales metálicos",
      },
    },
  },
  parts: [
    { id: "body", val: "French terry 480g, algodón peinado", on: true },
    { id: "hood", val: "Doble capa, 3 paneles, sin forro", on: true },
    { id: "drawcord", val: "Plano 12mm, tips metal níquel mate", on: true },
    { id: "kanga", val: "Canguro con apertura lateral, bartack", on: true },
    { id: "cuff", val: "Rib 2x2 elastano 5%, 80mm", on: true },
    { id: "hem", val: "Rib 2x2 elastano 5%, 60mm", on: true },
    { id: "shoulder", val: "Caída natural +40mm sobre hombro", on: true },
    { id: "eyelet", val: "Ojal metal Ø5mm, níquel mate", on: true },
  ],
  designs: [
    {
      name: "Bordado pecho denso",
      pos: "Pecho centro",
      posDetail: "Centrado, 120mm bajo cuello",
      tec: "Bordado 3D",
      w: 180,
      h: 90,
      fileName: "morfe_hoodie_chest.emb",
      driveLink: "drive.morfe/hoodie/chest",
      illustrationBrief:
        "Frente plano del hoodie. Acotar el bloque de bordado (180x90mm) centrado a 120mm del cuello. Señalar zonas 3D foam vs plano.",
      colors: [
        { name: "Off White", hex: "#EDE8DD" },
        { name: "Rust", hex: "#9E4A2E" },
        { name: "Forest", hex: "#2F4433" },
      ],
      emb: {
        machine: "Barudan 9-needle, foam 3mm",
        stitches: "28400",
        colorChanges: 5,
        stops: 6,
        trims: 14,
        fabric: "French terry 480g + cut-away 3oz",
        stabTopping: "Film soluble 2x",
        stabBacking: "Cut-away 3oz doble",
        w: 180,
        h: 90,
        area: 16200,
        maxStitch: 4.5,
        minStitch: 0.6,
        maxJump: 4.0,
        totalThread: "48.7 m",
        totalBobbin: "16.2 m",
        stopSeq: [
          { stop: 1, name: "Underlay total", stitches: 5200 },
          { stop: 2, name: "Foam Rust (3D)", stitches: 8100 },
          { stop: 3, name: "Cobertura Forest", stitches: 6400 },
          { stop: 4, name: "Detalle Off White", stitches: 4300 },
          { stop: 5, name: "Contorno Rust", stitches: 2900 },
          { stop: 6, name: "Remate y tack", stitches: 1500 },
        ],
      },
    },
    {
      name: "Print manga izquierda",
      pos: "Manga izquierda exterior",
      posDetail: "Vertical, desde codo a puño",
      tec: "Impresion",
      w: 60,
      h: 240,
      fileName: "morfe_hoodie_sleeve.png",
      driveLink: "drive.morfe/hoodie/sleeve",
      illustrationBrief: "Vista lateral izquierda. Print vertical codo→puño, 60mm ancho. Indicar orientación de lectura.",
      colors: [
        { name: "Rust", hex: "#9E4A2E" },
        { name: "Off White", hex: "#EDE8DD" },
      ],
    },
  ],
}

// ── 3 · Falda plisada midi ────────────────────────────────────────────────
// Stress: colorSpecs MUY pesado (10 colorways) → columna alta, split en fila;
// y una variante corta (2 colores) que debería APILAR.
const skirt = {
  id: "skirt",
  label: "Falda plisada midi",
  note: "Plisado permanente. Carta de 10 colorways — stress de colorSpecs.",
  hdr: hdr({ pname: "Falda Sunray Pleat Midi", cat: "Prenda Inferior", fab: "Poliéster micro-plisado 90 g/m²" }),
  garment: {
    label: { ES: "Falda plisada", EN: "Pleated skirt" },
    partLabels: {
      ES: {
        panel: "Panel plisado sunray",
        waist: "Pretina forrada",
        zip: "Cierre invisible lateral",
        lining: "Forro cupro",
        hem: "Dobladillo termosellado",
      },
    },
  },
  parts: [
    { id: "panel", val: "Sunray pleat permanente, 24 tablas", on: true },
    { id: "waist", val: "Pretina 35mm forrada, gancho + barra", on: true },
    { id: "zip", val: "YKK invisible #3, lateral izq. 180mm", on: true },
    { id: "lining", val: "Cupro anti-estático, 1cm más corto", on: true },
    { id: "hem", val: "Termosellado 6mm, sin costura visible", on: true },
  ],
  designs: [
    {
      name: "Carta de color completa",
      pos: "Toda la prenda",
      posDetail: "Color sólido teñido en pieza",
      tec: "Tintura",
      fileName: "morfe_skirt_colorcard.ase",
      driveLink: "drive.morfe/skirt/colors",
      illustrationBrief:
        "Vista frontal y ¾ del plisado. Mostrar caída del sunray y dirección de tablas. La carta de color va como referencia de teñido en pieza.",
      colors: [
        { name: "Bone", hex: "#E7E1D4" },
        { name: "Sand", hex: "#CDB596" },
        { name: "Terracotta", hex: "#B4633F" },
        { name: "Olive", hex: "#6B6B3A" },
        { name: "Forest", hex: "#2F4433" },
        { name: "Petrol", hex: "#1F5560" },
        { name: "Denim", hex: "#3C5A78" },
        { name: "Plum", hex: "#5B3A55" },
        { name: "Charcoal", hex: "#33353A" },
        { name: "Black", hex: "#141518" },
      ],
    },
    {
      name: "Cápsula 2 tonos",
      pos: "Toda la prenda",
      posDetail: "Color sólido teñido en pieza",
      tec: "Tintura",
      fileName: "morfe_skirt_capsule.ase",
      driveLink: "drive.morfe/skirt/capsule",
      illustrationBrief: "Vista frontal del plisado para la cápsula de 2 tonos.",
      colors: [
        { name: "Bone", hex: "#E7E1D4" },
        { name: "Black", hex: "#141518" },
      ],
    },
  ],
}

// ── 4 · Varsity jacket (lana + cuero) ─────────────────────────────────────
// Stress: ilustración multi-slot (4 vistas) + partsList corto → debe APILAR;
// parche chenille grande + letra bordada + label tejida.
const varsity = {
  id: "varsity",
  label: "Varsity jacket lana + cuero",
  note: "Bomber lana melton, mangas cuero. 3 diseños: parche, letra, label.",
  hdr: hdr({ pname: "Varsity Melton College", cat: "Prenda Superior", fab: "Lana melton 700g / cuero napa" }),
  garment: {
    label: { ES: "Varsity jacket", EN: "Varsity jacket" },
    partLabels: {
      ES: {
        bodywool: "Cuerpo lana melton",
        leather: "Mangas cuero napa",
        ribcollar: "Cuello rib rayado",
        ribcuff: "Puños rib rayado",
        ribhem: "Dobladillo rib rayado",
        snaps: "Broches frontales",
        welt: "Bolsillos welt",
        quilt: "Forro acolchado satén",
      },
    },
  },
  parts: [
    { id: "bodywool", val: "Melton 700g, 80% lana / 20% nylon", on: true },
    { id: "leather", val: "Napa 1.2mm, curtido vegetal", on: true },
    { id: "ribcollar", val: "Rib rayado 2 tonos, 60mm", on: true },
    { id: "ribcuff", val: "Rib rayado 2 tonos, 75mm", on: true },
    { id: "ribhem", val: "Rib rayado 2 tonos, 70mm", on: true },
    { id: "snaps", val: "5x broches latón antiguo, grabados", on: true },
    { id: "welt", val: "2x welt diagonal, forro polar", on: true },
    { id: "quilt", val: "Satén acolchado rombo, 60g wadding", on: true },
  ],
  designs: [
    {
      name: "Parche chenille espalda",
      pos: "Espalda completa",
      posDetail: "Centrado, letra 'M' 300mm alto",
      tec: "Parche Tejido",
      w: 280,
      h: 300,
      fileName: "morfe_varsity_chenille.ai",
      driveLink: "drive.morfe/varsity/back",
      illustrationBrief:
        "Vista trasera. Parche chenille 'M' centrado, 300mm alto, borde soutache. Indicar zona de aplicación y tipo de costura de fijación.",
      colors: [
        { name: "Cream Chenille", hex: "#EDE3C8" },
        { name: "Bottle Green", hex: "#1E3A2B" },
      ],
    },
    {
      name: "Letra bordada pecho",
      pos: "Pecho izquierdo",
      posDetail: "Inicial 90mm, centrada a bolsillo",
      tec: "Bordado 3D",
      w: 70,
      h: 90,
      fileName: "morfe_varsity_chest.emb",
      driveLink: "drive.morfe/varsity/chest",
      illustrationBrief: "Frente. Letra bordada 3D foam, 90mm, sobre pecho izquierdo alineada al bolsillo welt.",
      colors: [
        { name: "Cream", hex: "#EDE3C8" },
        { name: "Bottle Green", hex: "#1E3A2B" },
        { name: "Gold", hex: "#B08D2E" },
      ],
      emb: {
        machine: "Barudan 6-needle, foam 3mm",
        stitches: "11200",
        colorChanges: 3,
        stops: 3,
        trims: 6,
        fabric: "Melton 700g + cut-away 3oz",
        stabTopping: "Film soluble",
        stabBacking: "Cut-away 3oz",
        w: 70,
        h: 90,
        area: 6300,
        maxStitch: 4.0,
        minStitch: 0.7,
        maxJump: 3.8,
        totalThread: "19.2 m",
        totalBobbin: "6.4 m",
        stopSeq: [
          { stop: 1, name: "Foam Cream", stitches: 6200 },
          { stop: 2, name: "Borde Bottle Green", stitches: 3400 },
          { stop: 3, name: "Detalle Gold", stitches: 1600 },
        ],
      },
    },
    {
      name: "Label tejida interior",
      pos: "Cuello interior",
      posDetail: "Damasco 45x70mm, centrado",
      tec: "Jacquard",
      w: 45,
      h: 70,
      fileName: "morfe_varsity_label.jpg",
      driveLink: "drive.morfe/varsity/label",
      illustrationBrief: "Detalle interior de cuello. Label tejida damasco 45x70mm centrada, costura perimetral.",
      colors: [
        { name: "Cream", hex: "#EDE3C8" },
        { name: "Bottle Green", hex: "#1E3A2B" },
      ],
    },
  ],
}

// ── 5 · Bikini set técnico ────────────────────────────────────────────────
// Stress: caso "etiqueta" del bug reportado — pocas piezas + ilustración,
// print all-over sublimado (whole-garment), specs muy cortos → debe APILAR.
const bikini = {
  id: "bikini",
  label: "Bikini set técnico",
  note: "Print all-over sublimado. Specs cortos — reproduce el caso del bug.",
  hdr: hdr({ pname: "Bikini Set Sublimado", cat: "Accesorio", fab: "Econyl® 78% / elastano 22%, 210 g/m²" }),
  garment: {
    label: { ES: "Bikini set", EN: "Bikini set" },
    partLabels: {
      ES: {
        top: "Top triangular",
        band: "Banda inferior",
        strap: "Breteles ajustables",
        lining: "Forro frontal",
        elastic: "Elástico recubierto",
      },
    },
  },
  parts: [
    { id: "top", val: "Triangular con copa removible", on: true },
    { id: "band", val: "Banda inferior tiro medio", on: true },
    { id: "strap", val: "Bretel 8mm, regulador níquel", on: true },
    { id: "lining", val: "Forro frontal power-mesh", on: true },
    { id: "elastic", val: "Elástico recubierto 6mm, cloro-resist", on: true },
  ],
  designs: [
    {
      name: "Print all-over sublimado",
      pos: "Toda la prenda",
      posDetail: "Sublimación total, engineered al molde",
      tec: "Sublimacion",
      fileName: "morfe_bikini_allover.tif",
      driveLink: "drive.morfe/bikini/print",
      illustrationBrief:
        "Vista frontal plana del top y la banda. Print engineered al molde — mostrar continuidad del patrón sobre costuras y zona de forro sin print.",
      colors: [
        { name: "Coral", hex: "#E4694A" },
        { name: "Ink", hex: "#141518" },
      ],
    },
    {
      name: "Herrajes metálicos",
      pos: "Breteles y espalda",
      posDetail: "Reguladores y gancho níquel mate",
      tec: "Tintura",
      fileName: "morfe_bikini_hardware.pdf",
      driveLink: "drive.morfe/bikini/hardware",
      illustrationBrief: "Detalle de herrajes: regulador de bretel y gancho de espalda, níquel mate cloro-resistente.",
      colors: [{ name: "Nickel Matte", hex: "#9A9DA3" }],
    },
  ],
}

export const DATASETS = { parka, hoodie, skirt, varsity, bikini }

// Construye el ctx que buildPlannedPages espera, a partir de un dataset.
export function ctxFor(dataset, lang = "ES") {
  return {
    lang,
    hdr: dataset.hdr,
    parts: dataset.parts,
    designs: dataset.designs,
    logo: null,
    txData: null,
    garment: dataset.garment,
  }
}
