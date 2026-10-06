import { useMemo, useState } from 'react';
import { cartTotals, formatINR, lineSetQty, lineTotal, lineValue } from '../lib/cart';
import { GRADES, type CartLine, type Grade, type Product } from '../lib/types';
import { NumberCell } from './NumberCell';

interface Props {
  cart: CartLine[];
  products: Map<string, Product>;
  ratioApplied: boolean;
  onGrade: (ids: string[], grade: Grade) => void;
  onRemove: (ids: string[]) => void;
  onSets: (id: string, sets: number) => void;
  onQty: (id: string, size: string, qty: number) => void;
  onOpenRatio: () => void;
  onExport: () => void;
}

export function CartView({ cart, products, ratioApplied, onGrade, onRemove, onSets, onQty, onOpenRatio, onExport }: Props) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkGrade, setBulkGrade] = useState<Grade>('B');
  const totals = useMemo(() => cartTotals(cart, products), [cart, products]);
  const selIds = cart.map((l) => l.productId).filter((id) => sel.has(id));
  const allSel = cart.length > 0 && selIds.length === cart.length;
  const filled = cart.some((l) => lineTotal(l) > 0);

  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <section className="panel" aria-labelledby="cart-h">
      <div className="panel-head">
        <h2 id="cart-h">Cart</h2>
        <span className="head-actions">
          <button className="btn sm ghost-light" onClick={onExport} disabled={!cart.length}>Export .xlsx</button>
          <button className="btn sm dark" onClick={onOpenRatio} disabled={!cart.length}>⚖ Input Ratio</button>
        </span>
      </div>

      <div className={`help${ratioApplied && filled ? ' ok' : ''}`} role="note">
        {!cart.length ? (
          <><b>Your cart is empty.</b> Tick products in the catalogue, pick a Grade and press <b>Add to Cart</b>.</>
        ) : ratioApplied && filled ? (
          <><b>Ratio applied.</b> Each box is the quantity per set for that size. Line total = (sum of sizes) × Sets. Raise <b>Sets</b> to scale a line, or reopen <b>Input Ratio</b> to change it.</>
        ) : (
          <><b>Next:</b> give every product a <b>Grade</b> (A/B/C/D), then press <b>Input Ratio</b>. Products with the same Grade in the same group share one size ratio.</>
        )}
      </div>

      {cart.length > 0 && (
        <>
          <div className="selbar">
            <label className="inline-field">
              <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set(cart.map((l) => l.productId)) : new Set())} />
              Select all
            </label>
            <span className="muted">{selIds.length} selected</span>
            <span className="spacer" />
            <label className="inline-field">
              Set Grade
              <select value={bulkGrade} onChange={(e) => setBulkGrade(e.target.value as Grade)} className={`grade-select g${bulkGrade}`} aria-label="Grade for selected lines">
                {GRADES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <button className="btn sm" disabled={!selIds.length} onClick={() => onGrade(selIds, bulkGrade)}>Apply to selected</button>
            <button
              className="btn sm danger"
              disabled={!selIds.length}
              onClick={() => {
                onRemove(selIds);
                setSel(new Set());
              }}
            >
              Remove selected
            </button>
          </div>

          <ul className="cart-list" aria-label="Cart lines">
            {cart.map((l) => {
              const p = products.get(l.productId);
              if (!p) return null;
              const name = `${p.styleName} ${p.colour}`;
              return (
                <li key={l.productId} className="line">
                  <div className="line-head">
                    <span className="line-title">{p.styleName} – {p.colour} – {p.styleCode}</span>
                    <span>MRP: {formatINR(p.mrp)}</span>
                  </div>
                  <div className="line-body">
                    <input type="checkbox" checked={sel.has(l.productId)} onChange={(e) => toggle(l.productId, e.target.checked)} aria-label={`Select ${name}`} />
                    <span className="swatch lg" style={{ background: p.colourHex || '#ccc' }} aria-hidden="true" />
                    <div className="cells">
                      <label className="cell">
                        <span>GRADE</span>
                        <select value={l.grade} onChange={(e) => onGrade([l.productId], e.target.value as Grade)} className={`grade-select g${l.grade}`} aria-label={`Grade for ${name}`}>
                          {GRADES.map((g) => <option key={g}>{g}</option>)}
                        </select>
                      </label>
                      {p.sizes.map((s) => (
                        <label className="cell" key={s}>
                          <span>{s}</span>
                          <NumberCell value={l.qty[s] ?? 0} onCommit={(n) => onQty(l.productId, s, n)} label={`${s} quantity for ${name}`} />
                        </label>
                      ))}
                      <span className="op" aria-hidden="true">×</span>
                      <label className="cell">
                        <span>SETS</span>
                        <NumberCell value={l.sets} min={1} onCommit={(n) => onSets(l.productId, n)} label={`Sets for ${name}`} />
                      </label>
                      <span className="op" aria-hidden="true">=</span>
                      <span className="line-total" aria-label={`Total ${lineTotal(l)}`}>{lineTotal(l)}</span>
                    </div>
                    <button className="icon-btn" onClick={() => onRemove([l.productId])} aria-label={`Remove ${name}`} title="Remove">🗑</button>
                  </div>
                  <div className="line-foot muted small">
                    {p.attrs.Brick}{p.attrs.Neck ? ` · ${p.attrs.Neck}` : ''}{p.attrs.Sleeve ? ` · ${p.attrs.Sleeve}` : ''} ·{' '}
                    {lineSetQty(l)} pcs/set × {l.sets} = <b>{lineTotal(l)} pcs</b> · <b>{formatINR(lineValue(l, p))}</b>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <aside className="summary" aria-label="Cart summary">
        <h3>Summary</h3>
        <table>
          <tbody>
            <tr><th scope="row">Total Colourways</th><td>{totals.colourways}</td></tr>
            <tr><th scope="row">Total Quantity</th><td>{totals.quantity}</td></tr>
            <tr><th scope="row">Total MRP Value</th><td>{formatINR(totals.value)}</td></tr>
            <tr>
              <th scope="row">By Grade</th>
              <td>{GRADES.filter((g) => totals.byGrade[g]).map((g) => <span key={g} className={`gtag g${g}`}>{g}: {totals.byGrade[g]}</span>)}{!cart.length && '—'}</td>
            </tr>
          </tbody>
        </table>
      </aside>
    </section>
  );
}
