/** Validation records travel independently of cell values and formats. */
import { shiftFormula } from './refs.js';
import { isRangeSource } from './validation.js';
import { intersection, clearRangeRecordsAtCells, compactRangeRecords, rangesCoveringCells } from './range-records.js';

const relative = rule => rule.type === 'formula' || rule.type === 'list' && rule.relativeSource === true && isRangeSource(rule.source);
const clone = rule => ({ ...rule, range: { ...rule.range }, ...(Array.isArray(rule.source) ? { source: [...rule.source] } : {}), ...(rule.colors ? { colors: { ...rule.colors } } : {}) });
const piece = (rule, range, id = rule.id) => ({ ...clone(rule), id, range,
  ...(relative(rule) ? { source: shiftFormula(rule.source, range.r1 - rule.range.r1, range.c1 - rule.range.c1) } : {}) });

export function copyValidations(rules, rows, cols) {
  const extent = (lines, lo, hi) => {
    const first = lines.findIndex(n => n >= lo && n <= hi);
    if (first < 0) return null;
    let last = first;
    while (last + 1 < lines.length && lines[last + 1] >= lo && lines[last + 1] <= hi) last++;
    return [first, last];
  };
  return rules.flatMap(rule => {
    const rr = extent(rows, rule.range.r1, rule.range.r2), cc = extent(cols, rule.range.c1, rule.range.c2);
    return rr && cc ? [{ rule: clone(rule), range: { r1: rr[0], c1: cc[0], r2: rr[1], c2: cc[1] } }] : [];
  });
}

export function mapPastedValidations(copied, h, w, r0, c0, repeat, transpose = false) {
  if (!Array.isArray(copied)) return null;
  return copied.flatMap(item => {
    const g = item.range, out = [];
    const join = (axis, size, count) => {
      if (transpose || g[axis === 'r' ? 'r1' : 'c1'] !== 0 || g[axis === 'r' ? 'r2' : 'c2'] !== size - 1) return false;
      if (!relative(item.rule)) return true;
      const dr = axis === 'r' ? (count - 1) * size : 0, dc = axis === 'c' ? (count - 1) * size : 0;
      const first = shiftFormula(item.rule.source, r0 + g.r1 - item.rule.range.r1, c0 + g.c1 - item.rule.range.c1);
      return !/#REF!/i.test(first) && shiftFormula(first, dr, dc) === shiftFormula(item.rule.source,
        r0 + g.r1 - item.rule.range.r1 + dr, c0 + g.c1 - item.rule.range.c1 + dc);
    };
    const joinRows = join('r', h, repeat.rows), joinCols = join('c', w, repeat.cols);
    for (let ry = 0; ry < (joinRows ? 1 : repeat.rows); ry++) for (let rx = 0; rx < (joinCols ? 1 : repeat.cols); rx++) {
      const r = r0 + ry * h, c = c0 + rx * w;
      const range = transpose ? { r1: r + g.c1, c1: c + g.r1, r2: r + g.c2, c2: c + g.r2 }
        : { r1: r + g.r1, c1: c + g.c1, r2: r + g.r2 + (joinRows ? (repeat.rows - 1) * h : 0), c2: c + g.c2 + (joinCols ? (repeat.cols - 1) * w : 0) };
      out.push(piece(item.rule, range));
    }
    return out;
  });
}

/** Replace validation only where cells were actually written, in the same undo step. */
export function replaceValidations(saved, incoming, cells, newId) {
  if (incoming === null || !cells.length || !saved.length && !incoming.length) return saved;
  const remaining = clearRangeRecordsAtCells(saved.map((rule, index) => ({ range: rule.range, rule, index })), cells);
  const kept = compactRangeRecords(remaining, r => r.index).sort((a, b) => a.index - b.index).map(({ rule, range }) =>
    ['r1', 'c1', 'r2', 'c2'].every(k => range[k] === rule.range[k]) ? rule : piece(rule, range, newId()));
  const coverage = rangesCoveringCells(cells);
  const added = incoming.flatMap(rule => coverage.map(({ range }) => intersection(rule.range, range)).filter(Boolean).map(range => piece(rule, range, newId())));
  return !added.length && kept.length === saved.length && kept.every((rule, i) => rule === saved[i]) ? saved : [...kept, ...added];
}
