import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { addToCart } from './lib/cart';
import { levelKey } from './lib/ratio';
import { clearStorage, DEFAULT_FILTERS, emptyState, getStorage, loadState, saveCatalogue, saveRest } from './lib/storage';
import type { AppState, CartLine, Catalogue, Filters, Grade, Product, RatioInputs } from './lib/types';

export type Action =
  | { type: 'loadCatalogue'; catalogue: Catalogue }
  | { type: 'addProducts'; products: Product[]; grade: Grade }
  | { type: 'removeLines'; ids: string[] }
  | { type: 'setGrade'; ids: string[]; grade: Grade }
  | { type: 'setSets'; id: string; sets: number }
  | { type: 'setQty'; id: string; size: string; qty: number }
  | { type: 'setLevel'; level: string[] }
  | { type: 'setRatioRow'; key: string; grade: Grade; row: Record<string, string> }
  | { type: 'applyRatio'; cart: CartLine[] }
  | { type: 'resetRatio'; keys: string[] }
  | { type: 'importRatios'; byLevel: Record<string, RatioInputs>; level: string[] }
  | { type: 'setFilters'; filters: Partial<Filters> }
  | { type: 'clearAll' };

const mapLines = (cart: CartLine[], ids: string[], fn: (l: CartLine) => CartLine) => {
  const set = new Set(ids);
  return cart.map((l) => (set.has(l.productId) ? fn(l) : l));
};

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'loadCatalogue':
      // A new file empties the cart (products may no longer exist). Typed ratios are kept, since
      // they are keyed by attribute values (e.g. Brick = Shirts) rather than by product.
      return { ...state, catalogue: a.catalogue, cart: [], lastApply: null, filters: { ...DEFAULT_FILTERS, pageSize: state.filters.pageSize } };
    case 'addProducts':
      return { ...state, cart: addToCart(state.cart, a.products, a.grade).cart };
    case 'removeLines': {
      const ids = new Set(a.ids);
      return { ...state, cart: state.cart.filter((l) => !ids.has(l.productId)) };
    }
    case 'setGrade':
      return { ...state, cart: mapLines(state.cart, a.ids, (l) => ({ ...l, grade: a.grade })) };
    case 'setSets':
      return { ...state, cart: mapLines(state.cart, [a.id], (l) => ({ ...l, sets: a.sets })) };
    case 'setQty':
      return { ...state, cart: mapLines(state.cart, [a.id], (l) => ({ ...l, qty: { ...l.qty, [a.size]: a.qty } })) };
    case 'setLevel':
      return { ...state, level: a.level };
    case 'setRatioRow': {
      const lk = levelKey(state.level);
      const lvl = state.ratioInputs[lk] ?? {};
      return {
        ...state,
        ratioInputs: { ...state.ratioInputs, [lk]: { ...lvl, [a.key]: { ...lvl[a.key], [a.grade]: a.row } } },
      };
    }
    case 'applyRatio': {
      const before = Object.fromEntries(state.cart.map((l) => [l.productId, l.qty]));
      return { ...state, cart: a.cart, lastApply: { at: new Date().toISOString(), before } };
    }
    case 'resetRatio': {
      // Undo the last "Set Ratio" (restore earlier quantities) and clear the typed ratios shown.
      const before = state.lastApply?.before;
      const cart = before ? state.cart.map((l) => (before[l.productId] ? { ...l, qty: { ...before[l.productId] } } : l)) : state.cart;
      const lk = levelKey(state.level);
      const lvl = { ...state.ratioInputs[lk] };
      a.keys.forEach((k) => delete lvl[k]);
      return { ...state, cart, lastApply: null, ratioInputs: { ...state.ratioInputs, [lk]: lvl } };
    }
    case 'importRatios': {
      const ratioInputs = { ...state.ratioInputs };
      for (const [lk, groups] of Object.entries(a.byLevel)) {
        const merged = { ...ratioInputs[lk] };
        for (const [k, grades] of Object.entries(groups)) merged[k] = { ...merged[k], ...grades };
        ratioInputs[lk] = merged;
      }
      return { ...state, ratioInputs, level: a.level };
    }
    case 'setFilters':
      return { ...state, filters: { ...state.filters, ...a.filters } };
    case 'clearAll':
      return emptyState();
  }
}

/** App store backed by localStorage. Returns state, dispatch, a storage warning and the load notice. */
export function useAppStore() {
  const storage = useMemo(getStorage, []);
  const initial = useMemo(() => (storage ? loadState(storage) : { state: emptyState(), warning: undefined }), [storage]);
  const [state, dispatch] = useReducer(reducer, initial.state);
  const [saveError, setSaveError] = useState<string | null>(
    storage ? null : 'Browser storage is unavailable — your work will not survive a refresh.',
  );
  const lastCatalogue = useRef<Catalogue | null>(initial.state.catalogue);

  useEffect(() => {
    if (!storage) return;
    let err: string | null = null;
    if (state.catalogue !== lastCatalogue.current) {
      err = saveCatalogue(storage, state.catalogue);
      lastCatalogue.current = state.catalogue;
    }
    err = saveRest(storage, state) ?? err;
    setSaveError(err);
  }, [state, storage]);

  const clearAll = () => {
    if (storage) clearStorage(storage);
    lastCatalogue.current = null;
    dispatch({ type: 'clearAll' });
  };

  return { state, dispatch, saveError, loadWarning: initial.warning, clearAll };
}
