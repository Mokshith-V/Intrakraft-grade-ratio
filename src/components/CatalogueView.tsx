import { useMemo, useState } from 'react';
import { formatINR } from '../lib/cart';
import { GRADES, type Catalogue, type Filters, type Grade, type Product, type SortKey } from '../lib/types';

interface Props {
  catalogue: Catalogue;
  filters: Filters;
  inCart: Set<string>;
  onFilters: (f: Partial<Filters>) => void;
  onAdd: (products: Product[], grade: Grade) => void;
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'file', label: 'File order' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'code', label: 'Style code' },
  { value: 'brick', label: 'Brick' },
  { value: 'mrp-asc', label: 'MRP low → high' },
  { value: 'mrp-desc', label: 'MRP high → low' },
];

const distinct = (products: Product[], attr: string) =>
  [...new Set(products.map((p) => p.attrs[attr]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function filterProducts(products: Product[], f: Filters): Product[] {
  const q = f.search.trim().toLowerCase();
  const list = products.filter(
    (p) =>
      (!f.brick || p.attrs.Brick === f.brick) &&
      (!f.neck || p.attrs.Neck === f.neck) &&
      (!f.sleeve || p.attrs.Sleeve === f.sleeve) &&
      (!q || `${p.styleName} ${p.styleCode} ${p.colour} ${p.brand}`.toLowerCase().includes(q)),
  );
  const cmp: Record<SortKey, ((a: Product, b: Product) => number) | null> = {
    file: null,
    name: (a, b) => a.styleName.localeCompare(b.styleName) || a.colour.localeCompare(b.colour),
    code: (a, b) => a.styleCode.localeCompare(b.styleCode, undefined, { numeric: true }) || a.colour.localeCompare(b.colour),
    brick: (a, b) => (a.attrs.Brick ?? '').localeCompare(b.attrs.Brick ?? '') || a.styleName.localeCompare(b.styleName),
    'mrp-asc': (a, b) => a.mrp - b.mrp,
    'mrp-desc': (a, b) => b.mrp - a.mrp,
  };
  const c = cmp[f.sort];
  return c ? [...list].sort(c) : list;
}

export function CatalogueView({ catalogue, filters, inCart, onFilters, onAdd }: Props) {
  const { products } = catalogue;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addGrade, setAddGrade] = useState<Grade>('A');

  const options = useMemo(
    () => ({ brick: distinct(products, 'Brick'), neck: distinct(products, 'Neck'), sleeve: distinct(products, 'Sleeve') }),
    [products],
  );
  const list = useMemo(() => filterProducts(products, filters), [products, filters]);
  const pages = Math.max(1, Math.ceil(list.length / filters.pageSize));
  const page = Math.min(filters.page, pages);
  const shown = list.slice((page - 1) * filters.pageSize, page * filters.pageSize);
  const selectable = list.filter((p) => !inCart.has(p.id));
  const selectedCount = [...selected].filter((id) => !inCart.has(id)).length;
  const anyFilter = filters.search || filters.brick || filters.neck || filters.sleeve;

  const setFilter = (f: Partial<Filters>) => onFilters({ ...f, page: 1 });
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const add = () => {
    onAdd(products.filter((p) => selected.has(p.id)), addGrade);
    setSelected(new Set());
  };

  return (
    <section className="panel" aria-labelledby="cat-h">
      <div className="panel-head">
        <h2 id="cat-h">Catalogue</h2>
        <span className="head-meta" aria-live="polite">{list.length} of {products.length} shown</span>
      </div>

      <div className="filters" role="search">
        <label className="field grow">
          <span className="sr-only">Search</span>
          <input type="search" placeholder="Search name, code, colour…" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
        </label>
        {(['brick', 'neck', 'sleeve'] as const).map((k) => (
          <label className="field" key={k}>
            <span className="sr-only">{k}</span>
            <select value={filters[k]} onChange={(e) => setFilter({ [k]: e.target.value })} aria-label={`Filter by ${k}`}>
              <option value="">All {k === 'brick' ? 'bricks' : k === 'neck' ? 'necks' : 'sleeves'}</option>
              {options[k].map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label className="field">
          <span className="sr-only">Sort</span>
          <select value={filters.sort} onChange={(e) => onFilters({ sort: e.target.value as SortKey })} aria-label="Sort products">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {anyFilter && (
          <button className="btn link" onClick={() => setFilter({ search: '', brick: '', neck: '', sleeve: '' })}>Clear filters</button>
        )}
      </div>

      <div className="selbar">
        <span><b>{selectedCount}</b> selected</span>
        <button className="btn sm" onClick={() => setSelected(new Set([...selected, ...selectable.map((p) => p.id)]))} disabled={!selectable.length}>
          Select all {selectable.length} shown
        </button>
        {selected.size > 0 && <button className="btn sm link" onClick={() => setSelected(new Set())}>Clear selection</button>}
        <span className="spacer" />
        <label className="inline-field">
          Grade
          <select value={addGrade} onChange={(e) => setAddGrade(e.target.value as Grade)} className={`grade-select g${addGrade}`} aria-label="Grade for added products">
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <button className="btn primary sm" onClick={add} disabled={!selectedCount}>
          Add {selectedCount || ''} to Cart
        </button>
      </div>

      <ul className="prod-list" aria-label="Products">
        {shown.map((p) => {
          const already = inCart.has(p.id);
          return (
            <li key={p.id} className={`prod${already ? ' in-cart' : ''}`}>
              <label className="prod-label">
                <input
                  type="checkbox"
                  checked={already || selected.has(p.id)}
                  disabled={already}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                  aria-label={`Select ${p.styleName} ${p.colour}`}
                />
                <span className="swatch" style={{ background: p.colourHex || '#ccc' }} aria-hidden="true" />
                <span className="prod-main">
                  <span className="prod-name">{p.styleName}</span>
                  <span className="muted small"> {p.styleCode} · {p.colour} · {formatINR(p.mrp)}</span>
                  <span className="chips">
                    {[p.attrs.Brick, p.attrs.Neck, p.attrs.Sleeve].filter(Boolean).map((a) => <span className="chip" key={a}>{a}</span>)}
                    <span className="muted small">Sizes: {p.sizes.join(', ')}</span>
                  </span>
                </span>
                {already && <span className="badge">In cart</span>}
              </label>
            </li>
          );
        })}
        {!shown.length && (
          <li className="empty">
            No products match these filters.{' '}
            <button className="btn link" onClick={() => setFilter({ search: '', brick: '', neck: '', sleeve: '' })}>Clear filters</button>
          </li>
        )}
      </ul>

      {list.length > 0 && (
        <nav className="pager" aria-label="Catalogue pages">
          <button className="btn sm" onClick={() => onFilters({ page: page - 1 })} disabled={page <= 1}>‹ Prev</button>
          <span>
            Page {page} of {pages} · {(page - 1) * filters.pageSize + 1}–{Math.min(page * filters.pageSize, list.length)} of {list.length}
          </span>
          <button className="btn sm" onClick={() => onFilters({ page: page + 1 })} disabled={page >= pages}>Next ›</button>
          <label className="inline-field">
            Per page
            <select value={filters.pageSize} onChange={(e) => onFilters({ pageSize: Number(e.target.value), page: 1 })}>
              {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </nav>
      )}
    </section>
  );
}
