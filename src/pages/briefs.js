// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED ILLUSTRATOR BRIEFS — what each art board tells the human.
//
// A brief must answer, inside the art board (never taking layout space):
// which garment part goes in this slot, what the drawing MUST mark, which
// measurements to draw (with the dimension-line convention, flagged per-size
// when they grade), and what matters to the factory. The AI proposes
// `briefs[]` on an illustration region - one per slot - guided by two
// thinking models (factory error-prevention + illustrator clarity); this
// module is the deterministic half: normalizeSlotBriefs guarantees the shape
// and derives defaults from the design's own data when the model under-
// delivers, and briefLines renders the standard template with a degradation
// ladder (full → checklist → title) so a brief always fits its cell.
//
// Drafted by the local DeepSeek orchestrator against the briefs.test.js
// contract; reviewed and integrated.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDimensions } from '../core/units.js';

/**
 * Normalize briefs for all slots in a region.
 * @param {object} region - Region definition with slots, refs, briefs.
 * @param {object} page - Page definition with purpose, etc.
 * @param {object} ctx - Context with designs, garmentType.
 * @returns {object[]} Array of exactly slotCount brief objects.
 */
export function normalizeSlotBriefs(region, page, ctx) {
  // Determine slot count
  const slotCount = Math.max(
    1,
    Number(region.slots) || (Array.isArray(region.refs) ? region.refs.length : 1)
  );

  // Resolve the target design from page purpose
  let design = null;
  if (page && typeof page.purpose === 'string') {
    const match = page.purpose.match(/^design:(.+)$/i);
    if (match) {
      const designName = match[1].trim().toLowerCase();
      if (ctx && Array.isArray(ctx.designs)) {
        design = ctx.designs.find(
          d => d && typeof d.name === 'string' && d.name.trim().toLowerCase() === designName
        ) || null;
      }
    }
  }
  if (!design && ctx && Array.isArray(ctx.designs) && ctx.designs.length > 0) {
    design = ctx.designs[0] || null;
  }
  const designIndex = design && ctx && Array.isArray(ctx.designs) ? ctx.designs.indexOf(design) : -1;
  const designCode = designIndex >= 0 ? 'D' + (designIndex + 1) : '';
  const designerDesign = designIndex >= 0 && ctx?.designerTx && Array.isArray(ctx.designerTx.designs)
    ? ctx.designerTx.designs[designIndex]
    : null;
  const factoryDesign = designIndex >= 0 && ctx?.txData && Array.isArray(ctx.txData.designs)
    ? ctx.txData.designs[designIndex]
    : null;

  // Build default values from design and context
  const defaultGarmentPart = design
    ? (typeof designerDesign?.pos === 'string' && designerDesign.pos.trim()) || (typeof design.pos === 'string' && design.pos.trim()) || (typeof design.name === 'string' && design.name.trim()) || ''
    : (ctx && typeof ctx.garmentType === 'string' ? ctx.garmentType.trim() : '');
  const defaultPlacementLandmark = (typeof designerDesign?.posDetail === 'string' && designerDesign.posDetail.trim()) || (design && typeof design.posDetail === 'string' ? design.posDetail.trim() : '');
  // Just the technique name - the template already prefixes "Fábrica: ".
  const defaultFactoryNote = (typeof factoryDesign?.technique === 'string' && factoryDesign.technique.trim()) || (design && typeof design.tec === 'string' && design.tec.trim() ? design.tec.trim() : '');
  // Dimensions print in the unit this tech pack is set to, converted from the
  // unit they were typed in - the factory reads one unit, whoever fills the
  // form uses whatever they measured with. formatDimensions returns '' when
  // either side is missing, so a half-filled design prints no dimension line
  // rather than "Ancho 80mm x Alto ".
  const defaultMeasurements = [];
  if (design) {
    const outputUnit = (ctx && ctx.dimensionUnit) || design.unit;
    const label = formatDimensions(design.w, design.h, design.unit, outputUnit);
    if (label) defaultMeasurements.push({ label, perSize: false });
  }

  // Ensure briefs array exists
  const briefsArr = Array.isArray(region.briefs) ? region.briefs : [];

  // Build result array
  const result = [];
  for (let i = 0; i < slotCount; i++) {
    const sourceObj = (i < briefsArr.length && briefsArr[i] && typeof briefsArr[i] === 'object')
      ? briefsArr[i]
      : null;

    // Coerce fields from source or use defaults
    const garmentPart = coerceString(sourceObj?.garmentPart) || defaultGarmentPart;
    const view = coerceString(sourceObj?.view)
      || (Array.isArray(region.refs) && i < region.refs.length && typeof region.refs[i] === 'string'
          ? region.refs[i].trim()
          : '')
      || ('Vista ' + (i + 1));

    const mustMark = [];
    if (sourceObj && Array.isArray(sourceObj.mustMark)) {
      for (const item of sourceObj.mustMark) {
        const s = coerceString(item);
        if (s) mustMark.push(s);
      }
    }

    // The design's own real w/h must never be silently dropped just because
    // the model ALSO supplied unrelated measurements (e.g. "Largo total
    // desde hombro" on a design page) - both are legitimate, distinct facts.
    // Previously ANY model measurement replaced the real dimension line
    // entirely, even when it described something else altogether; a known
    // width/height is real data, not a guess to be overridden.
    const measurements = [];
    for (const dm of defaultMeasurements) {
      measurements.push({ ...dm });
    }
    if (sourceObj && Array.isArray(sourceObj.measurements)) {
      for (const m of sourceObj.measurements) {
        if (m && typeof m === 'object') {
          const label = coerceString(m.label);
          if (label && !measurements.some((existing) => existing.label === label)) {
            measurements.push({
              label: label,
              perSize: !!m.perSize
            });
          }
        }
      }
    }

    const placementLandmark = coerceString(sourceObj?.placementLandmark) || defaultPlacementLandmark;
    const factoryNote = ctx?.txData?.outputMode === 'multilingual'
      ? defaultFactoryNote || coerceString(sourceObj?.factoryNote)
      : coerceString(sourceObj?.factoryNote) || defaultFactoryNote;

    const slotOffset = Math.max(0, Number(region && region._slotOffset) || 0);
    const slotCode = 'V' + (slotOffset + i + 1);
    const callouts = mustMark.map((label, index) => ({ id: slotCode + '.' + (index + 1), label }));
    const numberedMeasurements = measurements.map((measurement, index) => ({
      ...measurement,
      id: 'DIM-' + (index + 1),
      unit: 'mm'
    }));
    const pending = [];
    if (mustMark.length === 0) pending.push('Elementos y costuras por señalar');
    if (numberedMeasurements.length === 0) pending.push('Cotas requeridas');
    if (!placementLandmark && design) pending.push('Landmark de colocación');

    result.push({
      slotCode,
      designCode,
      garmentPart,
      view,
      mustMark,
      callouts,
      measurements: numberedMeasurements,
      placementLandmark,
      factoryNote,
      pending,
      hasReference: !!(design && design.imageData)
    });
  }

  // NOTE: this used to also collapse slots whose full body (everything but
  // the view name) came out identical - meant as a defensive backstop for the
  // "V1 Colocación / V2 Detalle de ejecución" duplicate design page. Reverted:
  // this function's documented contract is "never returns fewer entries than
  // slots" (see the test file's header comment and "survives garbage input"/
  // "pads missing slots" tests), and a caller that explicitly asks for N
  // slots - an AI-authored plan naming N real views, say - is entitled to get
  // N briefs even if today's deterministic defaults can't tell them apart yet.
  // The actual duplicate-view bug was the DEFAULT of two views with no caller
  // request behind them; that is fixed at the source in semanticOutline.js
  // (designPages() now defaults to a single view), so no caller hits this
  // case unless it genuinely asked for multiple views.
  return result;
}

/**
 * Coerce a value to a trimmed string, returning empty string for non-strings or empty strings.
 * @param {*} x
 * @returns {string}
 */
function coerceString(x) {
  if (typeof x === 'string') {
    const t = x.trim();
    return t.length > 0 ? t : '';
  }
  return '';
}

// A placementLandmark that is just a bare number ("25") is a measurement that
// got mislabeled as a location upstream (see reqsToDesigns in
// techpackRequirements.js) - printing "Ubicación: 25" invents a location that
// was never said. The real fact still reaches the page through `details`/
// `measurements`, so this only suppresses the wrongly-labeled line.
function isBareNumber(value) {
  return /^\d+([.,]\d+)?$/.test(String(value || '').trim());
}

/**
 * Format a brief object into display lines based on mode.
 * @param {object} brief - Normalized brief object.
 * @param {'title'|'checklist'|'full'} mode
 * @returns {string[]} Array of display lines.
 */
export function briefLines(brief, mode, labels = {}) {
  const lines = [];

  // One identifying line, not three. The block already carries its view code
  // in a badge and the view name as its heading, and the renderer prints an
  // "INSTRUCCIONES" caption - so restating "V1 · CUELLO PLANO" here said the
  // same thing a third time and pushed the first useful instruction three rows
  // down. Name the garment part being drawn (the one fact the heading does not
  // give), and fall back to the view name only when there is no part.
  const viewUpper = typeof brief.view === 'string' ? brief.view.toUpperCase() : '';
  const part = typeof brief.garmentPart === 'string' ? brief.garmentPart.trim() : '';
  const heading = part || viewUpper;
  if (heading) lines.push(heading);

  if (mode === 'title') {
    return lines;
  }

  // Checklist mode adds mustMark line
  if (brief.mustMark && Array.isArray(brief.mustMark) && brief.mustMark.length > 0) {
    const marks = Array.isArray(brief.callouts) && brief.callouts.length
      ? brief.callouts.map(item => item.id + ' ' + item.label)
      : brief.mustMark;
    lines.push((labels.mark || 'Señalar') + ': ' + marks.join(', '));
  }

  if (mode === 'checklist') {
    return lines;
  }

  // Full mode adds remaining sections
  if (brief.placementLandmark && brief.placementLandmark.length > 0 && !isBareNumber(brief.placementLandmark)) {
    lines.push((labels.location || 'Ubicación') + ': ' + brief.placementLandmark);
  }

  if (brief.measurements && Array.isArray(brief.measurements) && brief.measurements.length > 0) {
    const measStrs = brief.measurements.map(m => {
      let s = (m.id ? m.id + ' ' : '') + (m.label || '');
      if (m.perSize) s += ' (por talla)';
      return s;
    }).filter(s => s.length > 0);
    if (measStrs.length > 0) {
      lines.push((labels.dimension || 'Acotar con líneas de medida (mm)') + ': ' + measStrs.join(', '));
    }
  }

  if (brief.hasReference) lines.push(labels.reference || 'Referencia gráfica disponible · NO A ESCALA');

  return lines;
}

export function factoryBriefLines(brief, labels = {}) {
  const lines = []
  if (brief.factoryNote) lines.push((labels.factory || 'Fábrica') + ': ' + brief.factoryNote)
  if (Array.isArray(brief.measurements)) {
    brief.measurements.forEach((measurement) => {
      if (measurement && measurement.label) lines.push((measurement.id ? measurement.id + ' · ' : '') + measurement.label)
    })
  }
  if (Array.isArray(brief.pending)) {
    brief.pending.forEach((item) => lines.push((labels.pending || 'PENDIENTE DE CONFIRMAR') + ': ' + item))
  }
  return lines
}
