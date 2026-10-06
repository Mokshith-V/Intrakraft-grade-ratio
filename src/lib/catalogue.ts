import { isGrade, type Product } from './types';

export const REQUIRED_COLUMNS = ['Style_Code', 'Style_Name', 'IK_Colour_Name', 'Size_Code', 'MRP', 'Brick'] as const;

/** Attribute columns the ratio can be grouped by. Only those present (with values) in the file are offered. */
export const GROUPABLE_ATTRIBUTES = [
  'Brick', 'Category', 'Neck', 'Sleeve', 'Collar', 'Fit', 'Pattern', 'Length',
  'Occasion', 'Segment', 'Department', 'Vertical', 'Season_Name',
] as const;

/** Optional column names that, if a future file has them, give each product a starting Grade. */
const GRADE_COLUMNS = ['Grade', 'Product_Grade', 'IK_Grade'];

export class CatalogueError extends Error {
  constructor(message: string, public missingColumns: string[] = []) {
    super(message);
    this.name = 'CatalogueError';
  }
}

export interface ParsedCatalogue {
  products: Product[];
  attributeKeys: string[];
  rowCount: number;
  skippedRows: number;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Returns required columns that are missing from the header row (case/space-insensitive). */
export function findMissingColumns(headers: string[]): string[] {
  const have = new Set(headers.map(norm));
  return REQUIRED_COLUMNS.filter((c) => !have.has(norm(c)));
}

/* ---------- size ordering ---------- */

/** Rank for letter sizes: M=0, S=-1, XS=-2, 2XS/XXS=-3 …, L=1, XL=2, XXL/2XL=3, 3XL=4 … */
function letterRank(size: string): number | null {
  const s = size.toUpperCase().replace(/\s+/g, '');
  if (s === 'M') return 0;
  let m = /^(X*)([SL])$/.exec(s);
  if (m) return (m[2] === 'S' ? -1 : 1) * (1 + m[1].length);
  m = /^(\d+)X([SL])$/.exec(s);
  if (m) return (m[2] === 'S' ? -1 : 1) * (1 + Number(m[1]));
  return null;
}

/** Numeric sizes (28, 30, 32) and age ranges (4-5Y, 9-10Y, 6-12M) sort by their first number. */
function numericRank(size: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*([YM]|YRS?|MONTHS?)?$/i.exec(size.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] && /^M/i.test(m[2]) ? n / 12 : n; // months before years
}

/**
 * Sort sizes small → large. Letter sizes, then numeric/age sizes; anything unrecognised keeps
 * the order it first appeared in the file (`fileOrder`).
 */
export function sortSizes(sizes: Iterable<string>, fileOrder: string[] = []): string[] {
  const idx = (s: string) => {
    const i = fileOrder.indexOf(s);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const key = (s: string): [number, number] => {
    const l = letterRank(s);
    if (l !== null) return [0, l];
    const n = numericRank(s);
    if (n !== null) return [1, n];
    return [2, idx(s)];
  };
  return [...new Set(sizes)].sort((a, b) => {
    const [ga, ra] = key(a);
    const [gb, rb] = key(b);
    return ga - gb || ra - rb || idx(a) - idx(b);
  });
}

/* ---------- parsing ---------- */

/**
 * Groups SKU rows (one per size) into products (Style_Code + IK_Colour_Name).
 * Sizes are taken only from the file's Size_Code column. Throws CatalogueError listing any
 * missing required columns.
 */
export function parseCatalogue(rows: Record<string, unknown>[], headers?: string[]): ParsedCatalogue {
  const headerList = headers ?? Object.keys(rows[0] ?? {});
  if (!rows.length && !headerList.length) throw new CatalogueError('The file has no rows.');
  const missing = findMissingColumns(headerList);
  if (missing.length) {
    throw new CatalogueError(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, missing);
  }
  if (!rows.length) throw new CatalogueError('The file has the right columns but no product rows.');

  // Map canonical name → actual header in this file (tolerates "style code", "STYLE_CODE", …).
  const actual = new Map(headerList.map((h) => [norm(h), h]));
  const col = (name: string) => actual.get(norm(name));
  const get = (r: Record<string, unknown>, name: string) => {
    const h = col(name);
    return h ? text(r[h]) : '';
  };

  const attrCols = GROUPABLE_ATTRIBUTES.filter((a) => col(a));
  const gradeCol = GRADE_COLUMNS.find((g) => col(g));
  const fileSizeOrder: string[] = [];
  const map = new Map<string, Product & { sizeSet: Set<string> }>();
  let skipped = 0;

  for (const r of rows) {
    const code = get(r, 'Style_Code');
    const size = get(r, 'Size_Code');
    if (!code || !size) {
      skipped++;
      continue;
    }
    if (!fileSizeOrder.includes(size)) fileSizeOrder.push(size);
    const colour = get(r, 'IK_Colour_Name');
    const id = `${code}|${colour}`;
    let p = map.get(id);
    if (!p) {
      const grade = gradeCol ? get(r, gradeCol).toUpperCase() : '';
      p = {
        id,
        styleCode: code,
        styleName: get(r, 'Style_Name'),
        brand: get(r, 'Brand_Name'),
        colour,
        colourHex: get(r, 'IK_Colour_Code'),
        mrp: Number(get(r, 'MRP')) || 0,
        sizes: [],
        sizeSet: new Set(),
        attrs: Object.fromEntries(attrCols.map((a) => [a, get(r, a)])),
        ...(isGrade(grade) ? { fileGrade: grade } : {}),
      };
      map.set(id, p);
    }
    p.sizeSet.add(size);
  }

  const products: Product[] = [...map.values()].map(({ sizeSet, ...p }) => ({
    ...p,
    sizes: sortSizes(sizeSet, fileSizeOrder),
  }));
  if (!products.length) throw new CatalogueError('No rows had both a Style_Code and a Size_Code.');

  return {
    products,
    attributeKeys: attrCols.filter((a) => products.some((p) => p.attrs[a])),
    rowCount: rows.length,
    skippedRows: skipped,
  };
}
