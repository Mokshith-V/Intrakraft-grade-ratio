export const GRADES = ['A', 'B', 'C', 'D'] as const;
export type Grade = (typeof GRADES)[number];

export const isGrade = (v: unknown): v is Grade => typeof v === 'string' && (GRADES as readonly string[]).includes(v);

/** One product = one Style_Code + IK_Colour_Name (a "colourway"). The catalogue has one row per SKU (size). */
export interface Product {
  id: string;
  styleCode: string;
  styleName: string;
  brand: string;
  colour: string;
  colourHex: string;
  mrp: number;
  /** Sizes exactly as they appear in the file's Size_Code column, ordered small → large. */
  sizes: string[];
  /** Groupable attributes (Brick, Category, Neck, Sleeve, …) as read from the file. */
  attrs: Record<string, string>;
  /** Only set when the file itself carries an optional Grade column. */
  fileGrade?: Grade;
}

export interface Catalogue {
  fileName: string;
  loadedAt: string; // ISO timestamp
  rowCount: number;
  products: Product[];
  /** Groupable attribute columns that exist in the file and have at least one value. */
  attributeKeys: string[];
}

export interface CartLine {
  productId: string;
  grade: Grade;
  sets: number;
  /** Ratio quantity per size (one "set"). Line total = sum(qty) × sets. */
  qty: Record<string, number>;
}

/** Raw text typed in the ratio grid: groupKey → grade → size → text. Empty text = size not in the ratio. */
export type RatioInputs = Record<string, Partial<Record<Grade, Record<string, string>>>>;

/** Parsed numeric ratios for one level: groupKey → grade → size → whole number. */
export type RatioTable = Record<string, Partial<Record<Grade, Record<string, number>>>>;

/** The JSON shape from Sample_Ratio_Format.docx. */
export interface RatioJsonEntry {
  title: string;
  attribute_data: { key: string; value: string }[];
  size: { size: string; value: number }[];
  grade: Grade;
}

export type SortKey = 'file' | 'name' | 'code' | 'mrp-asc' | 'mrp-desc' | 'brick';

export interface Filters {
  search: string;
  brick: string;
  neck: string;
  sleeve: string;
  sort: SortKey;
  page: number;
  pageSize: number;
}

export interface LastApply {
  at: string;
  /** Cart quantities just before the last "Set Ratio", so it can be undone with "Reset Ratio". */
  before: Record<string, Record<string, number>>;
}

export interface AppState {
  catalogue: Catalogue | null;
  cart: CartLine[];
  /** levelKey (e.g. "Brick+Neck") → inputs. Kept per level so switching levels never loses typed ratios. */
  ratioInputs: Record<string, RatioInputs>;
  level: string[];
  filters: Filters;
  lastApply: LastApply | null;
}
