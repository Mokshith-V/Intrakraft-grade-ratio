# Intrakraft · Catalogue Upload, Cart & Grade-wise Ratio

A small, backend-free web app for the Intrakraft (iROMP) assignment. A retailer uploads a catalogue Excel file, picks products into a **Cart**, gives each cart line a **Grade** (A/B/C/D), and enters a **size-wise ratio per Grade** at a chosen attribute level (Brick, Category, Brick + Neck, Brick + Sleeve or any combination). The ratio then fills in the size quantities for every matching cart line, so nobody types sizes product by product.

## The problem it solves

When buying for many stores, ordering every size of every colourway by hand is slow and error-prone. Buyers think in **ratios**: "for our A-grade stores, Shirts go S:M:L = 1:2:1". This app captures exactly that:

- The ratio is kept **per Grade**, so A, B and C stores can have different size curves.
- It is kept **per attribute group**, so Shirts and Trousers (or Round Neck vs Polo Neck T-shirts) can differ.
- **Sizes always come from the uploaded file.** Shirts with XS–3XL, or kidswear with 4-5Y…13-14Y, work the same way. Nothing assumes S/M/L.

## Features

| Area | What you get |
|---|---|
| **Upload** | Click or drag-and-drop `.xlsx` anywhere on the page. Required columns (`Style_Code`, `Style_Name`, `IK_Colour_Name`, `Size_Code`, `MRP`, `Brick`) are checked, and any that are missing are listed by name. "Use sample catalogue" loads the bundled sample file. Shows `Loaded: sample_catalogue_file.xlsx · 77 products · 403 rows · <time>`. |
| **Persistence** | Catalogue, cart (grade, sets, size quantities), all typed ratios (per level), the selected level and the catalogue filters are saved in `localStorage` and restored on refresh. Every read/write is wrapped in `try/catch`, and data is stored with a version number. Corrupt or old data falls back to an empty state and shows a message. |
| **Catalogue** | Search, Brick/Neck/Sleeve filters, sort (file order, name, code, brick, MRP ↑/↓), pagination (10/25/50/100), "x of y shown" and a selected-count indicator. Products already in the cart are marked **In cart** and can't be selected again. |
| **Cart** | Grade per line, size boxes for that product's own sizes, × Sets = total, a per-line summary (pcs/set × sets, MRP value), and bulk actions (select all, set Grade for selected, remove selected). The **Summary** panel shows Total Colourways, Total Quantity, Total MRP Value and lines per Grade. **Export .xlsx** gives style, colour, brick, grade, size-wise qty, sets, total and MRP value. |
| **Input Ratio** | Level presets plus any custom attribute combination. Groups show only the Grades present in the cart, with a warning for any Grade that has products but no ratio. Per row: live readout (`S:M:L = 1:2:1`), **Copy from Grade A**, **Fill all with 1** and **Clear**. Validation: whole numbers ≥ 0 only, with invalid cells highlighted and *Set Ratio* disabled until they are fixed. All-zero rows are flagged and skipped. A **preview** lists every cart line and its resulting quantities before applying, with notes when a product size is missing from the ratio (it gets 0) or a ratio size doesn't exist for that product. |
| **Undo** | **Reset Ratio** restores the cart quantities from before the last *Set Ratio* and clears the ratios shown. |
| **JSON** | **Export JSON** writes the exact `Sample_Ratio_Format.docx` shape. **Import JSON** reads the same shape back, including the sample file itself. Invalid entries are skipped and the reason is shown. |
| **Housekeeping** | **Replace catalogue** warns that it empties the cart. **Clear all data** asks for confirmation. |
| **UI/UX** | Step tracker (Upload → Select → Cart + Grades → Set ratio), contextual help, loading and empty states, keyboard-accessible controls with visible focus, dialogs with Esc/focus trap, and a single-column layout on mobile. Uses Intrakraft styling: navy header, red primary buttons. |

## How the Grade-wise ratio works

### Data model

```ts
Product   { id: "Style_Code|IK_Colour_Name", styleCode, styleName, colour, mrp,
            sizes: string[],               // from Size_Code rows in the file, ordered small → large
            attrs: { Brick, Category, Neck, Sleeve, … } }

CartLine  { productId, grade: 'A'|'B'|'C'|'D', sets: number,
            qty: { [size]: number } }      // quantity per set

ratioInputs[levelKey][groupKey][grade][size] = "2"
            // levelKey = "Brick+Neck", groupKey = "T-Shirts | Round Neck"
```

- **One product = one colourway** (Style_Code + IK_Colour_Name). The catalogue has one row per SKU (one per size), and the parser groups those rows into products. A product's sizes are exactly the `Size_Code` values in its rows.
- **Grade is chosen per cart line.** The sample catalogue has no Grade column, so you pick a Grade when adding (or change it later on each line or in bulk). *If* a future file includes a `Grade` column, it is used as the starting grade. The app never adds a Grade column to the catalogue.
- **Ratios are stored per level.** Switching from *Brick* to *Brick + Neck* and back doesn't lose anything you typed.

### Algorithm (`src/lib/ratio.ts`)

1. **`groupKey(product, level)`** joins the product's values for the chosen attributes, e.g. `["Brick","Neck"] → "T-Shirts | Round Neck"`. Blank values become `(blank)`.
2. **`groupCart(cart, products, level)`** buckets cart lines by that key. Each group shows the union of its products' sizes and only the Grades that occur in the group.
3. The user types one row per **group × Grade**. `checkRow` validates each row: whole numbers ≥ 0, with all-zero rows flagged.
4. **`applyRatio(cart, products, table, level)`**: for each cart line, look up `table[groupKey(line)][line.grade]`.
   - If found, set `qty[size] = ratio[size] ?? 0` for **each of the product's own sizes**. Sizes missing from the ratio get 0 and are reported, and ratio sizes the product doesn't come in are ignored and reported.
   - If not found (no ratio or an all-zero row), leave the line unchanged.
   - The function is pure and returns a new cart plus a per-line report, which drives the preview.
5. Line total = `sum(qty) × sets`. MRP value = total × MRP.

**Worked example (from the assignment):** five shirts, Grades A, A, B, B, C. Level = Brick, with ratios A = 1:2:1, B = 2:2:1 and C = 1:1:2. The A lines get S1 M2 L1 (= 4), the B lines S2 M2 L1 (= 5) and the C line S1 M1 L2 (= 4). The sample shirts also come in XL and XXL, so those are set to 0, and the preview notes it.

### JSON format

Matches `docs/Sample Ratio Format.docx`: one entry per group × Grade in the cart, with sizes in the group's order and empty sizes exported as 0.

```json
[{ "title": "Shirts",
   "attribute_data": [{ "key": "Brick", "value": "Shirts" }],
   "size": [{ "size": "S", "value": 1 }, { "size": "M", "value": 2 }, { "size": "L", "value": 1 }],
   "grade": "A" }]
```

For multi-attribute levels, `attribute_data` has one `{key, value}` per attribute (in level order) and `title` joins the values with ` - ` (e.g. `"T-Shirts - Round Neck"`).

## Project structure

```
src/
  lib/                 pure, framework-free logic (unit-tested)
    types.ts           data model
    catalogue.ts       parseCatalogue, findMissingColumns, sortSizes
    ratio.ts           groupKey, groupCart, checkCell/checkRow, applyRatio, exportRatioJson, importRatioJson
    cart.ts            addToCart (duplicate-safe), totals, xlsx export rows
    storage.ts         versioned localStorage load/save with safe fallback
    excel.ts           SheetJS read/write (lazy-loaded so the first page load stays small)
    logic.test.ts      Vitest unit tests
  state.ts             reducer + persistence hook
  components/          CatalogueView, CartView, RatioModal, Dialog, UploadZone, Steps, NumberCell
  App.tsx, main.tsx, styles.css
public/sample_catalogue_file.xlsx   bundled sample for the "Use sample catalogue" button
docs/                               assignment brief and ratio format reference
legacy/index.html                   the earlier single-file version, kept for reference
```

## Setup & run

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

## Deploy to Vercel

There is no backend, so it deploys as a static site.

1. Push the project to GitHub, GitLab or Bitbucket.
2. In Vercel: **Add New → Project**, then import the repo. The Vite preset is detected (and `vercel.json` sets it explicitly): build command `npm run build`, output directory `dist`.
3. Click **Deploy**.

Or from the command line: `npm i -g vercel && vercel --prod`.

## Tests

`npm test` runs 28 unit tests in `src/lib/logic.test.ts`, covering:

- Grouping SKU rows into products, and parsing the real sample file (403 rows → 77 products).
- Sizes coming from the file: a product with XS…3XL, size ordering for letter, numeric and age sizes, and no invented sizes.
- Missing-column errors.
- Grade-wise ratio application (assignment example A/B/C), 0 for sizes missing from the ratio, lines left unchanged without a ratio.
- Brick + Neck grouping.
- The JSON export shape, multi-attribute export, import round-trip and importing the sample format.
- Duplicate-safe add to cart, and cart totals.
- Persistence round-trip and fallbacks for corrupt, old-version or throwing storage.

The full browser flow was also run against the real sample file in Microsoft Edge (scripted with Playwright, not committed):

1. Upload the file.
2. Add Shirts as Grades A, A, B, B, C (and a T-shirt as C).
3. Set A = 1:2:1, B = 2:2:1, C = 1:1:2, then Set Ratio.
4. Refresh. Cart, grades, quantities, totals, ratios and the file label are all restored.

## Known limitations

- **Storage is per browser and per device.** Data lives in `localStorage` (about 5 MB). The sample catalogue uses well under 100 KB, but a very large catalogue (tens of thousands of SKUs) could hit the quota. The app then shows "Browser storage is full" instead of failing silently. Moving the catalogue to IndexedDB would remove that limit.
- **Only the first sheet is read**, and the first row must hold the headers.
- **MRP is taken per colourway** from its first row. If MRP differs by size within a colourway, the first value is used.
- **Ratios are matched by attribute value text.** After *Replace catalogue*, a saved ratio for "Shirts" applies again only if the new file also says "Shirts" (exact text after trimming).
- **"Total MRP Value" is quantity × MRP.** Cost, discount and tax (shown in the iROMP screenshot) aren't in the sample file, so they are not calculated.
- **Product images aren't shown**, because the catalogue has no image column. A colour swatch from `IK_Colour_Code` is used instead.
- Grades are fixed to A–D, as in the reference screenshots.
