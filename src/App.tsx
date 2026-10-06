import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartView } from './components/CartView';
import { CatalogueView } from './components/CatalogueView';
import { ConfirmDialog } from './components/Dialog';
import { RatioModal } from './components/RatioModal';
import { Steps } from './components/Steps';
import { UploadError, UploadZone } from './components/UploadZone';
import { addToCart, cartExportRows, lineTotal } from './lib/cart';
import { CatalogueError } from './lib/catalogue';
import { exportRatioJson, importRatioJson, levelKey } from './lib/ratio';
import type { Catalogue } from './lib/types';
import { useAppStore } from './state';

type Confirm = { title: string; message: React.ReactNode; confirmLabel: string; onConfirm: () => void } | null;
type UploadErr = { message: string; missing: string[] } | null;

// SheetJS is ~450 kB, so it is loaded only when a file is read or written.
const excel = () => import('./lib/excel');

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function App() {
  const { state, dispatch, saveError, loadWarning, clearAll } = useAppStore();
  const { catalogue, cart, level, filters } = state;
  const [loading, setLoading] = useState(false);
  const [uploadErr, setUploadErr] = useState<UploadErr>(null);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>();

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => {
    if (loadWarning) notify(loadWarning);
  }, [loadWarning, notify]);

  const products = useMemo(() => new Map(catalogue?.products.map((p) => [p.id, p]) ?? []), [catalogue]);
  const inCart = useMemo(() => new Set(cart.map((l) => l.productId)), [cart]);
  const levelInputs = state.ratioInputs[levelKey(level)] ?? {};

  /* ---------- upload ---------- */

  const parse = async (name: string, data: Promise<ArrayBuffer>) => {
    setLoading(true);
    setUploadErr(null);
    try {
      const buf = await data;
      await new Promise((r) => setTimeout(r, 0)); // let the spinner paint before the sync parse
      const parsed = (await excel()).readCatalogueFile(buf);
      const next: Catalogue = {
        fileName: name,
        loadedAt: new Date().toISOString(),
        rowCount: parsed.rowCount,
        products: parsed.products,
        attributeKeys: parsed.attributeKeys,
      };
      dispatch({ type: 'loadCatalogue', catalogue: next });
      notify(`${parsed.products.length} products loaded from ${parsed.rowCount} rows${parsed.skippedRows ? ` (${parsed.skippedRows} rows skipped: no Style_Code or Size_Code)` : ''}`);
    } catch (e) {
      setUploadErr(
        e instanceof CatalogueError
          ? { message: e.message, missing: e.missingColumns }
          : { message: `This doesn't look like a readable Excel file (${e instanceof Error ? e.message : 'unknown error'}).`, missing: [] },
      );
    } finally {
      setLoading(false);
    }
  };

  const withReplaceCheck = (go: () => void) => {
    if (!catalogue || !cart.length) return go();
    setConfirm({
      title: 'Replace catalogue?',
      message: (
        <>
          <p>Loading a new file <b>empties the cart</b> ({cart.length} product{cart.length > 1 ? 's' : ''}, with their grades and quantities).</p>
          <p className="muted">Typed ratios are kept, because they belong to attribute groups (e.g. Brick = Shirts), not to products.</p>
        </>
      ),
      confirmLabel: 'Replace and empty cart',
      onConfirm: () => {
        setConfirm(null);
        go();
      },
    });
  };

  const onFile = (f: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setUploadErr({ message: `"${f.name}" isn't an Excel file. Please choose a .xlsx file.`, missing: [] });
      return;
    }
    withReplaceCheck(() => parse(f.name, f.arrayBuffer()));
  };
  const onSample = () =>
    withReplaceCheck(() =>
      parse(
        'sample_catalogue_file.xlsx',
        fetch(`${import.meta.env.BASE_URL}sample_catalogue_file.xlsx`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
      ),
    );

  // Drag-and-drop anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => hasFiles(e) && (depth++, setDragging(true));
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && (depth = 0, setDragging(false));
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) onFileRef.current(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  /* ---------- ratio import / export ---------- */

  const importJson = async (f: File) => {
    try {
      const res = importRatioJson(JSON.parse(await f.text()));
      if (!res.count) return notify(`No ratios imported. ${res.errors[0] ?? ''}`);
      dispatch({ type: 'importRatios', byLevel: res.byLevel, level: res.levels[0] });
      notify(`Imported ${res.count} ratio row${res.count > 1 ? 's' : ''} at ${res.levels.map((l) => l.join(' + ')).join(', ')}` +
        (res.errors.length ? ` · ${res.errors.length} skipped (${res.errors[0]})` : ''));
    } catch {
      notify('That file is not valid JSON.');
    }
  };

  const filled = cart.some((l) => lineTotal(l) > 0);
  const stepsDone = [!!catalogue, cart.length > 0, cart.length > 0 && filled, !!state.lastApply && filled];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◈</span>
          <span><b>Intrakraft</b> <span className="brand-sub">iROMP · Catalogue, Cart &amp; Grade-wise Ratio</span></span>
        </div>
        <div className="top-actions">
          {catalogue && (
            <>
              <button className="btn ghost-light" onClick={() => fileRef.current?.click()}>Replace catalogue</button>
              <button className="btn dark" onClick={() => setRatioOpen(true)} disabled={!cart.length}>⚖ Input Ratio</button>
            </>
          )}
          <button
            className="btn ghost-light"
            disabled={!catalogue && !Object.keys(state.ratioInputs).length}
            onClick={() =>
              setConfirm({
                title: 'Clear all data?',
                message: <p>This removes the catalogue, cart, grades, quantities and every saved ratio from this browser. It can't be undone.</p>,
                confirmLabel: 'Clear all data',
                onConfirm: () => {
                  setConfirm(null);
                  clearAll();
                  setUploadErr(null);
                  notify('All data cleared.');
                },
              })
            }
          >
            Clear all data
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onFile(f);
            }}
          />
        </div>
      </header>

      {catalogue && (
        <div className="filebar" role="status">
          <span>
            <span aria-hidden="true">📄 </span>Loaded: <b>{catalogue.fileName}</b> · {catalogue.products.length} products · {catalogue.rowCount} rows · {fmtTime(catalogue.loadedAt)}
          </span>
          {loading && <span className="loading small"><span className="spinner" aria-hidden="true" /> Reading new file…</span>}
          {saveError ? <span className="save-state bad">⚠ {saveError}</span> : <span className="save-state">✓ Saved in this browser</span>}
        </div>
      )}
      {!catalogue && saveError && <div className="alert warn page-alert">{saveError}</div>}

      <Steps done={stepsDone} />

      {catalogue && uploadErr && <div className="page-alert"><UploadError error={uploadErr} /></div>}

      <main className={catalogue ? 'layout' : 'layout single'}>
        {catalogue ? (
          <>
            <CatalogueView
              catalogue={catalogue}
              filters={filters}
              inCart={inCart}
              onFilters={(f) => dispatch({ type: 'setFilters', filters: f })}
              onAdd={(ps, grade) => {
                const r = addToCart(cart, ps, grade);
                dispatch({ type: 'addProducts', products: ps, grade });
                notify(`${r.added} product${r.added === 1 ? '' : 's'} added as Grade ${grade}${r.duplicates ? ` · ${r.duplicates} already in cart` : ''}`);
              }}
            />
            <CartView
              cart={cart}
              products={products}
              ratioApplied={!!state.lastApply}
              onGrade={(ids, grade) => dispatch({ type: 'setGrade', ids, grade })}
              onRemove={(ids) => {
                dispatch({ type: 'removeLines', ids });
                notify(`${ids.length} line${ids.length > 1 ? 's' : ''} removed`);
              }}
              onSets={(id, sets) => dispatch({ type: 'setSets', id, sets })}
              onQty={(id, size, qty) => dispatch({ type: 'setQty', id, size, qty })}
              onOpenRatio={() => setRatioOpen(true)}
              onExport={async () => (await excel()).downloadXlsx(cartExportRows(cart, products), 'cart.xlsx')}
            />
          </>
        ) : (
          <UploadZone onFile={onFile} onSample={onSample} loading={loading} error={uploadErr} />
        )}
      </main>

      {ratioOpen && catalogue && (
        <RatioModal
          cart={cart}
          products={products}
          attributeKeys={catalogue.attributeKeys}
          level={level}
          inputs={levelInputs}
          hasUndo={!!state.lastApply}
          onLevel={(l) => dispatch({ type: 'setLevel', level: l })}
          onRow={(key, grade, row) => dispatch({ type: 'setRatioRow', key, grade, row })}
          onApply={(next, n, notes) => {
            dispatch({ type: 'applyRatio', cart: next });
            setRatioOpen(false);
            notify(`Ratio applied to ${n} product${n > 1 ? 's' : ''}${notes ? ` · ${notes} with size notes (see preview)` : ''}. Use Reset Ratio to undo.`);
          }}
          onReset={(keys) => {
            const undo = !!state.lastApply;
            dispatch({ type: 'resetRatio', keys });
            notify(undo ? 'Ratio reset: cart quantities restored to before the last Set Ratio.' : 'Ratio inputs cleared.');
          }}
          onExport={async (groups) => {
            (await excel()).downloadJson(exportRatioJson(groups, level, levelInputs), `ratio_${levelKey(level).replace(/\W+/g, '_')}.json`);
          }}
          onImport={importJson}
          onClose={() => setRatioOpen(false)}
        />
      )}

      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}

      {dragging && (
        <div className="drag-overlay" aria-hidden="true">
          <div>Drop the catalogue file to {catalogue ? 'replace the current one' : 'upload'}</div>
        </div>
      )}

      <div className="toast-region" role="status" aria-live="polite">{toast && <div className="toast">{toast}</div>}</div>
    </div>
  );
}
