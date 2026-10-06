import { sortSizes } from './catalogue';
import {
  GRADES, isGrade,
  type CartLine, type Grade, type Product, type RatioInputs, type RatioJsonEntry, type RatioTable,
} from './types';

export const BLANK = '(blank)';
const VALUE_SEP = ' | ';

export const levelKey = (attrs: string[]) => attrs.join('+');
export const levelFromKey = (key: string) => key.split('+').filter(Boolean);

/** Group key of a product at an attribute level, e.g. ["Brick","Neck"] → "T-Shirts | Round Neck". */
export function groupKey(product: Pick<Product, 'attrs'>, attrs: string[]): string {
  return attrs.map((a) => product.attrs[a]?.trim() || BLANK).join(VALUE_SEP);
}

export const groupValues = (key: string) => key.split(VALUE_SEP);

export interface CartGroup {
  key: string;
  values: string[];
  items: { line: CartLine; product: Product }[];
  /** Union of the group's product sizes, small → large. */
  sizes: string[];
  /** Grades actually present on cart lines in this group. */
  grades: Grade[];
}

/** Groups cart lines by the chosen attribute level. Groups keep first-seen cart order. */
export function groupCart(cart: CartLine[], products: Map<string, Product>, attrs: string[]): CartGroup[] {
  const groups = new Map<string, CartGroup>();
  for (const line of cart) {
    const product = products.get(line.productId);
    if (!product) continue;
    const key = groupKey(product, attrs);
    let g = groups.get(key);
    if (!g) {
      g = { key, values: groupValues(key), items: [], sizes: [], grades: [] };
      groups.set(key, g);
    }
    g.items.push({ line, product });
  }
  for (const g of groups.values()) {
    const fileOrder = g.items.flatMap((i) => i.product.sizes);
    g.sizes = sortSizes(fileOrder, fileOrder);
    g.grades = GRADES.filter((gr) => g.items.some((i) => i.line.grade === gr));
  }
  return [...groups.values()];
}

/* ---------- validation ---------- */

export type CellCheck = { ok: true; value: number | null } | { ok: false; error: string };

/** '' → not in ratio (null). Otherwise must be a whole number ≥ 0. */
export function checkCell(raw: string | undefined): CellCheck {
  const s = (raw ?? '').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'Numbers only' };
  const n = Number(s);
  if (n < 0) return { ok: false, error: 'No negatives' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Whole numbers only' };
  return { ok: true, value: n };
}

export interface RowCheck {
  errors: Record<string, string>;
  /** True when every size is empty or 0 — the row would order nothing. */
  allZero: boolean;
  /** Parsed sizes that have a value (including explicit 0). */
  values: Record<string, number>;
}

export function checkRow(row: Record<string, string> | undefined, sizes: string[]): RowCheck {
  const errors: Record<string, string> = {};
  const values: Record<string, number> = {};
  for (const s of sizes) {
    const c = checkCell(row?.[s]);
    if (!c.ok) errors[s] = c.error;
    else if (c.value !== null) values[s] = c.value;
  }
  return { errors, values, allZero: !Object.values(values).some((v) => v > 0) };
}

/** Live readout, e.g. "S:M:L = 1:2:1". Sizes with 0/empty are left out. */
export function formatReadout(values: Record<string, number>, sizes: string[]): string {
  const used = sizes.filter((s) => (values[s] ?? 0) > 0);
  if (!used.length) return '';
  return `${used.join(':')} = ${used.map((s) => values[s]).join(':')}`;
}

/** Converts typed inputs into a numeric table. Invalid cells and all-zero rows are dropped. */
export function toRatioTable(inputs: RatioInputs | undefined): RatioTable {
  const out: RatioTable = {};
  for (const [key, grades] of Object.entries(inputs ?? {})) {
    for (const g of GRADES) {
      const row = grades[g];
      if (!row) continue;
      const { values, allZero } = checkRow(row, Object.keys(row));
      if (allZero) continue;
      (out[key] ??= {})[g] = values;
    }
  }
  return out;
}

/* ---------- applying ---------- */

export interface ApplyLineReport {
  productId: string;
  groupKey: string;
  grade: Grade;
  applied: boolean;
  /** Product sizes the ratio doesn't mention — they were set to 0. */
  missingInRatio: string[];
  /** Ratio sizes with a value > 0 that this product doesn't come in — ignored. */
  notInProduct: string[];
  qty: Record<string, number>;
}

/**
 * Fills each cart line's size quantities from the ratio for its group + Grade.
 * Lines whose Grade has no ratio in their group are left unchanged. Pure: returns a new cart.
 */
export function applyRatio(
  cart: CartLine[],
  products: Map<string, Product>,
  table: RatioTable,
  attrs: string[],
): { cart: CartLine[]; report: ApplyLineReport[] } {
  const report: ApplyLineReport[] = [];
  const next = cart.map((line) => {
    const product = products.get(line.productId);
    if (!product) return line;
    const key = groupKey(product, attrs);
    const ratio = table[key]?.[line.grade];
    if (!ratio) {
      report.push({ productId: line.productId, groupKey: key, grade: line.grade, applied: false, missingInRatio: [], notInProduct: [], qty: line.qty });
      return line;
    }
    const qty = Object.fromEntries(product.sizes.map((s) => [s, ratio[s] ?? 0]));
    report.push({
      productId: line.productId,
      groupKey: key,
      grade: line.grade,
      applied: true,
      missingInRatio: product.sizes.filter((s) => !(s in ratio)),
      notInProduct: Object.keys(ratio).filter((s) => ratio[s] > 0 && !product.sizes.includes(s)),
      qty,
    });
    return { ...line, qty };
  });
  return { cart: next, report };
}

/* ---------- JSON export / import (Sample_Ratio_Format.docx shape) ---------- */

/**
 * One entry per group × Grade present in the cart, sizes in the group's order. Sizes the user
 * left empty are exported as 0, as in the sample file.
 */
export function exportRatioJson(groups: CartGroup[], attrs: string[], inputs: RatioInputs | undefined): RatioJsonEntry[] {
  const out: RatioJsonEntry[] = [];
  for (const g of groups) {
    const values = g.values.map((v) => (v === BLANK ? '' : v));
    for (const grade of g.grades) {
      const { values: nums } = checkRow(inputs?.[g.key]?.[grade], g.sizes);
      out.push({
        title: values.filter(Boolean).join(' - ') || BLANK,
        attribute_data: attrs.map((key, i) => ({ key, value: values[i] })),
        size: g.sizes.map((size) => ({ size, value: nums[size] ?? 0 })),
        grade,
      });
    }
  }
  return out;
}

export interface ImportResult {
  /** levelKey → inputs, ready to merge into state. */
  byLevel: Record<string, RatioInputs>;
  levels: string[][];
  count: number;
  errors: string[];
}

/** Parses JSON in the Sample_Ratio_Format shape. Bad entries are skipped and reported. */
export function importRatioJson(json: unknown): ImportResult {
  const result: ImportResult = { byLevel: {}, levels: [], count: 0, errors: [] };
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : null;
  if (!list) {
    result.errors.push('Expected a JSON array of ratio entries.');
    return result;
  }
  list.forEach((e, i) => {
    const where = `Entry ${i + 1}`;
    if (!e || typeof e !== 'object') return void result.errors.push(`${where}: not an object.`);
    const { attribute_data, size, grade } = e as Record<string, unknown>;
    if (!isGrade(grade)) return void result.errors.push(`${where}: grade must be one of ${GRADES.join(', ')}.`);
    if (!Array.isArray(attribute_data) || !attribute_data.length || !attribute_data.every((a) => a && typeof a.key === 'string'))
      return void result.errors.push(`${where}: attribute_data must be a list of {key, value}.`);
    if (!Array.isArray(size) || !size.every((s) => s && typeof s.size === 'string'))
      return void result.errors.push(`${where}: size must be a list of {size, value}.`);
    const bad = size.find((s) => !checkCell(String(s.value ?? '')).ok || s.value === '' || s.value === null);
    if (bad) return void result.errors.push(`${where}: size ${bad.size} must be a whole number ≥ 0.`);

    const attrs = attribute_data.map((a) => a.key as string);
    const lk = levelKey(attrs);
    const key = groupKey({ attrs: Object.fromEntries(attribute_data.map((a) => [a.key, String(a.value ?? '')])) }, attrs);
    if (!result.byLevel[lk]) {
      result.byLevel[lk] = {};
      result.levels.push(attrs);
    }
    ((result.byLevel[lk][key] ??= {})[grade] = Object.fromEntries(size.map((s) => [s.size, String(s.value)])));
    result.count++;
  });
  return result;
}
