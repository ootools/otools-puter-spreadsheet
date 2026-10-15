/** App-specific state in ODF's standard application settings container. */
import { odsNamespaceLookup } from './ods-validation.js';
const CONFIG = 'urn:oasis:names:tc:opendocument:xmlns:config:1.0';
const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

export function writeOdsSettings(meta, escape) {
  if (!meta) return '';
  return `<office:settings xmlns:office="${OFFICE}" xmlns:config="${CONFIG}"><config:config-item-set config:name="puter-spreadsheet"><config:config-item config:name="document-state" config:type="string">${escape(JSON.stringify(meta))}</config:config-item></config:config-item-set></office:settings>`;
}

export function readOdsSettings(xml, decode) {
  if (!xml || !xml.includes('document-state')) return null;
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const readers = new Map();
  const tags = /<([\w.-]+):config-item\b((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)<\/\1:config-item\s*>/g;
  let match;
  while ((match = tags.exec(xml))) {
    const bindings = new Map();
    const namespace = prefix => {
      if (!bindings.has(prefix)) {
        if (!readers.has(prefix)) readers.set(prefix, odsNamespaceLookup(xml, decode));
        bindings.set(prefix, readers.get(prefix)(match.index, prefix));
      }
      return bindings.get(prefix);
    };
    if (namespace(match[1]) !== CONFIG) continue;
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w.-]+):([\w.-]+)\s*=\s*(["'])(.*?)\3/gs)) {
      if (namespace(attr[1]) === CONFIG) attrs[attr[2]] = decode(attr[4]);
    }
    if (attrs.name !== 'document-state' || attrs.type !== 'string') continue;
    try {
      const meta = JSON.parse(decode(match[3]));
      if (meta?.format === 'puter-spreadsheet' && meta.v === 1 && meta.sheets && typeof meta.sheets === 'object' && !Array.isArray(meta.sheets)) return meta;
    } catch { /* Unrecognized or damaged settings must not prevent opening cells. */ }
  }
  return null;
}
