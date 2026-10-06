import { read, utils, writeFile } from 'xlsx';
import { parseCatalogue, type ParsedCatalogue } from './catalogue';

/** Reads the first sheet of an .xlsx/.xls/.csv file and parses it into products. */
export function readCatalogueFile(data: ArrayBuffer): ParsedCatalogue {
  const wb = read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('The workbook has no sheets.');
  const headerRow = (utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })[0] ?? []).map((h) => String(h ?? ''));
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return parseCatalogue(rows, headerRow);
}

export function downloadXlsx(rows: Record<string, unknown>[], fileName: string, sheetName = 'Cart') {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), sheetName);
  writeFile(wb, fileName);
}

export function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
