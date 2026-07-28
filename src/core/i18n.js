// The APP'S OWN chrome (buttons, helper text, status messages) - distinct
// from T below, which is the language of the EXPORTED tech-pack document
// (the wizard's own "Idioma" step). Before this, App.jsx hardcoded `T.ES`
// for its whole UI regardless of what export language(s) the user picked,
// so the builder itself was always Spanish. Kept separate from T on purpose:
// T's keys describe document content (a garment's category options, its
// applicable embroidery techniques); mixing pure UI actions ("Quitar",
// "Agregar Pieza") into that table would blur what T is actually for.
//
// Scope note: this covers static UI chrome. Two things are deliberately OUT
// of scope here - a UI-language toggle can't reach them without changing
// their own source: (1) prose the AI itself writes (chat replies, design
// briefs) - see GarmentChat.jsx's own prompts; (2) the descriptive warning
// strings visionExtract.js builds internally (e.g. "Foto 2/3: no se pudo
// completar..."), which are business logic, not simple static labels.
export const UI = {
  ES: {
    garmentHelp: "Vas a charlar con la IA en el paso \"Piezas\" para armar esta prenda desde cero — no tiene el dibujo de silueta a mano de las prendas ya registradas, pero la tabla de piezas y el resto de la ficha funcionan igual.",
    newGarmentAI: "Prenda nueva (con IA)",
    garmentFromPhoto: "Prenda desde foto (IA)",
    visionHelp: "Subí una o mas fotos de la prenda real. La IA identifica el tipo de prenda y lo que se ve con claridad (color, cuello, cierre, etc.); en el paso \"Piezas\" solo te va a preguntar lo que la foto no reveló.",
    analyzingPhotos: "Analizando foto(s)…",
    changePhotos: "Cambiar foto(s)",
    uploadPhotos: "Subir foto(s)",
    detected: "Detectado",
    notIdentified: "(no identificado)",
    noAttributesDetected: "No se detectaron atributos con certeza - se preguntará todo en \"Piezas\".",
    changeLogo: "Cambiar logo",
    uploadLogoImage: "Subir imagen (PNG, JPG, SVG)",
    brandLogo: "Logo de la Marca",
    remove: "Quitar",
    required: "Requerido",
    importFromCsv: "Importar desde CSV (opcional)",
    csvHelp: "Subí un CSV con las piezas (y de paso los diseños, si los incluís) — la IA lo interpreta, no hace falta que el formato sea exacto.",
    viewExample: "Ver ejemplo",
    uploadPhotosOptional: "Subir fotos (opcional)",
    analyzing: "Analizando...",
    uploadCsv: "Subir CSV",
    addPiece: "Agregar Pieza",
    customPiece: "Pieza personalizada",
    removeDesign: "Quitar diseño",
    name: "Nombre",
    position: "Posicion",
    technique: "Tecnica",
    unitOfMeasure: "Unidad medida",
    printIn: "Imprimir en",
    willShowAs: "En la ficha saldrá",
    colorsFieldLabel: "Colores (selector + nombre Pantone)",
    designImageFieldLabel: "Imagen del diseno (PNG o SVG - se muestra con cotas)",
    addDesign: "Agregar Diseño",
    view: "Vista",
    designingPages: "Diseñando páginas…",
    viewAllTitle: "Ver todas las paginas en una sola vista",
    viewAll: "Ver todas",
    grayscaleTitle: "Vista previa y exportacion en blanco y negro (escala de grises)",
    grayscale: "Escala de grises",
    translating: "Traduciendo…",
    designingDocument: "Disenando documento...",
    structuringDocument: "Estructurando el documento...",
    documentReadyLabel: "Documento listo",
    downloadGarmentFileTitle: "Descarga un archivo .js de partida para contribuir esta prenda al repo - ver CONTRIBUTING.md",
    downloadGarmentFile: "Descargar prenda (.js)",
    mainPage: "Pag. Principal",
    analyzingGarment: "Analizando la prenda",
    decidingPages: "Decidiendo que paginas necesita esta ficha.",
    queued: "En cola",
    designingThisPage: "Diseñando esta pagina",
    aiDecidingBlocks: "La IA esta decidiendo bloques y jerarquia visual.",
    planFailed: "El plan de documento con IA falló - usando la estructura de páginas estándar.",
    page: "Pagina",
    generateHint: "Genera el SVG por idioma arriba",
    ready: "listo",
    offline: "servicio apagado",
    loading: "cargando",
    goToPublic: "Ir a la version publica (NVIDIA)",
    goToStudio: "Ir a la version estudio (Qwen local, privado)",
    toPublic: "→ publica",
    toStudio: "→ studio",
    exportTitle: "Exportación vectorial",
    exportSubtitle: "Cada página = un SVG A4 con capas semánticas",
    close: "Cerrar",
    downloadedNextStep: "Descargado — próximo paso:",
    preparing: "Preparando...",
    downloadCompletePack: "Descargar ficha completa",
    downloadCompletePackTitle: "pages/*.svg + el script que las fusiona en un solo .ai con capas nativas",
    packageFailed: "No se pudo generar el paquete.",
    reviewTitle: "Revisión final",
    reviewingProduction: "Revisando producción…",
    reviewDone: "Listo",
    skipReviewTitle: "Saltar la revisión y generar igual",
    downloadAnyway: "Descargar igual",
    typeValuePlaceholder: "Escribí el valor...",
    reviewingProductionDetails: "Revisando detalles de producción…",
    thinkingLikeDesigner: "Pensando como diseñador técnico sobre lo ya decidido - cantidades, distancias, variantes.",
    reviewCompleted: "Revisión completada",
    couldNotApplyReview: "No se pudo aplicar la revisión.",
    applyingReview: "Aplicando revisión...",
    retry: "Reintentar",
    applyAndDownload: "Aplicar y descargar",
    reviewAssurance: "La revisión asegura que el documento sea 100% fiel a lo que pediste.",
    chatOpening: "¿Qué prenda querés armar? (por ejemplo: Polo, Hoodie, Camisa, Jogger)",
    studyingGarment: "Estoy estudiando esta prenda: qué lleva y qué necesita la ficha…",
    identifiedDecisions: "Ya identifiqué estas decisiones de producción:",
    couldNotAnalyzeGarment: "No se pudo analizar la prenda.",
    couldNotAnalyzeGarmentTimeout: "los modelos no respondieron a tiempo",
    analysisFailedMessage: "No voy a inventar preguntas genericas para disimularlo. Proba de nuevo, o revisa que la IA este disponible.",
    reviewingApplications: "Estoy revisando qué aplicaciones necesitan su propia especificación…",
    detectedDesignSpecs: "Ya detecté estas especificaciones de diseño:",
    couldNotDeepenDesigns: "No pude profundizar los diseños con IA, pero seguimos con las preguntas esenciales de esa aplicacion.",
    noApplicationsDetected: "No detecté aplicaciones que requieren una página propia.",
    draftingIllustrationInstructions: "Estoy redactando las instrucciones para ilustración…",
    elementsDefined: "Ya quedaron definidos estos elementos:",
    couldNotDraftBriefsError: "No se pudieron redactar los briefs de ilustración. Podés continuar igual.",
    couldNotDraftBriefsMessage: "No pude redactar las instrucciones de ilustración todavía, pero podés continuar igual.",
    reviewingProductionOwnDetails: "Estoy revisando los detalles de producción propios de esta prenda…",
    finalReviewMessage: "Último repaso, pensando como diseñador técnico: los detalles que la fábrica tendría que adivinar si no los definimos.",
    anythingElseQuestion: "¿Hay algo que no te haya preguntado y creas importante para la fábrica? Podés escribirlo, o tocar \"Nada más\" para continuar.",
    gotEverythingNeeded: "Listo, ya tengo lo que faltaba. Podés continuar.",
    gotGeneralConstruction: "Ya tengo la construcción general. Ahora reviso qué elementos necesitan su propia página de diseño…",
    gotDesigns: "Ya tengo los diseños. Ahora redacto la instrucción de ilustración para cada página…",
    correctingThat: "Corrijamos eso.",
    skip: "Saltar",
    correctPrefix: "Corregir",
    couldNotAnswerTangent: "No pude responder eso. Podés seguir con la pregunta igual.",
    reviewingDoubt: "Estoy revisando esa duda…",
    noNewDataFound: "No pude identificar datos nuevos concretos ahí, pero lo tengo anotado igual. ¿Algo más, o tocás \"Nada más\"?",
    couldNotProcessWithAI: "No pude procesarlo con la IA, pero lo tengo anotado igual. ¿Algo más, o tocás \"Nada más\"?",
    nothingElse: "Nada más",
    allSetContinue: "Listo, ya tengo todo. Podés continuar.",
    accordingToPhotoPrefix: "Según la foto",
    couldNotAnalyzePhoto: "No se pudo analizar la foto.",
    couldNotReadImage: "No se pudo leer esa imagen. Probá con otro archivo PNG o SVG.",
    askingPlaceholder: "Elegí una opción, escribí la tuya, o preguntá algo...",
    disambiguationPlaceholder: "Elegí una opción o escribí la tuya...",
    finalCheckPlaceholder: "Algo que no te pregunté (opcional)...",
    defaultAnswerPlaceholder: "Escribí tu respuesta...",
    answerWithPhotoTitle: "Responder esta pregunta con una foto",
    continueWithGarment: "Continuar con esta prenda",
    nothingElseContinue: "Nada más, continuar",
    retryAnalysis: "Reintentar analisis",
    draftLabel: "Borrador",
    noDataYet: "Todavía no hay datos.",
    designsPagesLabel: "Diseños (páginas propias)",
    subQuestionsLabel: "Sub-preguntas",
    optionalSuffix: " (opcional)",
    imageLoadedChange: "Imagen cargada - cambiar",
    uploadDesignImageNow: "Subí el PNG/SVG ahora (o dejalo para después)",
    designAttachedAlt: "Diseño adjunto",
    analyzingPhotoDefault: "Analizando foto",
    preparingFullView: "Preparando vista completa y detalles…",
    processingInfo: "Estoy procesando la información…",
    attachedPhotoAlt: "Foto adjunta",
    productionDetailsLayer: "Detalles de produccion",
    forTheTechPack: "Para la ficha",
    back: "Volver",
  },
  EN: {
    garmentHelp: "You'll chat with the AI in the \"Parts\" step to build this garment from scratch — it has no hand-drawn silhouette like the registered garments, but the parts table and the rest of the tech pack still work the same.",
    newGarmentAI: "New garment (with AI)",
    garmentFromPhoto: "Garment from photo (AI)",
    visionHelp: "Upload one or more photos of the real garment. The AI identifies the garment type and whatever is clearly visible (color, collar, closure, etc.); in the \"Parts\" step it will only ask about what the photo didn't reveal.",
    analyzingPhotos: "Analyzing photo(s)…",
    changePhotos: "Change photo(s)",
    uploadPhotos: "Upload photo(s)",
    detected: "Detected",
    notIdentified: "(not identified)",
    noAttributesDetected: "No attributes were detected with confidence - everything will be asked in \"Parts\".",
    changeLogo: "Change logo",
    uploadLogoImage: "Upload image (PNG, JPG, SVG)",
    brandLogo: "Brand Logo",
    remove: "Remove",
    required: "Required",
    importFromCsv: "Import from CSV (optional)",
    csvHelp: "Upload a CSV with the parts (and the designs too, if you include them) — the AI interprets it, the format doesn't need to be exact.",
    viewExample: "View example",
    uploadPhotosOptional: "Upload photos (optional)",
    analyzing: "Analyzing...",
    uploadCsv: "Upload CSV",
    addPiece: "Add Part",
    customPiece: "Custom part",
    removeDesign: "Remove design",
    name: "Name",
    position: "Position",
    technique: "Technique",
    unitOfMeasure: "Unit",
    printIn: "Print in",
    willShowAs: "The tech pack will show",
    colorsFieldLabel: "Colors (picker + Pantone name)",
    designImageFieldLabel: "Design image (PNG or SVG - shown with dimensions)",
    addDesign: "Add Design",
    view: "View",
    designingPages: "Designing pages…",
    viewAllTitle: "View every page in a single view",
    viewAll: "View all",
    grayscaleTitle: "Black-and-white preview and export (grayscale)",
    grayscale: "Grayscale",
    translating: "Translating…",
    designingDocument: "Designing document...",
    structuringDocument: "Structuring the document...",
    documentReadyLabel: "Document ready",
    downloadGarmentFileTitle: "Downloads a starter .js file to contribute this garment to the repo - see CONTRIBUTING.md",
    downloadGarmentFile: "Download garment (.js)",
    mainPage: "Main Page",
    analyzingGarment: "Analyzing the garment",
    decidingPages: "Deciding which pages this tech pack needs.",
    queued: "Queued",
    designingThisPage: "Designing this page",
    aiDecidingBlocks: "The AI is deciding blocks and visual hierarchy.",
    planFailed: "The AI document plan failed - using the standard page structure.",
    page: "Page",
    generateHint: "Generate the SVG per language above",
    ready: "ready",
    offline: "service offline",
    loading: "loading",
    goToPublic: "Go to the public version (NVIDIA)",
    goToStudio: "Go to the studio version (local Qwen, private)",
    toPublic: "→ public",
    toStudio: "→ studio",
    exportTitle: "Vector export",
    exportSubtitle: "Each page = one A4 SVG with semantic layers",
    close: "Close",
    downloadedNextStep: "Downloaded — next step:",
    preparing: "Preparing...",
    downloadCompletePack: "Download complete tech pack",
    downloadCompletePackTitle: "pages/*.svg + the script that fuses them into one .ai with native layers",
    packageFailed: "Could not generate the package.",
    reviewTitle: "Final review",
    reviewingProduction: "Reviewing production…",
    reviewDone: "Done",
    skipReviewTitle: "Skip the review and generate anyway",
    downloadAnyway: "Download anyway",
    typeValuePlaceholder: "Type the value...",
    reviewingProductionDetails: "Reviewing production details…",
    thinkingLikeDesigner: "Thinking like a technical designer about what's already decided - quantities, distances, variants.",
    reviewCompleted: "Review completed",
    couldNotApplyReview: "Could not apply the review.",
    applyingReview: "Applying review...",
    retry: "Retry",
    applyAndDownload: "Apply and download",
    reviewAssurance: "The review makes sure the document is 100% faithful to what you asked for.",
    chatOpening: "What garment do you want to build? (e.g. Polo, Hoodie, Shirt, Jogger)",
    studyingGarment: "Studying this garment: what it has and what the tech pack needs…",
    identifiedDecisions: "I've identified these production decisions:",
    couldNotAnalyzeGarment: "Could not analyze the garment.",
    couldNotAnalyzeGarmentTimeout: "the models did not respond in time",
    analysisFailedMessage: "I'm not going to invent generic questions to cover for it. Try again, or check that the AI is available.",
    reviewingApplications: "Reviewing which applications need their own specification…",
    detectedDesignSpecs: "I've detected these design specifications:",
    couldNotDeepenDesigns: "Could not go deeper on designs with AI, but we'll continue with the essential questions for that application.",
    noApplicationsDetected: "No applications detected that need their own page.",
    draftingIllustrationInstructions: "Drafting the illustration instructions…",
    elementsDefined: "These elements are now defined:",
    couldNotDraftBriefsError: "Could not draft the illustration briefs. You can continue anyway.",
    couldNotDraftBriefsMessage: "Could not draft the illustration instructions yet, but you can continue anyway.",
    reviewingProductionOwnDetails: "Reviewing this garment's own production details…",
    finalReviewMessage: "Last pass, thinking like a technical designer: the details the factory would otherwise have to guess.",
    anythingElseQuestion: "Is there anything I haven't asked that you think matters to the factory? You can type it, or tap \"Nothing else\" to continue.",
    gotEverythingNeeded: "Done, I have what was missing. You can continue.",
    gotGeneralConstruction: "I have the general construction. Now checking which elements need their own design page…",
    gotDesigns: "I have the designs. Now drafting the illustration instruction for each page…",
    correctingThat: "Let's fix that.",
    skip: "Skip",
    correctPrefix: "Fix",
    couldNotAnswerTangent: "Could not answer that. You can continue with the question anyway.",
    reviewingDoubt: "Looking into that…",
    noNewDataFound: "Could not identify concrete new data there, but it's noted anyway. Anything else, or tap \"Nothing else\"?",
    couldNotProcessWithAI: "Could not process it with AI, but it's noted anyway. Anything else, or tap \"Nothing else\"?",
    nothingElse: "Nothing else",
    allSetContinue: "Done, I have everything. You can continue.",
    accordingToPhotoPrefix: "According to the photo",
    couldNotAnalyzePhoto: "Could not analyze the photo.",
    couldNotReadImage: "Could not read that image. Try another PNG or SVG file.",
    askingPlaceholder: "Choose an option, type your own, or ask something...",
    disambiguationPlaceholder: "Choose an option or type your own...",
    finalCheckPlaceholder: "Something I didn't ask (optional)...",
    defaultAnswerPlaceholder: "Type your answer...",
    answerWithPhotoTitle: "Answer this question with a photo",
    continueWithGarment: "Continue with this garment",
    nothingElseContinue: "Nothing else, continue",
    retryAnalysis: "Retry analysis",
    draftLabel: "Draft",
    noDataYet: "No data yet.",
    designsPagesLabel: "Designs (own pages)",
    subQuestionsLabel: "Sub-questions",
    optionalSuffix: " (optional)",
    imageLoadedChange: "Image loaded - change",
    uploadDesignImageNow: "Upload the PNG/SVG now (or leave it for later)",
    designAttachedAlt: "Attached design",
    analyzingPhotoDefault: "Analyzing photo",
    preparingFullView: "Preparing full view and details…",
    processingInfo: "Processing the information…",
    attachedPhotoAlt: "Attached photo",
    productionDetailsLayer: "Production details",
    forTheTechPack: "For the tech pack",
    back: "Back",
  },
}

// Garment-agnostic UI/output strings. Per-garment part names and design
// positions live in src/garments/*.js instead, since they differ by garment.
export const T = {
  ES: {
    steps: ["Prenda", "Idioma", "Header", "Piezas", "Disenos", "Vista Previa"],
    garmentStep: "Selecciona el tipo de prenda para esta ficha tecnica:",
    langStep: "Selecciona los idiomas del SVG exportado:",
    brand: "Marca", season: "Temporada", sno: "Codigo", cat: "Categoria", fab: "Tela", fac: "Fabrica",
    ind: "Fecha Entrada", outd: "Fecha Salida", pname: "Nombre Producto",
    nxt: "Siguiente", bk: "Atras", gen: "Generar",
    sp: "SPECS", dt: "DETALLES",
    vw: ["1. VISTA FRONTAL", "2. VISTA TRASERA", "3. VISTA IZQ.", "4. VISTA DER."],
    illZone: "ZONA DE ILUSTRACION - insertar arte aqui",
    cats: ["Accesorio", "Prenda Superior", "Prenda Inferior", "Calzado", "Otro"],
    tecs: ["Bordado 3D", "Bordado Plano", "Sublimacion", "Impresion", "Parche Tejido", "Jacquard", "Tintura"],
    pageDesign: "Diseno",
    disc: "Todos los disenos son de derecho de autor exclusivo de", discSfx: ". Todos los derechos reservados.",
    embTitle: "Ficha Tecnica de Bordado",
    posDetail: "Posicion Detallada", wDes: "Ancho diseno (mm)", hDes: "Alto diseno (mm)",
    noApplica: "Diseno cubre toda la prenda - medidas no aplican",
    fileName: "Nombre del Archivo", driveLink: "Enlace Drive",
  },
  EN: {
    steps: ["Garment", "Language", "Header", "Parts", "Designs", "Preview"],
    garmentStep: "Select the garment type for this tech pack:",
    langStep: "Select the export languages for the SVG:",
    brand: "Brand", season: "Season", sno: "Style No", cat: "Category", fab: "Fabric", fac: "Factory",
    ind: "Input Date", outd: "Output Date", pname: "Product Name",
    nxt: "Next", bk: "Back", gen: "Generate",
    sp: "SPECS", dt: "DETAILS",
    vw: ["1. FRONT VIEW", "2. BACK VIEW", "3. LEFT VIEW", "4. RIGHT VIEW"],
    illZone: "ILLUSTRATION ZONE - insert artwork here",
    cats: ["Accessory", "Topwear", "Bottomwear", "Footwear", "Other"],
    tecs: ["3D Embroidery", "Flat Embroidery", "Sublimation", "Print", "Woven Patch", "Jacquard", "Dye"],
    pageDesign: "Design",
    disc: "All designs are the exclusive copyright of", discSfx: ". All rights reserved.",
    embTitle: "Embroidery Tech Sheet",
    posDetail: "Detailed Position", wDes: "Design Width (mm)", hDes: "Design Height (mm)",
    noApplica: "Design covers entire garment - dimensions N/A",
    fileName: "File Name", driveLink: "Drive Link",
  },
  ZH: {
    steps: ["服装类型", "语言", "标题", "零件", "设计", "预览"],
    garmentStep: "选择此工艺单对应的服装类型:",
    langStep: "选择导出SVG的语言:",
    brand: "品牌", season: "季节", sno: "款号", cat: "类别", fab: "面料", fac: "工厂",
    ind: "投入日期", outd: "产出日期", pname: "产品名称",
    nxt: "下一步", bk: "返回", gen: "生成",
    sp: "规格", dt: "详情",
    vw: ["1. 正面图", "2. 背面图", "3. 左视图", "4. 右视图"],
    illZone: "插画区域 - 在此插入美工图",
    cats: ["配件", "上装", "下装", "鞋类", "其他"],
    tecs: ["3D绣花", "平绣", "升华印花", "印花", "织章", "提花", "染色"],
    pageDesign: "设计",
    disc: "本文件所有设计均为", discSfx: "的专有版权。保留所有权利。",
    embTitle: "绣花工艺单",
    posDetail: "详细位置", wDes: "设计宽度(mm)", hDes: "设计高度(mm)",
    noApplica: "设计覆盖整件服装 - 尺寸不适用",
    fileName: "文件名", driveLink: "Drive 链接",
  },
}

// Interpolated/pluralized UI strings - kept as functions rather than table
// entries since each needs its arguments woven into the sentence, not just
// substituted at a fixed slot (word order differs between ES and EN).
export function uiPhotosCount(uiLang, count) {
  return uiLang === "EN" ? count + " photo(s)" : count + " foto(s)"
}

export function uiSearchReferences(uiLang, label) {
  return uiLang === "EN" ? `Search image references for "${label}"` : `Buscar referencias de "${label}" en imagenes`
}

export function uiDevelopingPage(uiLang, index, total) {
  return uiLang === "EN" ? `Developing page ${index} of ${total}` : `Desarrollando pagina ${index} de ${total}`
}

export function uiResolvingBlock(uiLang, label) {
  return uiLang === "EN" ? `Resolving block: ${label}` : `Resolviendo bloque: ${label}`
}

export function uiApplyingRevision(uiLang, index, total) {
  return uiLang === "EN" ? `Applying revision: page ${index} of ${total}...` : `Aplicando revision: pagina ${index} de ${total}...`
}

export function uiPagesUsedFallback(uiLang, count) {
  if (uiLang === "EN") return count === 1 ? "1 page used the standard layout (AI failed)" : count + " pages used the standard layout (AI failed)"
  return count === 1 ? "1 página usó layout estándar (falló la IA)" : count + " páginas usaron layout estándar (falló la IA)"
}

export function uiExportHint(uiLang, pageCount) {
  return uiLang === "EN"
    ? `Unzip and run Techpack-Import-Illustrator.jsx (File > Scripts > Other Script) to build one .ai with the ${pageCount} pages as named artboards and the 7 native layers. Affinity: open any SVG in pages/ directly, no script needed.`
    : `Descomprimí el ZIP y corré Techpack-Import-Illustrator.jsx (Archivo > Secuencias de comandos > Otra secuencia de comandos) para armar un solo .ai con las ${pageCount} páginas como mesas de trabajo y las 7 capas nativas. Affinity: abrí cualquier SVG de pages/ directamente, sin script.`
}

export function uiExportSteps(uiLang, pageCount) {
  return uiLang === "EN"
    ? [
        "Unzip this ZIP (keep pages/ and the script together).",
        "In Illustrator: File > Scripts > Other Script... and choose Techpack-Import-Illustrator.jsx.",
        `Techpack-complete.ai is generated with the ${pageCount} pages as named artboards and the 7 native layers. (Affinity: open a page SVG directly, no script.)`,
      ]
    : [
        "Descomprimí el ZIP (dejando pages/ y el script juntos).",
        "En Illustrator: Archivo > Secuencias de comandos > Otra secuencia de comandos... y elegí Techpack-Import-Illustrator.jsx.",
        `Se genera Techpack-complete.ai con las ${pageCount} páginas como mesas de trabajo y las 7 capas nativas. (Affinity: abrí un SVG de pages/ directo, sin script.)`,
      ]
}

export function uiQuestionOf(uiLang, index, total) {
  return uiLang === "EN" ? `Question ${index} of ${total}` : `Pregunta ${index} de ${total}`
}

export function uiDocumentReflects(uiLang, headerCount, partsCount, designsCount) {
  return uiLang === "EN"
    ? `The document already reflects ${headerCount} header fields, ${partsCount} parts and ${designsCount} designs from the intake.`
    : `El documento ya refleja ${headerCount} datos de header, ${partsCount} piezas y ${designsCount} diseños del intake.`
}

export function uiWillApplyDecisions(uiLang, count) {
  return uiLang === "EN"
    ? `We'll apply ${count} decisions and only regenerate the affected pages.`
    : `Aplicaremos ${count} decisiones y regeneraremos únicamente las páginas afectadas.`
}

// The garment name and every field label/value interpolated here come from
// the AI's own output (analyzeRequirements etc., always prompted in Spanish
// - see i18n.js's top comment on why that stays out of scope) - only the
// surrounding sentence structure follows uiLang. A fully-English UI still
// shows Spanish field names inside these sentences; translating the AI's own
// output would mean re-prompting it in English, a materially different and
// riskier change than this phase's static-chrome scope.
export function uiAssumedStandard(uiLang, garmentType, assumedList) {
  return uiLang === "EN"
    ? `For a ${garmentType} I'm assuming as standard: ${assumedList}. If something doesn't apply you can correct it later. Now, what defines your garment:`
    : `Para una ${garmentType} doy por estandar: ${assumedList}. Si algo no aplica lo corregis despues. Ahora, lo que define tu prenda:`
}

export function uiPhotoConfirmedFields(uiLang, list) {
  return uiLang === "EN" ? `According to the photo analysis, I took: ${list}. Is that all correct?` : `Del análisis de fotos tomé: ${list}. ¿Todo correcto?`
}

export function uiAnalysisFailedPrefix(uiLang, reason) {
  return uiLang === "EN" ? `Could not analyze this garment: ${reason}.` : `No pude analizar esta prenda: ${reason}.`
}

export function uiAddedFields(uiLang, list) {
  return uiLang === "EN" ? `Added: ${list}. Anything else? If not, tap "Nothing else".` : `Sumado: ${list}. ¿Algo más? Si no, tocá "Nada más".`
}

export function uiFieldsDetectedSuffix(uiLang, count) {
  if (uiLang === "EN") return count + (count === 1 ? " field detected…" : " fields detected…")
  return count + (count === 1 ? " campo detectado…" : " campos detectados…")
}

export function uiMissingQuestions(uiLang, count) {
  if (uiLang === "EN") return count === 1 ? "1 question left." : `${count} questions left.`
  return count === 1 ? "Falta 1 pregunta." : `Faltan ${count} preguntas.`
}

// Announces that an answer silenced other pending questions (see
// garmentAnatomy.js's mootFieldsFromAnswer - "no lleva botones" stops the
// walk from still asking button color/count/ojales). Never silent: the user
// sees exactly what got skipped and why, and can still "↩ Atras" to bring
// them back if the pruning guessed wrong.
export function uiMootedFields(uiLang, count) {
  if (uiLang === "EN") return `(skipped ${count} related question${count === 1 ? "" : "s"} - already covered by "no")`
  return `(salteé ${count} pregunta${count === 1 ? "" : "s"} relacionada${count === 1 ? "" : "s"} - ya contestada por "no")`
}

// The derived value stored on a moot-pruned field - it must say something,
// not sit empty, since a factory reading the finished sheet should see WHY
// this was never asked instead of a blank cell.
export function uiMootedValue(uiLang, answerValue) {
  return uiLang === "EN" ? `Not applicable (${answerValue})` : `No aplica (${answerValue})`
}

export function uiPageDesignFailed(uiLang, index, pageName, reason) {
  const suffix = reason ? (uiLang === "EN" ? ` (${reason})` : ` (${reason})`) : ""
  return (uiLang === "EN"
    ? `Page ${index} (${pageName}): the AI design failed - using the standard layout.`
    : `Página ${index} (${pageName}): el diseño con IA falló - usando el layout estándar.`) + suffix
}

// Document-level outline failure - distinct from uiPageDesignFailed (a single
// page). Previously a bare Spanish sentence with the actual reason
// (HTTP status, contract violation, provider) always discarded by App.jsx's
// bare `catch {}` - this is a dead end to debug when it happens (see the
// documentPlan.js number/string id bug this uncovered live).
export function uiPlanFailed(uiLang, reason) {
  const suffix = reason ? ` (${reason})` : ""
  return (uiLang === "EN"
    ? "The AI document plan failed - using the standard page structure."
    : "El plan de documento con IA falló - usando la estructura de páginas estándar.") + suffix
}

// A page's AI layout call resolved normally, but the CONTENT came from the
// deterministic fallback (every provider either failed or the model's
// answer failed the task's own validator) - runHybridAI already computes
// this via result.provider === "contract" / result.fallbackReason, but
// nothing surfaced it: a page could render 100% deterministic with zero
// visible warning, indistinguishable from a genuine AI-authored layout.
export function uiPageUsedFallback(uiLang, index, pageName, reason) {
  const suffix = reason ? ` (${reason})` : ""
  return (uiLang === "EN"
    ? `Page ${index} (${pageName}): AI did not produce a usable layout - using the standard one.`
    : `Página ${index} (${pageName}): la IA no produjo un layout usable - se usó el estándar.`) + suffix
}
