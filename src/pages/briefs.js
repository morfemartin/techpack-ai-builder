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

  // Build default values from design and context
  const defaultGarmentPart = design
    ? (typeof design.pos === 'string' && design.pos.trim()) || (typeof design.name === 'string' && design.name.trim()) || ''
    : (ctx && typeof ctx.garmentType === 'string' ? ctx.garmentType.trim() : '');
  const defaultPlacementLandmark = design && typeof design.posDetail === 'string' ? design.posDetail.trim() : '';
  // Just the technique name - the template already prefixes "Fábrica: ".
  const defaultFactoryNote = design && typeof design.tec === 'string' && design.tec.trim() ? design.tec.trim() : '';
  const defaultMeasurements = [];
  if (design && typeof design.w !== 'undefined' && typeof design.h !== 'undefined') {
    const w = String(design.w).trim();
    const h = String(design.h).trim();
    if (w && h) {
      defaultMeasurements.push({
        label: 'Ancho ' + w + 'mm x Alto ' + h + 'mm',
        perSize: false
      });
    }
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

    const measurements = [];
    if (sourceObj && Array.isArray(sourceObj.measurements)) {
      for (const m of sourceObj.measurements) {
        if (m && typeof m === 'object') {
          const label = coerceString(m.label);
          if (label) {
            measurements.push({
              label: label,
              perSize: !!m.perSize
            });
          }
        }
      }
    }
    if (measurements.length === 0) {
      // Use defaults only if source had no valid measurements
      for (const dm of defaultMeasurements) {
        measurements.push({ ...dm });
      }
    }

    const placementLandmark = coerceString(sourceObj?.placementLandmark) || defaultPlacementLandmark;
    const factoryNote = coerceString(sourceObj?.factoryNote) || defaultFactoryNote;

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

/**
 * Format a brief object into display lines based on mode.
 * @param {object} brief - Normalized brief object.
 * @param {'title'|'checklist'|'full'} mode
 * @returns {string[]} Array of display lines.
 */
export function briefLines(brief, mode) {
  const lines = [];

  // Title lines always present in all modes
  // The renderer already prints a "BRIEF PARA EL ILUSTRADOR" caption above,
  // so the title line is just the view name (no repeated "BRIEF").
  const viewUpper = typeof brief.view === 'string' ? brief.view.toUpperCase() : '';
  lines.push((brief.slotCode ? brief.slotCode + ' · ' : '') + viewUpper);
  if (brief.garmentPart && brief.garmentPart.length > 0) {
    lines.push(brief.garmentPart);
  }

  if (mode === 'title') {
    return lines;
  }

  // Checklist mode adds mustMark line
  if (brief.mustMark && Array.isArray(brief.mustMark) && brief.mustMark.length > 0) {
    const marks = Array.isArray(brief.callouts) && brief.callouts.length
      ? brief.callouts.map(item => item.id + ' ' + item.label)
      : brief.mustMark;
    lines.push('Señalar: ' + marks.join(', '));
  }

  if (mode === 'checklist') {
    return lines;
  }

  // Full mode adds remaining sections
  if (brief.placementLandmark && brief.placementLandmark.length > 0) {
    lines.push('Ubicación: ' + brief.placementLandmark);
  }

  if (brief.measurements && Array.isArray(brief.measurements) && brief.measurements.length > 0) {
    const measStrs = brief.measurements.map(m => {
      let s = (m.id ? m.id + ' ' : '') + (m.label || '');
      if (m.perSize) s += ' (por talla)';
      return s;
    }).filter(s => s.length > 0);
    if (measStrs.length > 0) {
      lines.push('Acotar con líneas de medida (mm): ' + measStrs.join(', '));
    }
  }

  if (brief.factoryNote && brief.factoryNote.length > 0) {
    lines.push('Fábrica: ' + brief.factoryNote);
  }

  if (brief.hasReference) lines.push('Referencia gráfica disponible · NO A ESCALA');
  if (Array.isArray(brief.pending)) {
    brief.pending.forEach(item => lines.push('PENDIENTE DE CONFIRMAR: ' + item));
  }

  return lines;
}
