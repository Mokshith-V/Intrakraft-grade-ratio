import { sortSizes } from './catalogue';
import type { CartLine, Grade, Product } from './types';

export const lineSetQty = (line: CartLine) => Object.values(line.qty).reduce((a, b) => a + b, 0);
export const lineTotal = (line: CartLine) => lineSetQty(line) * line.sets;
export const lineValue = (line: CartLine, product: Product | undefined) => lineTotal(line) * (product?.mrp ?? 0);

export function newCartLine(product: Product, grade: Grade = 'A'): CartLine {
  return {
    productId: product.id,
    grade: product.fileGrade ?? grade,
    sets: 1,
    qty: Object.fromEntries(product.sizes.map((s) => [s, 0])),
  };
}

/** Adds products, skipping any already in the cart. */
export function addToCart(cart: CartLine[], products: Product[], grade: Grade = 'A') {
  const have = new Set(cart.map((l) => l.productId));
  const added: CartLine[] = [];
  let duplicates = 0;
  for (const p of products) {
    if (have.has(p.id)) {
      duplicates++;
      continue;
    }
    have.add(p.id);
    added.push(newCartLine(p, grade));
  }
  return { cart: [...cart, ...added], added: added.length, duplicates };
}

export interface CartTotals {
  colourways: number;
  quantity: number;
  value: number;
  byGrade: Record<string, number>;
}

export function cartTotals(cart: CartLine[], products: Map<string, Product>): CartTotals {
  const byGrade: Record<string, number> = {};
  let quantity = 0;
  let value = 0;
  for (const l of cart) {
    quantity += lineTotal(l);
    value += lineValue(l, products.get(l.productId));
    byGrade[l.grade] = (byGrade[l.grade] ?? 0) + 1;
  }
  return { colourways: cart.length, quantity, value, byGrade };
}

/** Rows for the cart .xlsx export: one row per line, one column per size used anywhere in the cart. */
export function cartExportRows(cart: CartLine[], products: Map<string, Product>) {
  const order = cart.flatMap((l) => products.get(l.productId)?.sizes ?? []);
  const sizes = sortSizes(order, order);
  return cart.map((l) => {
    const p = products.get(l.productId);
    const row: Record<string, string | number> = {
      Style_Code: p?.styleCode ?? l.productId,
      Style_Name: p?.styleName ?? '',
      Colour: p?.colour ?? '',
      Brick: p?.attrs.Brick ?? '',
      Grade: l.grade,
    };
    for (const s of sizes) row[s] = p?.sizes.includes(s) ? l.qty[s] ?? 0 : '';
    row.Sets = l.sets;
    row.Total_Qty = lineTotal(l);
    row.MRP = p?.mrp ?? 0;
    row.MRP_Value = lineValue(l, p);
    return row;
  });
}

export const formatINR = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
