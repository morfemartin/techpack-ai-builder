#target illustrator

(function () {
  var EXPECTED = [
    "01 PAGE_BACKGROUND",
    "02 ARTWORK",
    "03 REFERENCES",
    "04 TECH_DATA",
    "05 DESIGNER_COMMUNICATION",
    "06 CALLOUTS",
    "07 PAGE_CHROME"
  ]
  var ARTBOARD_GAP = 36
  var ARTBOARD_COLUMNS = 4

  function fail(message) {
    alert("Techpack Illustrator Import\n\n" + message)
    throw new Error(message)
  }

  function sortedSvgFiles(folder) {
    if (!folder || !folder.exists) return []
    var files = folder.getFiles(function (item) {
      return item instanceof File && /\.svg$/i.test(item.name)
    })
    files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
    return files
  }

  function selectedSources(scriptFile) {
    var packagePages = new Folder(scriptFile.parent.fsName + "/pages")
    var samplePages = new Folder(scriptFile.parent.fsName + "/sample/pages")
    var files = sortedSvgFiles(packagePages)
    if (!files.length) files = sortedSvgFiles(samplePages)
    if (files.length) return files
    var selected = File.openDialog("Selecciona todos los SVG editables del tech pack", "SVG:*.svg", true)
    if (!selected) return []
    files = selected instanceof Array ? selected : [selected]
    files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 })
    return files
  }

  function pageLabel(file, index) {
    var label = file.name.replace(/\.svg$/i, "").replace(/^P\d+--/, "").replace(/-/g, " ")
    return "P" + (index + 1 < 10 ? "0" : "") + (index + 1) + " - " + label
  }

  function importedGroups(layer) {
    var groups = []
    for (var i = 0; i < layer.groupItems.length; i++) groups.push(layer.groupItems[i])
    if (groups.length !== EXPECTED.length) fail("Se esperaban 7 contenedores SVG y se encontraron " + groups.length + ".")
    return groups
  }

  function findLayer(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].name === name) return doc.layers[i]
    return null
  }

  function promoteFirstPage(doc, pageName) {
    var sourceLayer = doc.layers[0]
    sourceLayer.name = "SOURCE_SVG"
    var groups = importedGroups(sourceLayer)
    for (var i = 0; i < EXPECTED.length; i++) {
      var group = groups[EXPECTED.length - 1 - i]
      var layer = doc.layers.add()
      layer.name = EXPECTED[i]
      group.name = pageName + "__" + EXPECTED[i].replace(" ", "_")
      group.move(layer, ElementPlacement.PLACEATBEGINNING)
    }
    if (!sourceLayer.pageItems.length) sourceLayer.remove()
  }

  function appendPage(destination, source, pageIndex, firstRect, pageName) {
    var sourceLayer = source.layers[0]
    var groups = importedGroups(sourceLayer)
    var sourceRect = source.artboards[0].artboardRect
    var width = firstRect[2] - firstRect[0]
    var height = firstRect[1] - firstRect[3]
    var column = pageIndex % ARTBOARD_COLUMNS
    var row = Math.floor(pageIndex / ARTBOARD_COLUMNS)
    var left = firstRect[0] + column * (width + ARTBOARD_GAP)
    var top = firstRect[1] - row * (height + ARTBOARD_GAP)
    var artboard = destination.artboards.add([left, top, left + width, top - height])
    artboard.name = pageName
    var dx = left - sourceRect[0]
    var dy = top - sourceRect[1]

    for (var i = 0; i < EXPECTED.length; i++) {
      var sourceGroup = groups[EXPECTED.length - 1 - i]
      var targetLayer = findLayer(destination, EXPECTED[i])
      if (!targetLayer) fail("Falta la capa destino " + EXPECTED[i] + ".")
      var copied = sourceGroup.duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING)
      copied.name = pageName + "__" + EXPECTED[i].replace(" ", "_")
      copied.translate(dx, dy)
    }
  }

  var scriptFile = new File($.fileName)
  var sources = selectedSources(scriptFile)
  if (!sources.length) fail("No se seleccionaron SVG editables.")

  var destination = null
  var firstRect = null
  var pageNames = []
  for (var pageIndex = 0; pageIndex < sources.length; pageIndex++) {
    var sourceDoc = app.open(sources[pageIndex])
    var name = pageLabel(sources[pageIndex], pageIndex)
    pageNames.push(name)
    if (pageIndex === 0) {
      destination = sourceDoc
      firstRect = destination.artboards[0].artboardRect
      destination.artboards[0].name = name
      promoteFirstPage(destination, name)
    } else {
      appendPage(destination, sourceDoc, pageIndex, firstRect, name)
      sourceDoc.close(SaveOptions.DONOTSAVECHANGES)
    }
  }

  destination.activate()
  var packageRoot = sources[0].parent.name === "pages" ? sources[0].parent.parent : sources[0].parent
  var report = new File(packageRoot.fsName + "/illustrator-import-report.txt")
  report.encoding = "UTF-8"
  report.lineFeed = "Unix"
  report.open("w")
  report.writeln("Techpack AI Builder - Illustrator import report")
  report.writeln("Illustrator: " + app.version)
  report.writeln("Pages: " + destination.artboards.length)
  report.writeln("Artboard grid: " + ARTBOARD_COLUMNS + " columns")
  report.writeln("Layers: " + destination.layers.length)
  for (var p = 0; p < pageNames.length; p++) report.writeln("- " + pageNames[p])
  for (var l = 0; l < destination.layers.length; l++) report.writeln("- " + destination.layers[l].name + " | page groups=" + destination.layers[l].groupItems.length)
  report.close()

  var aiFile = new File(packageRoot.fsName + "/Techpack-complete.ai")
  if (aiFile.exists && !aiFile.remove()) fail("No se pudo reemplazar: " + aiFile.fsName)
  var options = new IllustratorSaveOptions()
  options.compatibility = Compatibility.ILLUSTRATOR24
  options.pdfCompatible = true
  options.compressed = true
  options.embedICCProfile = true
  destination.saveAs(aiFile, options)
})()
