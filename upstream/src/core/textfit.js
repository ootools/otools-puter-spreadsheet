/**
 * Text measurement for auto-fit sizes. Pure: the caller supplies a
 * measure(text) → width function (a canvas in the app, a stub in tests).
 */

// ISO/IEC 29500 §18.3.1.13: column widths include two pixels of text
// margin on each side, independently of the Normal or cell font. Grid lines
// occupy one additional pixel. Keep the CSS and measurement paths in sync.
export const CELL_TEXT_INSET = 2;
export function cellHorizontalPadding(indent = 0, zoom = 1) {
  // Indentation moves the text origin by equal increments, including the
  // first increment. It does not consume the ordinary margin on that edge.
  return (indent + CELL_TEXT_INSET * 2) * zoom;
}

/** Control characters stay in values, but LF lays out only with Wrap Text.
 * CR is ignored even in wrapped cells (CRLF therefore produces one line break).
 * Keep this in presentation: formulas, editing, and native export need the original text.
 */
export function cellLayoutText(text, wrap) {
  return String(text ?? '').replace(wrap ? /\r/g : /[\r\n]/g, '');
}

/** Width of the longest explicit line, as displayed by a multiline cell. */
export function maxLineWidth(text, measure) {
  let width = 0;
  for (const line of String(text ?? '').split(/\r\n?|\n/)) width = Math.max(width, measure(line));
  return width;
}

let segmenter;
function wrappingUnits(text) {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  segmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

function sliceUnits(text, start, end) {
  const slice = text.slice(start, end);
  return typeof slice === 'string' ? slice : slice.join('');
}

/** Find the longest fitting prefix without measuring the whole remaining word. */
function fittingPrefix(text, start, width, measure, offsets) {
  const remaining = text.length - start;
  let lo = 1;
  let hi = 2;
  while (hi < remaining && measure(sliceUnits(text, start, start + hi), offsets ? offsets[start] : start) <= width) {
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi, remaining);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(sliceUnits(text, start, start + mid), offsets ? offsets[start] : start) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Break text into the lines a wrapped cell of `width` px would show. */
export function wrapLines(text, width, measure, onLine = null) {
  const out = [];
  const append = (text, start) => { out.push(text); onLine?.(text, start); };
  let paragraphOffset = 0;
  for (const paragraph of String(text ?? '').split('\n')) {
    // Lines break at spaces, never at the no-break spaces a formatted number groups its digits with (1 234 567).
    const words = paragraph.split(/((?:(?![  ])\s)+)/).filter((w) => w !== '');
    let line = '';
    let lineOffset = paragraphOffset, wordOffset = paragraphOffset;
    for (const word of words) {
      const candidate = line + word;
      // Spaces ride along with the word before them: they are trimmed from
      // the end of a line and never open one of their own.
      if (!word.trim()) { line = candidate; wordOffset += word.length; continue; }
      if (line && measure(candidate, lineOffset) > width) {
        append(line.replace(/\s+$/, ''), lineOffset);
        line = word;
        lineOffset = wordOffset;
      } else {
        line = candidate;
      }
      // A single word longer than the cell breaks by character.
      const units = wrappingUnits(line);
      const offsets = typeof units === 'string' ? null : [0];
      if (offsets) for (const unit of units) offsets.push(offsets.at(-1) + unit.length);
      let start = 0;
      while (start < units.length - 1) {
        const cut = fittingPrefix(units, start, width, (text, offset) => measure(text, lineOffset + offset), offsets);
        if (start + cut === units.length) break;
        append(sliceUnits(units, start, start + cut), lineOffset + (offsets ? offsets[start] : start));
        start += cut;
      }
      line = sliceUnits(units, start);
      lineOffset += offsets ? offsets[start] : start;
      wordOffset += word.length;
    }
    append(line.replace(/\s+$/, ''), lineOffset);
    paragraphOffset += paragraph.length + 1;
  }
  return out;
}

/** Height in px for `lines` lines of text at a font size, never less than `minimum` (a sheet's default row height). */
export function heightForLines(lines, fontSize = 13, minimum = 0) {
  const lineHeight = Math.round(fontSize * 1.3);
  return Math.max(minimum, lines * lineHeight + 8);
}
