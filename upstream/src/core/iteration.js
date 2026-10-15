/** OOXML CT_CalcPr defaults; iteration is opt-in, never inferred from a cycle. */
export function normalizeIteration(value) {
  if (!value || ![true, 1, '1', 'true'].includes(value.iterate)) return null;
  const number = v => typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN;
  const count = number(value.iterateCount), delta = number(value.iterateDelta);
  return {
    iterate: true,
    // The documented calculation limit is 32,767 iterations.
    // https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
    iterateCount: Number.isInteger(count) && count > 0 && count <= 32767 ? count : 100,
    iterateDelta: Number.isFinite(delta) && delta >= 0 ? delta : .001,
  };
}

const equal = (a, b, delta) => typeof a === 'number' && typeof b === 'number'
  ? a === b || Math.abs(a - b) < delta
  : a === b || (a?.error != null && a.error === b?.error);

/**
 * Circular references are discovered first, then iterated sheet by sheet.
 * Read order in the grid must not choose the initial guesses or iteration order.
 * https://learn.microsoft.com/en-us/office/vba/excel/concepts/excel-performance/excel-tips-for-optimizing-performance-obstructions
 * Cached results are starting guesses, not substitutes for recalculation.
 */
export function calculateIteratively(wb) {
  const entries = [];
  for (const sheet of wb.sheets) {
    const cells = [];
    for (const [address, cell] of sheet.cells) if (cell.f != null) {
      const [r, c] = address.split(',').map(Number);
      cells.push({ sheet, r, c, cell, key: `${sheet.id}|${address}` });
    }
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    for (const cell of cells) entries.push(cell);
  }
  const state = { members: new Set(), dependents: new Map(), discovery: true, entries: new Map(entries.map(e => [e.key, e])) };
  wb._iteration = state;
  const clearRanges = () => {
    wb._rangeCache.clear();
    wb._rangeRuns.clear();
    wb._rangeCacheCells = 0;
  };
  try {
    wb._cache.clear();
    clearRanges();
    wb._spills.clear();
    for (const e of entries) wb._compute(e.sheet, e.r, e.c);
    if (!state.members.size) return;
    state.discovery = false;
    const seed = e => e.cell.v ?? 0;
    for (const key of state.members) wb._cache.set(key, seed(state.entries.get(key)));
    // Ordinary formulas independent of a cycle keep their discovery result.
    // Volatile expressions and dynamic spills require a workbook-wide pass.
    const all = wb.hasVolatileFormulas() || [...wb._spills.values()].some(s => s.anchors.size);
    const affected = () => {
      const keys = all ? new Set(entries.map(e => e.key)) : new Set(state.members);
      for (const key of keys) for (const dependent of state.dependents.get(key) || []) keys.add(dependent);
      return keys;
    };
    for (let pass = 0; pass < wb.iteration.iterateCount; pass++) {
      const previous = new Map([...state.members].map(key => [key, wb._cache.get(key)]));
      // Dependents must see this pass's circular results, including range and
      // spill caches. Ordinary books never enter this calculation path.
      const dirty = affected();
      for (const key of dirty) if (!state.members.has(key)) wb._cache.delete(key);
      clearRanges();
      wb._spills.clear();
      for (const e of entries) if (state.members.has(e.key)) {
        state.current = e.key;
        state.prior = wb._cache.get(e.key) ?? seed(e);
        wb._cache.delete(e.key);
        clearRanges();
        wb._compute(e.sheet, e.r, e.c);
        state.current = null;
      }
      // A dependent may have been visited while a later circular cell still
      // held its previous value. Publish dependents only after the whole pass.
      for (const key of affected()) if (!state.members.has(key)) wb._cache.delete(key);
      clearRanges();
      for (const e of entries) wb._compute(e.sheet, e.r, e.c);
      let settled = previous.size === state.members.size;
      for (const key of state.members) if (!equal(previous.get(key), wb._cache.get(key), wb.iteration.iterateDelta)) settled = false;
      if (settled) break;
    }
  } finally {
    // A currently acyclic IF may read itself after an input change. Preserve
    // its last result too, so a latch starts with that result, not an old file
    // cache. Formula caches travel through drafts, edits and rich clipboard.
    for (const e of entries) if (wb._cache.has(e.key)) e.cell.v = wb._cache.get(e.key);
    wb._iteration = null;
    wb._iterationReady = true;
    wb._announceGrown();
  }
}
