import { isGrade, type AppState, type CartLine, type Catalogue, type Filters, type SortKey } from './types';

/**
 * Persistence in localStorage. The catalogue is stored under its own key and only re-written
 * when it changes; the rest (cart, ratios, level, filters) is small and saved on every change.
 * Bump STORAGE_VERSION whenever the stored shape changes — older data is then discarded safely.
 */
export const STORAGE_VERSION = 1;
export const KEYS = {
  catalogue: 'ik-ratio/catalogue',
  state: 'ik-ratio/state',
} as const;

export const DEFAULT_FILTERS: Filters = { search: '', brick: '', neck: '', sleeve: '', sort: 'file', page: 1, pageSize: 25 };

export const emptyState = (): AppState => ({
  catalogue: null,
  cart: [],
  ratioInputs: {},
  level: ['Brick'],
  filters: { ...DEFAULT_FILTERS },
  lastApply: null,
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Envelope<T> {
  version: number;
  data: T;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SORTS: SortKey[] = ['file', 'name', 'code', 'mrp-asc', 'mrp-desc', 'brick'];

function readEnvelope<T>(storage: StorageLike, key: string): { data: T | null; corrupt: boolean } {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { data: null, corrupt: false }; // storage blocked (private mode etc.)
  }
  if (raw === null) return { data: null, corrupt: false };
  try {
    const env = JSON.parse(raw) as Envelope<T>;
    if (!isObj(env) || env.version !== STORAGE_VERSION || !('data' in env)) return { data: null, corrupt: true };
    return { data: env.data, corrupt: false };
  } catch {
    return { data: null, corrupt: true };
  }
}

function validCatalogue(c: unknown): c is Catalogue {
  return isObj(c) && typeof c.fileName === 'string' && Array.isArray(c.products) && Array.isArray(c.attributeKeys) &&
    c.products.every((p) => isObj(p) && typeof p.id === 'string' && Array.isArray(p.sizes) && isObj(p.attrs));
}

function cleanCart(cart: unknown, productIds: Set<string>): CartLine[] {
  if (!Array.isArray(cart)) return [];
  const seen = new Set<string>();
  return cart.filter((l): l is CartLine => {
    if (!isObj(l) || typeof l.productId !== 'string' || !productIds.has(l.productId) || seen.has(l.productId)) return false;
    if (!isGrade(l.grade) || !isObj(l.qty) || !Number.isInteger(l.sets) || (l.sets as number) < 1) return false;
    seen.add(l.productId);
    return Object.values(l.qty).every((q) => Number.isInteger(q) && (q as number) >= 0);
  });
}

export interface LoadResult {
  state: AppState;
  /** Set when stored data existed but couldn't be used, so the UI can tell the user. */
  warning?: string;
}

export function loadState(storage: StorageLike): LoadResult {
  const state = emptyState();
  const cat = readEnvelope<Catalogue>(storage, KEYS.catalogue);
  const rest = readEnvelope<Partial<AppState>>(storage, KEYS.state);
  let warning: string | undefined;

  if (cat.corrupt || (cat.data && !validCatalogue(cat.data))) {
    warning = 'Saved data could not be read (it may be from an older version), so the app started empty.';
    return { state, warning };
  }
  if (cat.data) state.catalogue = cat.data;
  if (rest.corrupt) warning = 'Saved cart and ratios could not be read and were reset. The catalogue was kept.';

  const d = rest.data;
  if (isObj(d)) {
    const ids = new Set(state.catalogue?.products.map((p) => p.id) ?? []);
    state.cart = cleanCart(d.cart, ids);
    if (isObj(d.ratioInputs)) state.ratioInputs = d.ratioInputs as AppState['ratioInputs'];
    if (Array.isArray(d.level) && d.level.length && d.level.every((x) => typeof x === 'string')) state.level = d.level;
    if (isObj(d.filters)) {
      const f = d.filters as Partial<Filters>;
      state.filters = {
        ...DEFAULT_FILTERS,
        ...Object.fromEntries(Object.entries(f).filter(([k, v]) => k in DEFAULT_FILTERS && typeof v === typeof DEFAULT_FILTERS[k as keyof Filters])),
      };
      if (!SORTS.includes(state.filters.sort)) state.filters.sort = 'file';
    }
    if (isObj(d.lastApply) && isObj(d.lastApply.before)) state.lastApply = d.lastApply as AppState['lastApply'];
  }
  return { state, warning };
}

function write(storage: StorageLike, key: string, data: unknown): string | null {
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, data } satisfies Envelope<unknown>));
    return null;
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    return quota ? 'Browser storage is full — changes will be lost on refresh.' : 'Could not save to browser storage.';
  }
}

export function saveCatalogue(storage: StorageLike, catalogue: Catalogue | null): string | null {
  if (!catalogue) {
    try {
      storage.removeItem(KEYS.catalogue);
    } catch {
      /* ignore */
    }
    return null;
  }
  return write(storage, KEYS.catalogue, catalogue);
}

export function saveRest(storage: StorageLike, state: AppState): string | null {
  const { catalogue: _omit, ...rest } = state;
  return write(storage, KEYS.state, rest);
}

export function clearStorage(storage: StorageLike) {
  for (const k of Object.values(KEYS)) {
    try {
      storage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/** localStorage, or null if the browser blocks access to it. */
export function getStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    s.getItem('ik-ratio/probe');
    return s;
  } catch {
    return null;
  }
}
