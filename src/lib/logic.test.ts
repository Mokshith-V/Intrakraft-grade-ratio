import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addToCart, cartExportRows, cartTotals, newCartLine } from './cart';
import { CatalogueError, parseCatalogue, sortSizes } from './catalogue';
import { readCatalogueFile } from './excel';
import {
  applyRatio, checkCell, checkRow, exportRatioJson, formatReadout, groupCart, groupKey, importRatioJson, toRatioTable,
} from './ratio';
import { emptyState, KEYS, loadState, saveCatalogue, saveRest, STORAGE_VERSION } from './storage';
import type { CartLine, Grade, Product, RatioInputs } from './types';

/* ---------- fixtures ---------- */

const row = (code: string, colour: string, size: string, extra: Record<string, string | number> = {}) => ({
  Style_Code: code, Style_Name: `Style ${code}`, IK_Colour_Name: colour, IK_Colour_Code: '#000', Size_Code: size,
  MRP: 999, Brick: 'Shirts', Category: 'Top_Wear', Neck: '', Sleeve: 'Full Sleeve', ...extra,
});

const tees = (code: string, neck: string, sizes: string[]) =>
  sizes.map((s) => row(code, 'White', s, { Brick: 'T-Shirts', Neck: neck, Sleeve: 'Half Sleeve' }));

const parsed = parseCatalogue([
  ...['S', 'M', 'L'].map((s) => row('100', 'Black', s)),
  ...['S', 'M', 'L'].map((s) => row('100', 'Blue', s)),
  ...['M', 'S', 'L', 'XL'].map((s) => row('200', 'Black', s)),
  ...['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map((s) => row('300', 'Grey', s)),
  ...tees('400', 'Round Neck', ['S', 'M', 'L']),
  ...tees('500', 'Polo Neck', ['S', 'M', 'L']),
]);
const byId = new Map(parsed.products.map((p) => [p.id, p]));
const P = (id: string) => byId.get(id)!;
const line = (id: string, grade: Grade): CartLine => ({ ...newCartLine(P(id)), grade });

/* ---------- parsing ---------- */

describe('parseCatalogue', () => {
  it('groups SKU rows (one per size) into products by Style_Code + colour', () => {
    expect(parsed.products.map((p) => p.id)).toEqual(['100|Black', '100|Blue', '200|Black', '300|Grey', '400|White', '500|White']);
    expect(P('100|Black').sizes).toEqual(['S', 'M', 'L']);
    expect(P('100|Black').attrs).toMatchObject({ Brick: 'Shirts', Category: 'Top_Wear', Sleeve: 'Full Sleeve' });
    expect(parsed.rowCount).toBe(23);
  });

  it('takes sizes from the file, including XS and 3XL, ordered small → large', () => {
    expect(P('300|Grey').sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(P('200|Black').sizes).toEqual(['S', 'M', 'L', 'XL']); // file order was M, S, L, XL
  });

  it('never invents sizes: a product only has the sizes it has rows for', () => {
    expect(P('100|Black').sizes).not.toContain('XL');
  });

  it('orders age and numeric sizes and keeps unknown sizes in file order', () => {
    expect(sortSizes(['9-10Y', '4-5Y', '13-14Y', '5-6Y'])).toEqual(['4-5Y', '5-6Y', '9-10Y', '13-14Y']);
    expect(sortSizes(['34', '28', '30'])).toEqual(['28', '30', '34']);
    expect(sortSizes(['FREE', 'ONE'], ['FREE', 'ONE'])).toEqual(['FREE', 'ONE']);
    expect(sortSizes(['2XL', 'M', 'XXS', '4XL'])).toEqual(['XXS', 'M', '2XL', '4XL']);
  });

  it('lists every missing required column', () => {
    try {
      parseCatalogue([{ Style_Code: 1, Style_Name: 'x', IK_Colour_Name: 'Red' }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogueError);
      expect((e as CatalogueError).missingColumns).toEqual(['Size_Code', 'MRP', 'Brick']);
    }
  });

  it('skips rows without a style code or size', () => {
    const r = parseCatalogue([row('1', 'Red', 'S'), row('', 'Red', 'M'), row('1', 'Red', '')]);
    expect(r.products).toHaveLength(1);
    expect(r.skippedRows).toBe(2);
  });

  it('only uses a Grade column if the file has one (the sample file does not)', () => {
    expect(P('100|Black').fileGrade).toBeUndefined();
    const g = parseCatalogue([row('1', 'Red', 'S', { Grade: 'b' })]);
    expect(g.products[0].fileGrade).toBe('B');
  });

  it('parses the real sample catalogue: 403 rows → 77 products, sizes from the file', () => {
    const buf = readFileSync(resolve(__dirname, '../../public/sample_catalogue_file.xlsx'));
    const cat = readCatalogueFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(cat.rowCount).toBe(403);
    expect(cat.products).toHaveLength(77);
    expect(new Set(cat.products.map((p) => p.attrs.Brick))).toEqual(new Set(['Trousers', 'Shirts', 'T-Shirts']));
    const allSizes = new Set(cat.products.flatMap((p) => p.sizes));
    expect(allSizes).toEqual(new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']));
    expect(cat.attributeKeys).toEqual(expect.arrayContaining(['Brick', 'Category', 'Neck', 'Sleeve']));
  });
});

/* ---------- grouping ---------- */

describe('groupKey / groupCart', () => {
  it('builds keys from one or more attributes', () => {
    expect(groupKey(P('400|White'), ['Brick'])).toBe('T-Shirts');
    expect(groupKey(P('400|White'), ['Brick', 'Neck'])).toBe('T-Shirts | Round Neck');
    expect(groupKey(P('100|Black'), ['Brick', 'Neck'])).toBe('Shirts | (blank)');
  });

  it('Brick+Neck splits T-Shirts by neck; Brick alone keeps them together', () => {
    const cart = [line('400|White', 'A'), line('500|White', 'A'), line('100|Black', 'B')];
    expect(groupCart(cart, byId, ['Brick']).map((g) => g.key)).toEqual(['T-Shirts', 'Shirts']);
    const bn = groupCart(cart, byId, ['Brick', 'Neck']);
    expect(bn.map((g) => g.key)).toEqual(['T-Shirts | Round Neck', 'T-Shirts | Polo Neck', 'Shirts | (blank)']);
    expect(bn[0].items.map((i) => i.product.styleCode)).toEqual(['400']);
  });

  it('a group shows the union of its products sizes and only the grades in the cart', () => {
    const [g] = groupCart([line('100|Black', 'A'), line('300|Grey', 'C')], byId, ['Brick']);
    expect(g.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(g.grades).toEqual(['A', 'C']);
  });
});

/* ---------- validation ---------- */

describe('ratio validation', () => {
  it('accepts whole numbers ≥ 0 and empty, rejects the rest', () => {
    expect(checkCell('')).toEqual({ ok: true, value: null });
    expect(checkCell('3')).toEqual({ ok: true, value: 3 });
    expect(checkCell('-1')).toMatchObject({ ok: false, error: 'No negatives' });
    expect(checkCell('1.5')).toMatchObject({ ok: false, error: 'Whole numbers only' });
    expect(checkCell('abc')).toMatchObject({ ok: false });
  });

  it('flags all-zero rows and builds the readout', () => {
    expect(checkRow({ S: '0', M: '' }, ['S', 'M']).allZero).toBe(true);
    const r = checkRow({ S: '1', M: '2', L: '1', XL: '0' }, ['S', 'M', 'L', 'XL']);
    expect(r.allZero).toBe(false);
    expect(formatReadout(r.values, ['S', 'M', 'L', 'XL'])).toBe('S:M:L = 1:2:1');
  });
});

/* ---------- applying ---------- */

const ABC: RatioInputs = {
  Shirts: {
    A: { S: '1', M: '2', L: '1' },
    B: { S: '2', M: '2', L: '1' },
    C: { S: '1', M: '1', L: '2' },
  },
};

describe('applyRatio', () => {
  it('applies a separate ratio per Grade (assignment example A=1:2:1, B=2:2:1, C=1:1:2)', () => {
    const cart = [line('100|Black', 'A'), line('100|Blue', 'B'), line('200|Black', 'C')];
    const { cart: out, report } = applyRatio(cart, byId, toRatioTable(ABC), ['Brick']);
    expect(out[0].qty).toEqual({ S: 1, M: 2, L: 1 });
    expect(out[1].qty).toEqual({ S: 2, M: 2, L: 1 });
    expect(out[2].qty).toEqual({ S: 1, M: 1, L: 2, XL: 0 });
    expect(report.every((r) => r.applied)).toBe(true);
    expect(cart[0].qty).toEqual({ S: 0, M: 0, L: 0 }); // input not mutated
  });

  it('gives 0 to product sizes missing from the ratio and reports them', () => {
    const { cart, report } = applyRatio([line('300|Grey', 'A')], byId, toRatioTable(ABC), ['Brick']);
    expect(cart[0].qty).toEqual({ XS: 0, S: 1, M: 2, L: 1, XL: 0, XXL: 0, '3XL': 0 });
    expect(report[0].missingInRatio).toEqual(['XS', 'XL', 'XXL', '3XL']);
  });

  it('reports ratio sizes the product does not come in', () => {
    const t = toRatioTable({ Shirts: { A: { XS: '1', S: '1', M: '1', L: '1' } } });
    const { report } = applyRatio([line('100|Black', 'A')], byId, t, ['Brick']);
    expect(report[0].notInProduct).toEqual(['XS']);
  });

  it('leaves lines unchanged when their Grade or group has no ratio (or an all-zero row)', () => {
    const t = toRatioTable({ Shirts: { A: { S: '1' }, D: { S: '0', M: '0' } } });
    const cart = [line('100|Black', 'B'), line('100|Blue', 'D'), line('400|White', 'A')];
    const { cart: out, report } = applyRatio(cart, byId, t, ['Brick']);
    expect(out).toEqual(cart);
    expect(report.map((r) => r.applied)).toEqual([false, false, false]);
  });

  it('uses Brick+Neck groups: Round Neck and Polo Neck tees get different ratios', () => {
    const t = toRatioTable({
      'T-Shirts | Round Neck': { A: { S: '1', M: '1', L: '1' } },
      'T-Shirts | Polo Neck': { A: { S: '0', M: '3', L: '1' } },
    });
    const { cart } = applyRatio([line('400|White', 'A'), line('500|White', 'A')], byId, t, ['Brick', 'Neck']);
    expect(cart[0].qty).toEqual({ S: 1, M: 1, L: 1 });
    expect(cart[1].qty).toEqual({ S: 0, M: 3, L: 1 });
  });
});

/* ---------- JSON export / import ---------- */

describe('exportRatioJson / importRatioJson', () => {
  const cart = [line('100|Black', 'A'), line('100|Blue', 'B'), line('200|Black', 'C')];

  it('exports exactly the Sample_Ratio_Format shape', () => {
    const json = exportRatioJson(groupCart(cart, byId, ['Brick']), ['Brick'], ABC);
    expect(json).toEqual([
      { title: 'Shirts', attribute_data: [{ key: 'Brick', value: 'Shirts' }], size: [{ size: 'S', value: 1 }, { size: 'M', value: 2 }, { size: 'L', value: 1 }, { size: 'XL', value: 0 }], grade: 'A' },
      { title: 'Shirts', attribute_data: [{ key: 'Brick', value: 'Shirts' }], size: [{ size: 'S', value: 2 }, { size: 'M', value: 2 }, { size: 'L', value: 1 }, { size: 'XL', value: 0 }], grade: 'B' },
      { title: 'Shirts', attribute_data: [{ key: 'Brick', value: 'Shirts' }], size: [{ size: 'S', value: 1 }, { size: 'M', value: 1 }, { size: 'L', value: 2 }, { size: 'XL', value: 0 }], grade: 'C' },
    ]);
    for (const e of json) expect(Object.keys(e)).toEqual(['title', 'attribute_data', 'size', 'grade']);
  });

  it('exports multi-attribute levels with one attribute_data entry per attribute', () => {
    const tc = [line('400|White', 'A')];
    const [e] = exportRatioJson(groupCart(tc, byId, ['Brick', 'Neck']), ['Brick', 'Neck'], { 'T-Shirts | Round Neck': { A: { M: '2' } } });
    expect(e.title).toBe('T-Shirts - Round Neck');
    expect(e.attribute_data).toEqual([{ key: 'Brick', value: 'T-Shirts' }, { key: 'Neck', value: 'Round Neck' }]);
  });

  it('round-trips through import', () => {
    const json = exportRatioJson(groupCart(cart, byId, ['Brick']), ['Brick'], ABC);
    const imp = importRatioJson(JSON.parse(JSON.stringify(json)));
    expect(imp.errors).toEqual([]);
    expect(imp.levels).toEqual([['Brick']]);
    expect(imp.byLevel.Brick.Shirts.B).toEqual({ S: '2', M: '2', L: '1', XL: '0' });
  });

  it('imports the sample file format and skips bad entries with a reason', () => {
    const imp = importRatioJson([
      { title: 'Dresses', attribute_data: [{ key: 'Brick', value: 'Dresses' }], size: [{ size: '4-5Y', value: 0 }, { size: '5-6Y', value: 2 }], grade: 'A' },
      { title: 'x', attribute_data: [{ key: 'Brick', value: 'x' }], size: [{ size: 'S', value: -1 }], grade: 'A' },
      { title: 'y', attribute_data: [{ key: 'Brick', value: 'y' }], size: [], grade: 'Z' },
    ]);
    expect(imp.count).toBe(1);
    expect(imp.byLevel.Brick.Dresses.A).toEqual({ '4-5Y': '0', '5-6Y': '2' });
    expect(imp.errors).toHaveLength(2);
    expect(importRatioJson('nope').errors[0]).toMatch(/array/);
  });
});

/* ---------- cart ---------- */

describe('cart', () => {
  it('ignores duplicates when adding', () => {
    const products: Product[] = [P('100|Black'), P('100|Blue')];
    const first = addToCart([], products, 'B');
    const again = addToCart(first.cart, [P('100|Black'), P('200|Black')]);
    expect(first.cart.map((l) => l.grade)).toEqual(['B', 'B']);
    expect(again.added).toBe(1);
    expect(again.duplicates).toBe(1);
    expect(again.cart).toHaveLength(3);
  });

  it('totals colourways, quantity (sizes × sets) and MRP value', () => {
    const { cart } = applyRatio([line('100|Black', 'A'), { ...line('100|Blue', 'B'), sets: 2 }], byId, toRatioTable(ABC), ['Brick']);
    const t = cartTotals(cart, byId);
    expect(t).toMatchObject({ colourways: 2, quantity: 4 + 5 * 2, value: (4 + 10) * 999 });
    const rows = cartExportRows(cart, byId);
    expect(rows[1]).toMatchObject({ Grade: 'B', S: 2, M: 2, L: 1, Sets: 2, Total_Qty: 10, MRP_Value: 9990 });
  });
});

/* ---------- persistence ---------- */

class MemStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

describe('storage', () => {
  const catalogue = { fileName: 'f.xlsx', loadedAt: '2026-10-05T10:00:00Z', rowCount: 23, products: parsed.products, attributeKeys: parsed.attributeKeys };

  it('saves and restores catalogue, cart, ratios, level and filters', () => {
    const s = new MemStorage();
    const state = { ...emptyState(), catalogue, cart: [line('100|Black', 'C')], ratioInputs: { Brick: ABC }, level: ['Brick', 'Neck'] };
    state.filters.search = 'tee';
    saveCatalogue(s, state.catalogue);
    saveRest(s, state);
    const { state: back, warning } = loadState(s);
    expect(warning).toBeUndefined();
    expect(back).toEqual(state);
  });

  it('falls back to an empty state for corrupt or old-version data', () => {
    const s = new MemStorage();
    s.setItem(KEYS.catalogue, '{not json');
    expect(loadState(s)).toMatchObject({ state: emptyState(), warning: expect.any(String) });
    s.setItem(KEYS.catalogue, JSON.stringify({ version: STORAGE_VERSION + 1, data: catalogue }));
    expect(loadState(s).state.catalogue).toBeNull();
  });

  it('drops cart lines that point at unknown products or have bad numbers', () => {
    const s = new MemStorage();
    saveCatalogue(s, catalogue);
    s.setItem(KEYS.state, JSON.stringify({ version: STORAGE_VERSION, data: { cart: [line('100|Black', 'A'), { ...line('100|Blue', 'A'), sets: -2 }, { ...line('100|Black', 'A') }, { productId: 'ghost', grade: 'A', sets: 1, qty: {} }] } }));
    expect(loadState(s).state.cart.map((l) => l.productId)).toEqual(['100|Black']);
  });

  it('survives storage that throws', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    expect(loadState(bad).state).toEqual(emptyState());
    expect(saveRest(bad, emptyState())).toMatch(/Could not save/);
  });
});
