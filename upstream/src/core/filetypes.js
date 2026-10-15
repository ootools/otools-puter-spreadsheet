/** Extensions supported by the workbook importer. */
export const IMPORT_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv', '.txt', '.ods', '.numbers', '.xlsb', '.fods'];

export function isSpreadsheetFile(name) {
  const lower = String(name || '').toLowerCase();
  return IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
