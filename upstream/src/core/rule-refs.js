import { mapConditionalFormulas, conditionalPredicateField } from './conditional-scale.js';
/** Keep sparse rule expressions attached to their data during whole-line edits. */
import { mapFormulaRefs, shiftFormula, adjustRefForInsert, adjustRefForDelete, sameSheetName, MAX_ROW, MAX_COL } from './refs.js';
import { isRangeSource } from './validation.js';

export function adjustLineRules(rules, field, { ownerSheet, sheetName, axis, at, count, remove, sheetsBetween, newId, moveTargets = true, referenceFilter = () => true }) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  const absLo = axis === 'row' ? 'absR1' : 'absC1', absHi = axis === 'row' ? 'absR2' : 'absC2';
  const same = name => sameSheetName(name, sheetName);
  const moves = moveTargets && same(ownerSheet);
  const affected = ref => referenceFilter(ref) && (ref.sheetEnd ? (sheetsBetween(ref.sheet, ref.sheetEnd) || []).some(same) : same(ref.sheet || ownerSheet));
  const wholeAxis = ref => ref.kind === (axis === 'row' ? 'cols' : 'rows');
  const mapRange = range => {
    if (!moves) return range;
    if (!remove) return adjustRefForInsert(range, axis, at, count);
    const next = adjustRefForDelete(range, axis, at, count);
    // Lines deleted above, the grid fills in blank ones at its end: a rule that reached the last line (A:A) still does.
    const edge = axis === 'row' ? MAX_ROW : MAX_COL;
    return next && range[hi] >= edge ? { ...next, [hi]: edge } : next;
  };
  const requestedField = field;
  return rules.flatMap(rule => {
    const field = requestedField === 'value' ? conditionalPredicateField(rule) || 'value' : requestedField;
    // Statistical sources are fixed sheet formulas, not candidate-relative tests.
    if (requestedField === 'value') rule = mapConditionalFormulas(rule, (formula, key) => key === conditionalPredicateField(rule) ? formula : mapFormulaRefs(formula, ref => {
      if (!affected(ref) || wholeAxis(ref)) return ref;
      return remove ? adjustRefForDelete(ref, axis, at, count) : adjustRefForInsert(ref, axis, at, count);
    }));
    const relative = !!conditionalPredicateField(rule) || (field === 'source' && rule.type === 'list' && rule.relativeSource === true && isRangeSource(rule.source));
    const expression = !!conditionalPredicateField(rule) || (field === 'source' && rule.type === 'list' && isRangeSource(rule.source));
    if (!expression) { const range = mapRange(rule.range); return range ? [{ ...rule, range }] : []; }
    const formula = String(rule[field] ?? ''), origin = rule.range;
    const boundaries = new Set([origin[lo], origin[hi] + 1]);
    const add = n => { if (n > origin[lo] && n <= origin[hi]) boundaries.add(n); };
    if (moves) { add(at); if (remove) add(at + count); }
    // A relative endpoint can cross the edit at a different candidate than
    // the rule's own range. Each interval has one consistent transformation.
    if (relative) mapFormulaRefs(formula, ref => {
      if (!affected(ref) || wholeAxis(ref)) return ref;
      for (const [coord, absolute] of [[lo, absLo], [hi, absHi]]) if (!ref[absolute]) {
        const offset = ref[coord] - origin[lo];
        add(at - offset); if (remove) add(at + count - offset);
      }
      return ref;
    });
    const points = [...boundaries].sort((a,b) => a-b), parts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const old = { ...origin, [lo]: points[i], [hi]: points[i+1] - 1 };
      const range = mapRange(old); if (!range) continue;
      if (moves && !remove && old[hi] === at - 1 && origin[hi] >= at) range[hi] += count;
      const dr = relative ? old.r1 - origin.r1 : 0, dc = relative ? old.c1 - origin.c1 : 0;
      const source = mapFormulaRefs(shiftFormula(formula, dr, dc), ref => {
        if (!affected(ref) || wholeAxis(ref)) return ref;
        const next = remove ? adjustRefForDelete(ref, axis, at, count) : adjustRefForInsert(ref, axis, at, count);
        if (next && remove && relative) {
          // An endpoint clipped by deletion stays at the deletion boundary
          // throughout this interval instead of moving with the candidate.
          for (const [coord, absolute] of [[lo, absLo], [hi, absHi]]) {
            if (ref[coord] >= at && ref[coord] < at + count) next[absolute] = true;
          }
        }
        return next;
      });
      const prev = parts.at(-1);
      if (prev && prev.range[hi] + 1 === range[lo] && source === (relative ? shiftFormula(prev[field], range.r1 - prev.range.r1, range.c1 - prev.range.c1) : prev[field])) prev.range[hi] = range[hi];
      else parts.push({ ...rule, range: { ...range }, [field]: source });
    }
    return parts.map((part, i) => i ? { ...part, id: newId() } : part);
  });
}

/** Split on the perpendicular axis before applying an insertion/deletion. */
export function adjustBlockRules(rules, field, options) {
  const { axis, bandStart, bandEnd, sheetName, ownerSheet, newId } = options;
  const lo = axis === 'row' ? 'c1' : 'r1', hi = axis === 'row' ? 'c2' : 'r2';
  const absLo = axis === 'row' ? 'absC1' : 'absR1', absHi = axis === 'row' ? 'absC2' : 'absR2';
  const same = name => sameSheetName(name, sheetName);
  const inside = range => range[lo] >= bandStart && range[hi] <= bandEnd;
  // Match ordinary cell formulas: only bounded references wholly inside the
  // shifted band follow a block edit; spanning ranges retain their addresses.
  const referenceFilter = ref => ref.kind !== 'rows' && ref.kind !== 'cols' && inside(ref)
    && (!ref.sheetEnd || same(ref.sheet));
  const requestedField = field;
  return rules.flatMap(rule => {
    const field = requestedField === 'value' ? conditionalPredicateField(rule) || 'value' : requestedField;
    const relative = !!conditionalPredicateField(rule) || (field === 'source' && rule.type === 'list' && rule.relativeSource === true && isRangeSource(rule.source));
    const origin = rule.range, boundaries = new Set([origin[lo], origin[hi] + 1]);
    const add = n => { if (n > origin[lo] && n <= origin[hi]) boundaries.add(n); };
    if (same(ownerSheet)) { add(bandStart); add(bandEnd + 1); }
    if (relative) mapFormulaRefs(String(rule[field] ?? ''), ref => {
      if (!same(ref.sheet || ownerSheet) || ref.kind === 'rows' || ref.kind === 'cols') return ref;
      for (const [coord, absolute] of [[lo, absLo], [hi, absHi]]) if (!ref[absolute]) {
        const offset = ref[coord] - origin[lo];
        add(bandStart - offset); add(bandEnd + 1 - offset);
      }
      return ref;
    });
    const points = [...boundaries].sort((a,b) => a-b), parts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const range = { ...origin, [lo]: points[i], [hi]: points[i+1] - 1 };
      const stripe = { ...rule, range, ...(relative ? { [field]: shiftFormula(String(rule[field] ?? ''), range.r1-origin.r1, range.c1-origin.c1) } : {}) };
      parts.push(...adjustLineRules([stripe], requestedField, { ...options, moveTargets: inside(range), referenceFilter }));
    }
    return parts.map((part,i) => ({ ...part, id: i ? newId() : rule.id }));
  });
}
