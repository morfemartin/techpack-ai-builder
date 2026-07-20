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

  function fail(message) {
    alert("Techpack Illustrator Import\n\n" + message)
    throw new Error(message)
  }

  function findNamedGroup(container, name) {
    var groups = container.groupItems
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].name === name) return groups[i]
    }
    return null
  }

  function hasPageItems(layer) {
    return layer.pageItems && layer.pageItems.length > 0
  }

  var scriptFile = new File($.fileName)
  var sampleFolder = new Folder(scriptFile.parent.fsName + "/sample")
  var source = new File(sampleFolder.fsName + "/02-illustrator-system.svg")
  if (!source.exists) fail("No se encontro: " + source.fsName)

  var doc = app.open(source)
  var sourceLayer = doc.layers[0]
  sourceLayer.name = "SOURCE_SVG"
  var missing = []
  var importedGroups = []
  for (var g = 0; g < sourceLayer.groupItems.length; g++) importedGroups.push(sourceLayer.groupItems[g])
  var useStackFallback = importedGroups.length === EXPECTED.length

  // Illustrator imports SVG layer wrappers as named groupItems. Promote each
  // wrapper to a native Illustrator Layer without changing its artwork. In
  // Illustrator 30.4 the SVG ids are discarded; its group collection is still
  // stable from top to bottom, so the importer uses that order as a fallback.
  for (var i = 0; i < EXPECTED.length; i++) {
    var svgGroupName = "LAYER_" + EXPECTED[i].replace(" ", "_")
    var group = findNamedGroup(sourceLayer, svgGroupName)
    if (!group && useStackFallback) group = importedGroups[EXPECTED.length - 1 - i]
    var layer = doc.layers.add()
    layer.name = EXPECTED[i]
    if (group) {
      group.name = "SVG_CONTAINER__" + EXPECTED[i].replace(" ", "_")
      group.move(layer, ElementPlacement.PLACEATBEGINNING)
    } else {
      missing.push(svgGroupName)
    }
  }

  if (!hasPageItems(sourceLayer)) sourceLayer.remove()

  var report = new File(sampleFolder.fsName + "/illustrator-import-report.txt")
  report.encoding = "UTF-8"
  report.lineFeed = "Unix"
  report.open("w")
  report.writeln("Techpack AI Builder - Illustrator import report")
  report.writeln("Illustrator: " + app.version)
  report.writeln("Source: " + source.fsName)
  report.writeln("Artboard: " + doc.artboards[0].artboardRect.join(", "))
  report.writeln("Imported top-level groups: " + importedGroups.length)
  report.writeln("Stack-order fallback: " + useStackFallback)
  report.writeln("Layers:")
  for (var l = 0; l < doc.layers.length; l++) {
    report.writeln("- " + doc.layers[l].name + " | objects=" + doc.layers[l].pageItems.length)
  }
  report.writeln("Missing wrappers: " + (missing.length ? missing.join(", ") : "none"))
  report.close()

  var destination = new File(sampleFolder.fsName + "/02-illustrator-system.ai")
  if (destination.exists && !destination.remove()) fail("No se pudo reemplazar: " + destination.fsName)
  var options = new IllustratorSaveOptions()
  options.compatibility = Compatibility.ILLUSTRATOR24
  options.pdfCompatible = true
  options.compressed = true
  options.embedICCProfile = true
  doc.saveAs(destination, options)

  if (missing.length) {
    alert("Se creo el AI, pero faltaron grupos: " + missing.join(", ") + "\nRevisa illustrator-import-report.txt")
  }
})()
