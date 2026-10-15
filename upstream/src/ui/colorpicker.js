/**
 * Custom colors. The palettes in the menus cover the common cases; this
 * adds a "Custom…" swatch that opens the browser's own color picker, a hex
 * field, and a row of recently used custom colors.
 *
 * The native picker is one hidden <input type="color"> on the body: a menu
 * closes when the window loses focus (which the picker dialog causes), so
 * the input cannot live inside the menu.
 */

import { isComposing, el, fieldId } from './dom.js';

const RECENT_KEY = 'spreadsheet:recentColors';
const MAX_RECENT = 6;

export const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** "#abc", "abc", "#AABBCC" → "#aabbcc"; null when it is not a color. */
export function normalizeHex(text) {
  let t = String(text || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t.toLowerCase()}` : null;
}

export function recentColors() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isHex).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

export function rememberColor(hex) {
  const v = normalizeHex(hex);
  if (!v) return;
  const next = [v, ...recentColors().filter((c) => c !== v)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* no storage */ }
}

let nativeInput = null;
let pending = null;

function native() {
  if (nativeInput?.isConnected) return nativeInput;
  nativeInput = el('input.color-native', { type: 'color', 'aria-hidden': 'true', tabindex: -1 });
  nativeInput.addEventListener('change', () => { const cb = pending; pending = null; if (cb) { rememberColor(nativeInput.value); cb(nativeInput.value); } });
  document.body.append(nativeInput);
  return nativeInput;
}

/** Open the browser color picker near `anchor`; onPick(hex) when a color is chosen. */
export function pickCustomColor({ current = null, anchor = null, onPick }) {
  const input = native();
  input.value = isHex(current) ? current.toLowerCase() : '#4a8dff';
  // Sit where the swatch was so the picker popover opens next to it.
  const rect = anchor?.getBoundingClientRect?.();
  input.style.left = `${Math.round(rect ? rect.left : window.innerWidth / 2)}px`;
  input.style.top = `${Math.round(rect ? rect.bottom : window.innerHeight / 2)}px`;
  pending = onPick;
  input.click();
}

/**
 * Menu content below a palette: recent custom colors as swatches, then a
 * "Custom…" swatch and a hex field. `role` matches the palette's swatches.
 */
export function customColorRows({ current = null, onPick, role = 'menuitemradio', label = 'color' }) {
  const recent = recentColors();
  // The swatches are spelt in lower case; a colour from a file may be in upper case, and is the same colour.
  const chosen = isHex(current) ? current.toLowerCase() : null;
  const swatch = (hex) => el('button.swatch', {
    type: 'button', role, 'aria-checked': String(chosen === hex), 'aria-label': hex, title: hex,
    style: { background: hex }, onclick: () => onPick(hex),
  });
  const customBtn = el('button.swatch.custom', {
    type: 'button', role, 'aria-checked': 'false', 'aria-label': `Custom ${label}…`, title: 'Custom color…',
    onclick: (e) => pickCustomColor({ current, anchor: e.currentTarget, onPick }),
  });
  // A red border alone says nothing to a screen reader: the field is marked invalid and told why.
  const hexHint = el('p.field-error', { id: fieldId('hex-error'), hidden: true, role: 'alert', style: { margin: '0', padding: '0 8px 8px' } }, 'Enter a color like #1a73e8');
  const hexInput = el('input.input.color-hex', {
    type: 'text', placeholder: '#rrggbb', 'aria-label': `${label} as a hex code`, value: chosen || '',
    spellcheck: false, autocomplete: 'off', maxlength: 7, 'aria-describedby': hexHint.id,
  });
  const markHex = (invalid) => {
    hexInput.classList.toggle('invalid', invalid);
    if (invalid) hexInput.setAttribute('aria-invalid', 'true');
    else hexInput.removeAttribute('aria-invalid');
    hexHint.hidden = !invalid;
  };
  hexInput.addEventListener('keydown', (e) => {
    if (isComposing(e)) return;
    e.stopPropagation();
    if (e.key !== 'Enter') { markHex(false); return; }
    e.preventDefault();
    const v = normalizeHex(hexInput.value);
    if (!v) { markHex(true); return; }
    markHex(false);
    rememberColor(v);
    onPick(v);
  });
  const rows = [];
  if (recent.length) rows.push(el('div.swatches.swatches-recent', { role: 'group', 'aria-label': 'Recent colors' }, ...recent.map(swatch)));
  rows.push(el('div', {}, el('div.color-custom-row', {}, customBtn, hexInput), hexHint));
  return rows;
}
