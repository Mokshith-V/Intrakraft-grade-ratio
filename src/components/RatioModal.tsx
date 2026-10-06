import { useMemo, useRef } from 'react';
import { applyRatio, checkRow, formatReadout, groupCart, toRatioTable, type CartGroup } from '../lib/ratio';
import type { CartLine, Grade, Product, RatioInputs } from '../lib/types';
import { Dialog } from './Dialog';

interface Props {
  cart: CartLine[];
  products: Map<string, Product>;
  attributeKeys: string[];
  level: string[];
  inputs: RatioInputs;
  hasUndo: boolean;
  onLevel: (level: string[]) => void;
  onRow: (key: string, grade: Grade, row: Record<string, string>) => void;
  onApply: (cart: CartLine[], applied: number, notes: number) => void;
  onReset: (keys: string[]) => void;
  onExport: (groups: CartGroup[]) => void;
  onImport: (file: File) => void;
  onClose: () => void;
}

/** First few product names, with the rest behind a "+N more" toggle so big groups stay compact. */
function ProductNames({ names, max = 3 }: { names: string[]; max?: number }) {
  if (names.length <= max) return <span className="muted small">{names.join(', ')}</span>;
  return (
    <details className="names">
      <summary className="muted small">
        {names.slice(0, max).join(', ')} <span className="more">+{names.length - max} more</span>
      </summary>
      <span className="muted small">{names.slice(max).join(', ')}</span>
    </details>
  );
}

const PRESETS =[['Brick'], ['Category'], ['Brick', 'Neck'], ['Brick', 'Sleeve']];
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function RatioModal(props: Props) {
  const { cart, products, attributeKeys, level, inputs, hasUndo, onLevel, onRow, onApply, onReset, onExport, onImport, onClose } = props;
  const importRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupCart(cart, products, level), [cart, products, level]);

  // Validate every visible row once; used for errors, warnings, readouts and the Set button.
  const checks = useMemo(() => {
    const m = new Map<string, ReturnType<typeof checkRow>>();
    for (const g of groups) for (const gr of g.grades) m.set(`${g.key}::${gr}`, checkRow(inputs[g.key]?.[gr], g.sizes));
    return m;
  }, [groups, inputs]);
  const errorCount = [...checks.values()].reduce((n, c) => n + Object.keys(c.errors).length, 0);
  const missing = groups.flatMap((g) =>
    g.grades.filter((gr) => checks.get(`${g.key}::${gr}`)?.allZero).map((gr) => ({ group: g, grade: gr, n: g.items.filter((i) => i.line.grade === gr).length })),
  );

  const preview = useMemo(() => {
    if (errorCount) return null;
    // Only rows for groups currently in the cart are applied.
    const visible: RatioInputs = Object.fromEntries(groups.map((g) => [g.key, inputs[g.key] ?? {}]));
    return applyRatio(cart, products, toRatioTable(visible), level);
  }, [cart, products, inputs, groups, level, errorCount]);
  const appliedCount = preview?.report.filter((r) => r.applied).length ?? 0;
  const noteCount = preview?.report.filter((r) => r.applied && (r.missingInRatio.length || r.notInProduct.length)).length ?? 0;

  const toggleAttr = (a: string, on: boolean) => {
    const next = on ? [...level, a] : level.filter((x) => x !== a);
    onLevel(next.length ? next : ['Brick']);
  };

  return (
    <Dialog
      wide
      title="Input Ratio"
      onClose={onClose}
      footer={
        <>
          <span className="row-gap">
            <button className="btn dark" onClick={() => onReset(groups.map((g) => g.key))} title={hasUndo ? 'Undo the last Set Ratio and clear these ratios' : 'Clear these ratios'}>
              Reset Ratio
            </button>
            <button className="btn" onClick={() => onExport(groups)} disabled={!groups.length}>Export JSON</button>
            <button className="btn" onClick={() => importRef.current?.click()}>Import JSON</button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImport(f);
              }}
            />
          </span>
          <button
            className="btn primary"
            disabled={!preview || !appliedCount}
            title={errorCount ? 'Fix the highlighted cells first' : !appliedCount ? 'Enter at least one ratio' : undefined}
            onClick={() => preview && onApply(preview.cart, appliedCount, noteCount)}
          >
            Set Ratio{appliedCount ? ` (${appliedCount})` : ''}
          </button>
        </>
      }
    >
      <div className="hint">
        <b>How it works:</b> 1) choose the <b>level</b> that groups products (e.g. Brick = all Shirts together). 2) In each group, type
        the size ratio for every Grade — Grade A: S 1, M 2, L 1 means 1 small : 2 medium : 1 large per set. 3) <b>Set Ratio</b> fills the
        cart. Grades are independent, and only Grades in your cart are shown. Leave a size empty to order 0 of it.
      </div>

      <fieldset className="levels">
        <legend>Group by</legend>
        <div className="row-gap">
          {PRESETS.filter((p) => p.every((a) => attributeKeys.includes(a))).map((p) => (
            <button key={p.join('+')} className={`pill${same(p, level) ? ' on' : ''}`} aria-pressed={same(p, level)} onClick={() => onLevel(p)}>
              {p.join(' + ')}
            </button>
          ))}
        </div>
        <details className="custom-level" open={!PRESETS.some((p) => same(p, level))}>
          <summary>Custom combination: <b>{level.join(' + ')}</b></summary>
          <div className="row-gap">
            {attributeKeys.map((a) => (
              <label key={a} className="check-pill">
                <input type="checkbox" checked={level.includes(a)} onChange={(e) => toggleAttr(a, e.target.checked)} /> {a}
              </label>
            ))}
          </div>
        </details>
      </fieldset>

      {errorCount > 0 && <div className="alert error" role="alert">{errorCount} cell{errorCount > 1 ? 's need' : ' needs'} fixing — whole numbers 0 or more only.</div>}
      {missing.length > 0 && (
        <div className="alert warn" role="status">
          <b>No ratio yet for:</b>{' '}
          {missing.map((m, i) => (
            <span key={m.group.key + m.grade}>
              {i > 0 && '; '}
              {m.group.values.join(' · ')} — Grade {m.grade} ({m.n} product{m.n > 1 ? 's' : ''})
            </span>
          ))}
          . These lines will be left unchanged.
        </div>
      )}

      {!groups.length && <div className="empty">Add products to the cart first.</div>}

      {groups.map((g) => (
        <div className="group" key={g.key}>
          <div className="group-head">
            <div className="group-title">
              <b>{g.values.join(' · ')}</b>
              <span className="count-pill">{g.items.length} product{g.items.length > 1 ? 's' : ''}</span>
            </div>
            <ProductNames names={g.items.map((i) => `${i.product.styleCode} ${i.product.colour}`)} />
          </div>
          {g.grades.map((gr) => {
            const row = inputs[g.key]?.[gr] ?? {};
            const c = checks.get(`${g.key}::${gr}`)!;
            const readout = formatReadout(c.values, g.sizes);
            const a = inputs[g.key]?.A;
            const count = g.items.filter((i) => i.line.grade === gr).length;
            const set = (size: string, v: string) => onRow(g.key, gr, { ...row, [size]: v });
            return (
              <div className="grade-row" key={gr}>
                <div className="grade-label">
                  <span className={`gtag g${gr}`}>GRADE {gr}</span>
                  <span className="muted small">{count} product{count > 1 ? 's' : ''}</span>
                </div>
                <div className="size-cells">
                  {g.sizes.map((s) => (
                    <label className="cell" key={s}>
                      <span>{s}</span>
                      <input
                        className={`qty${c.errors[s] ? ' invalid' : ''}`}
                        inputMode="numeric"
                        placeholder="–"
                        value={row[s] ?? ''}
                        onChange={(e) => set(s, e.target.value)}
                        aria-label={`${g.values.join(' ')} grade ${gr} size ${s}`}
                        aria-invalid={!!c.errors[s]}
                        title={c.errors[s]}
                      />
                    </label>
                  ))}
                </div>
                <div className="row-tools">
                  <span className={`readout${readout ? '' : ' no'}`} aria-live="polite">{readout || (Object.keys(c.errors).length ? 'invalid' : 'all zero – not set')}</span>
                  {gr !== 'A' && (
                    <button className="btn xs" disabled={!a || !Object.values(a).some((v) => v.trim())} onClick={() => onRow(g.key, gr, { ...a })}>
                      Copy from Grade A
                    </button>
                  )}
                  <button className="btn xs" onClick={() => onRow(g.key, gr, Object.fromEntries(g.sizes.map((s) => [s, '1'])))}>Fill all with 1</button>
                  <button className="btn xs link" onClick={() => onRow(g.key, gr, {})} disabled={!Object.keys(row).length}>Clear</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {preview && groups.length > 0 && (
        <details className="preview" open>
          <summary>
            Preview — {appliedCount} of {cart.length} cart product{cart.length > 1 ? 's' : ''} will change
            {noteCount > 0 && <span className="note-flag"> · {noteCount} with size notes</span>}
          </summary>
          <table className="preview-table">
            <thead>
              <tr><th>Product</th><th>Grade</th><th>Group</th><th>Result</th></tr>
            </thead>
            <tbody>
              {preview.report.map((r) => {
                const p = products.get(r.productId)!;
                return (
                  <tr key={r.productId} className={r.applied ? '' : 'skip'}>
                    <td>{p.styleCode} · {p.colour}</td>
                    <td><span className={`gtag g${r.grade}`}>{r.grade}</span></td>
                    <td>{r.groupKey}</td>
                    <td>
                      {r.applied ? p.sizes.map((s) => `${s}:${r.qty[s]}`).join(' ') : <i>unchanged — no ratio</i>}
                      {r.missingInRatio.length > 0 && (
                        <div className="note">Not in ratio → 0: {r.missingInRatio.join(', ')}</div>
                      )}
                      {r.notInProduct.length > 0 && (
                        <div className="note">Product has no {r.notInProduct.join(', ')} — ignored</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </Dialog>
  );
}
