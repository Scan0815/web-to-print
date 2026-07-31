# Spec: Multi-Decoration Editor

**Status:** Approved for implementation
**Target version:** `0.2.0` (breaking)
**Date:** 2026-07-31

## 1. Problem

An article has **several decoration options** (Veredelungen) — e.g. front pad print,
back pad print, and a wrap-around screen print, each with its own product image,
print area, print method, size in mm, and colour limit. The customer must be able to
design any subset of them in one session; the shop must learn which options were
designed so it can offer exactly those for selection (and pricing) on the article page;
and the print shop must receive all of them in the PDF.

`wtp-editor` currently assumes exactly one decoration: it takes a single `productImage`
and a single `printArea`, and `exportState()` returns one flat `EditorState`. The demo
page narrows an article to `article.views[0]` when opening the editor.

**Key insight:** the domain model already carries the decorations. `Article.views[]` *is*
the list of decoration options. 30 of the 50 articles in `src/examples/demo-article/articles.json`
have 2–4 views. This work lifts the editor from 1 view to N views; it does not introduce
a new concept.

## 2. Scope

**In scope**

- `wtp-editor` — owns the multi-view loop, thumbnail strip, per-view state
- `wtp-logo-upload` — accepts PDF and AI in addition to the current formats
- `src/utils/pdf-export.ts` — multi-decoration proof PDF; demo's inline copy removed
- `src/types/editor.ts` — `ArticleView.id`, `coordinateImageSize`, `maxColours` fix,
  the v2 state envelope
- `src/utils/` — print-area normalization moved in from the demo page
- `src/index.html` — demo becomes a consumer of the library functions
- In-range dependency updates

**Out of scope**

- `wtp-logo-renderer` — stays single-view and unchanged. The catalog card decides which
  view to show; that is the card's job, not the renderer's.
- Server-side PDF generation — sketched in §9 as a follow-up work package
- EPS upload support — requires server-side rendering, follow-up
- `jsPDF` → `pdf-lib` migration — deliberately not in this rebuild (see §9)
- Migrating packages across major versions (see §10)

## 3. Data model

### 3.1 `ArticleView` changes

```ts
export interface ArticleView {
  /** Stable decoration id, supplied by the host (shop decoration id). REQUIRED. */
  id: string;
  image: string;
  label: string;
  printArea: PrintArea | null;
  /** Source resolution the printArea pixel coordinates refer to (see §7). */
  coordinateImageSize?: CoordinateImageSize;
  /** Marks the decoration pre-selected when the editor opens. Falls back to views[0]. */
  isDefault?: boolean;
  impMethod?: string;
  impLocation?: string;
  impWidthMm?: number;
  impHeightMm?: number;
  impDiameterMm?: number;
  /** Number of printable colours, or 'full color' for digital/sublimation printing. */
  maxColours?: number | 'full color';
}

export interface CoordinateImageSize {
  width: number | null;
  height: number | null;
  longestSide: 'width' | 'height';
}
```

**`id` is mandatory.** Positional identity breaks the moment the supplier feed reorders,
adds, or removes a view — and the failure is silent: the shop charges for and prints the
wrong decoration position. The editor throws on a view without an `id`.

`maxColours` is currently typed `number` but the catalog contains the string
`'full color'` (h2o-active Tempo, both Stanley bottles, Mepal Ellipse, Moleskine,
Remy). The type is corrected as part of this work.

`src/examples/demo-article/articles.json` gets an `id` per view.

### 3.2 Per-logo source separation

A logo now carries two distinct things: what the customer uploaded (goes to the print
shop) and what the canvas displays. For PDF/AI uploads these are necessarily different
files, and even for SVG they differ once the editor rasterizes.

```ts
export interface LogoSource {
  /** Original uploaded file, unmodified. */
  dataUrl: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
}

export interface PlacedLogo {
  id: string;
  /** Canvas representation — always a browser-renderable raster/SVG data URL. */
  dataUrl: string;
  previewDataUrl?: string;
  /** The uploaded original. Absent for logos placed before 0.2.0. */
  source?: LogoSource;
  transform?: CanvasTransform;
}
```

Without this split, "what did the customer upload" becomes unrecoverable from "what did
the editor make of it" — and the print shop needs the former.

### 3.3 The v2 state envelope

```ts
export interface DecorationState {
  /** ArticleView.id */
  viewId: string;
  label: string;
  impMethod?: string;
  impLocation?: string;
  impWidthMm?: number;
  impHeightMm?: number;
  maxColours?: number | 'full color';
  /** 'designed' iff the canvas holds >= 1 logo or text object. Mechanical, not heuristic. */
  status: 'empty' | 'designed';
  /** The per-view canvas state — the existing single-view shape, unchanged. */
  state: EditorState;
  /** Downscaled preview (~320px longest side) for shop thumbnails. */
  previewDataUrl?: string;
  /** Non-blocking validation findings (see §5). */
  issues: LogoValidationIssue[];
}

export interface ArticleEditorState {
  version: 2;
  articleId: string;
  decorations: DecorationState[];
}
```

**All views are returned, each with a `status`** — not only the designed ones. The shop
needs to know which options exist but were left empty in order to render the selection
list.

**There is deliberately no `selected` flag.** Whether a decoration is ordered is a
pricing decision and belongs on the article page next to the surcharge, not in the
editor. Two places defining "selected" would diverge.

`version` is not for migration convenience; it exists because this payload will be
persisted in a cart and later in an order, and a cart from today must still render in
two years.

### 3.4 Persistence

Consumer-side: IndexedDB now, server later. Two notes carried into implementation:

- Previews are downscaled (~320px longest side). At 4 views with full-resolution
  data URLs the payload reaches several MB.
- IndexedDB stores `Blob` natively, which avoids the ~33% base64 overhead of data URLs.
  **Open, not decided:** whether the export uses `Blob` instead of data URLs. Data URLs
  are the default for 0.2.0; a `Blob`-based variant can be added without a version bump
  since it only affects the consumer's storage layer.

## 4. `wtp-editor` API

### 4.1 Props

| Prop | Type | Note |
|---|---|---|
| `views` | `ArticleView[]` | **new**, required |
| `articleId` | `string` | **new**, required — written into the envelope |
| `activeViewId` | `string \| undefined` | **new**, controlled switching; defaults to `isDefault` view, else `views[0]` |
| `showViewStrip` | `boolean` | **new**, default `true` — set `false` to build your own switcher |
| `initialLogo` | `LogoData \| undefined` | **new** — placed into the default view only (§8) |
| `productImage` | — | **removed**, derived from the active view |
| `printArea` | — | **removed**, derived from the active view |
| `width`, `height`, `fonts`, `debug`, `labels`, `initialState` | unchanged | |

### 4.2 Events

| Event | Payload | Note |
|---|---|---|
| `wtpEditorStateChanged` | `ArticleEditorState` | **changed** — was `EditorState` |
| `wtpEditorViewChanged` | `{ viewId: string; index: number }` | **new** |
| `wtpEditorReady`, `wtpEditorObjectSelected`, `wtpEditorObjectDeselected` | unchanged | |

### 4.3 Methods

| Method | Change |
|---|---|
| `exportState()` | returns `ArticleEditorState` (was `EditorState`) |
| `loadState(state)` | accepts `ArticleEditorState` **or** legacy `EditorState` (§4.4) |
| `setActiveView(viewId)` | **new** |
| `applyLogoToAllViews(logoId)` | **new** — §5.3 |
| `exportViewImage(viewId, format?, quality?)` | **new** — per-view render |
| `exportImage()`, `exportImageHighRes()` | operate on the **active** view (unchanged semantics) |
| `addLogo()`, `addText()`, `removeObject()`, `updateText()`, `getObjects()`, `resetCanvas()` | operate on the **active** view (unchanged semantics) |

### 4.4 Migration v1 → v2

`loadState()` detects the shape: an object without `version` is a v1 `EditorState`. It
is loaded into the **default view**, all other views start empty. This is a read-only
fallback — the editor always writes v2. Roughly ten lines; it rescues everything already
persisted.

### 4.5 Canvas strategy

**One** Fabric `Canvas` instance for all views. On switching:

1. Serialize the outgoing view (`toJSON()` → its `EditorState`), render its thumbnail
2. Swap background image and print-area overlay to the incoming view
3. Restore the incoming view's `EditorState`, or start empty

N simultaneous canvases were rejected: Fabric canvases are expensive to instantiate,
and articles with 4 views are common (umbrellas, notebooks).

**Invariant:** because state is serialized on view *exit*, `exportState()` must flush the
**active** view into its `DecorationState` before building the envelope — otherwise the
view the customer is currently working on is silently missing and reports
`status: 'empty'`. The same flush applies before rendering that view's thumbnail.

Thumbnails are rendered **only on view exit**, not on every object change, and at ~120px.
`toDataURL()` on a 2400px product image is not free.

## 5. Validation

Per decoration, non-blocking. Collected into `DecorationState.issues`.

| Check | Source | Severity |
|---|---|---|
| Logo DPI below threshold | existing `logo-validation` | warning |
| Placed logo exceeds `impWidthMm` / `impHeightMm` | print area geometry | warning |
| Logo extends beyond the print area | canvas bounds vs. print area | warning |
| Colour count above `maxColours` | colour estimation, skipped for `'full color'` | warning |

**Nothing blocks.** Determining the colour count of an arbitrary customer logo for screen
printing or laser engraving is unreliable; a hard block on an unreliable measurement
prevents legitimate orders. The shop decides whether a warning stops checkout.

### 5.3 Apply to all views

`applyLogoToAllViews(logoId)` places the logo into every **empty** view, centred in that
view's print area and scaled to its mm dimensions. Without it, a 4-segment umbrella
requires the customer to assemble the same thing four times. Views that already hold
objects are left untouched.

## 6. PDF export

### 6.1 One implementation

`src/index.html:680` contains a second, inline `generatePdf()` that the demo actually
calls, parallel to `src/utils/pdf-export.ts`. **The inline copy is deleted**; the demo
calls the library function. Building multi-decoration into both guarantees two truths
about the print document.

### 6.2 The PDF is a proof, not print data

Stated explicitly in the document header and in the README. A browser-generated RGB PDF
without bleed, crop marks, or spot colours will never pass as print data — `maxColours`
exists in the data precisely because screen printing needs spot colours. Print-ready
output is §9.

### 6.3 Structure

1. **Logo source pages**, one per *distinct* logo, deduplicated by a hash of the source
   data URL. Same logo on four decorations → one page. Two different logos → two pages.
   Embedded losslessly (PNG, no JPEG recompression, never downscaled below the original
   resolution) because the print shop extracts the logo from the PDF.
2. **One page per designed decoration**: product mockup with print-area guide, plus
   method, location, `impWidthMm × impHeightMm`, `maxColours`, validation warnings, and a
   reference to its logo source page ("Logo source: page 2").

Only `status: 'designed'` decorations are included. The caller may further restrict to a
subset of `viewId`s, so the shop can print exactly the positions that were ordered.

### 6.4 New signature

```ts
export async function exportArticlePdf(
  state: ArticleEditorState,
  article: Article,
  mockups: Record<string /* viewId */, { dataUrl: string; width: number; height: number }>,
  config?: Partial<PdfExportConfig>,
): Promise<void>;
```

`exportProductPdf()` is kept as a thin wrapper over the new function for one decoration,
so existing integrations keep working.

### 6.5 SVG limitation

`jsPDF` embeds only PNG/JPEG, so SVG sources are rasterized at 4000px
(existing `rasterizeDataUrl`). The logo source page carries a visible note: *"Source was
SVG, rasterized at 4000px — request the vector source from the customer."*

`svg2pdf.js` was considered and rejected as a default: it covers a subset of SVG, and its
worst failure mode is silent — `<text>` without an embedded font falls back to Helvetica,
so the logo is *precisely wrong* and gets printed. A raster is imprecise but honest. A
`vectorSvg` opt-in flag may be added later, gated on a raster fallback whenever the SVG
contains text without embedded fonts.

PDF file attachments (embedding the original SVG/AI inside the PDF) were also considered:
**`jsPDF` cannot do it** — verified, there is no `EmbeddedFile`/`Filespec` support in the
build; `addFileToVFS` is only the virtual font filesystem. It would require `pdf-lib`,
which is out of scope here (§9).

## 7. Print-area normalization moves into the library

`PrintArea` is defined in 0–1 relative coordinates, but the catalog delivers pixel
coordinates plus `coordinateImageSize`. The conversion currently lives in the demo page
(`normalizeArticles()`, `src/index.html:381`), including loading image dimensions when
`height` is `null`.

Moved to `src/utils/print-area.ts` and exported:

```ts
export function isPixelPrintArea(area: PrintArea): boolean;   // any coordinate > 1
export function normalizePrintArea(area: PrintArea, imageWidth: number, imageHeight: number): PrintArea;
export async function resolveViewPrintArea(view: ArticleView): Promise<PrintArea | null>;
```

`wtp-editor` calls this itself during init. Rationale: it is the same conversion for every
consumer, and the shop is about to become the second one; the editor loads the product
image anyway, so it knows the dimensions first (today the host loads the image a second
time); and the error scales with N — four views, four chances for the host to forget, and
the symptom is a print area silently sitting in the wrong place, first noticed by the
print shop.

## 8. `wtp-logo-upload` changes

### 8.1 New formats

`pdf` and `ai` are added to `LogoFormat` and to the default `allowedFormats`. Both are
rendered to a canvas raster via `pdfjs-dist` — modern `.ai` files are PDFs with PDF
compatibility enabled and render through the same path. A `.ai` file without PDF
compatibility fails with an explicit message ("This AI file was saved without PDF
compatibility. Please re-save with PDF compatibility or upload a PDF.").

EPS is **not** accepted — it is not renderable in the browser and would need Ghostscript
server-side. It arrives with §9.

The uploaded original is preserved as `LogoSource` and travels through the editor into
the export envelope untouched (§3.2). This is what actually rescues vector quality today:
the print shop gets the original file, regardless of what the proof PDF can embed.

### 8.2 Entry flow

Product overview: customer uploads a logo, `wtp-logo-renderer` shows it on the catalog
cards. Detail page: `wtp-editor` opens with `initialLogo` set to that logo.

The logo is placed **only in the default decoration** (`isDefault`, else `views[0]`).
Auto-placing it in all views is tempting but wrong: `status: 'designed'` is the shop's
ordering basis, so a customer who does not notice would order — and pay for — four
decorations. Defaults that cost money are not acceptable. Extending to further
decorations is one visible click (§5.3), which is what the thumbnail strip is for.

## 9. Follow-up work package: server-side print PDF

Not part of this rebuild; recorded so the proof PDF is not mistaken for the destination.

Real web-to-print systems generate print PDFs server-side. Headless Chromium
`print-to-PDF` renders SVG natively as vector and embeds fonts — exactly the two things
`svg2pdf.js` fails at. Combined with Fabric's `canvas.toSVG()` (present in the v7 bundle;
typings need checking) the mockup pages become vector as well instead of raster.

That path is also the only one that can ever reach CMYK, spot colours, bleed, and crop
marks. `pdf-lib` is the intermediate option if attachments or 1:1 embedding of an
uploaded PDF/AI page become required before a backend exists.

Sequencing rationale: swapping the PDF library and rebuilding the editor architecture at
the same time means two suspects for every bug.

## 10. Dependencies

**In-range updates only** (`npm update`):

| Package | 0.1.4 | after |
|---|---|---|
| `@stencil/core` | 4.43.4 | 4.43.5 |
| `@stencil/sass` | 3.2.3 | 3.3.2 |
| `@stencil/eslint-plugin` | 1.3.0 | 1.4.0 |
| `exifreader` | 4.39.1 | 4.41.3 |
| `@types/node` | 22.19.19 | 22.20.1 |

**New devDependencies, required by the update:** `@stencil/eslint-plugin` 1.4.0 moved
`@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, and `eslint-plugin-react`
from `dependencies` to `peerDependencies`. `eslint.config.js` imports the parser directly,
so after `npm update` lint fails with `ERR_MODULE_NOT_FOUND` until they are declared:

```
npm i -D @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 eslint-plugin-react@^7.37.4
```

Plugin 1.4.0 also newly enforces `stencil/element-type`, which flagged the `@Element()`
declarations in `wtp-editor`, `wtp-logo-renderer`, and `wtp-print-area-editor`
(`HTMLElement` → `HTMLWtpEditorElement` etc.). Autofixed via `eslint --fix`. The
pre-existing `stencil/strict-mutable` error on `wtp-logo-renderer`'s `printArea` prop is
**left as is** — it is a behavioural change, not a lint cleanup.

Stencil 4.43.5 regenerates `src/components.d.ts` and `wtp-logo-upload/readme.md` with
inlined default values; cosmetic.

**New for implementation:** `pdfjs-dist` (PDF/AI rendering).

**Held back deliberately:**

- **Jest 30 / `@types/jest` 30 — impossible.** `@stencil/core` 4.43 ships jest adapters
  for `jest-27-and-under`, `jest-28`, and `jest-29` only
  (`node_modules/@stencil/core/testing/jest/`). There is no jest 30 adapter; upgrading
  breaks `npm test`.
- **ESLint 10, Puppeteer 25** — feasible, but a separate commit. Puppeteer drives the e2e
  tests, which are the only coverage the Fabric canvas logic has (JSDOM has no canvas
  context). Bumping it inside this rebuild means a red e2e test has two possible causes.

## 11. Test plan

**Spec tests (`*.spec.ts`)**

- `print-area.spec.ts` — pixel detection, normalization with `longestSide` width/height,
  `null` height, already-relative input passed through unchanged
- `article-state.spec.ts` — v2 envelope round-trip; v1 → v2 migration into the default
  view; `status` derivation (empty canvas → `empty`, one text → `designed`)
- `pdf-export.spec.ts` — logo deduplication by hash, page count for 1 logo / 2 logos /
  N decorations, `designed`-only filter, `viewId` subset filter
- `logo-validation.spec.ts` — `maxColours: 'full color'` skips the colour check; mm
  overflow produces a warning, never an error
- `wtp-editor.spec.ts` — throws on a view without `id`; `activeViewId` prop selects the
  view; default view selection honours `isDefault`

**E2E tests (`*.e2e.ts`)**

- switching views preserves each view's objects (place logo in view 1, switch to view 2,
  place text, switch back — logo still there, text not)
- `applyLogoToAllViews` populates empty views only
- `exportState()` returns every view with the correct `status`
- thumbnail strip reflects designed state after a switch
- `initialLogo` lands in the default view and nowhere else
- `exportState()` **without** a preceding view switch reports the active view as
  `designed` (the flush invariant of §4.5)

Canvas behaviour stays in e2e — JSDOM has no canvas context. Existing JSDOM workarounds
(`setLineDash`/`getLineDash`/`strokeRect` mocks) still apply.

## 12. Work packages

In implementation order; each ends green.

1. **Types + normalization** — `ArticleView.id`, `coordinateImageSize`, `maxColours` fix,
   `LogoSource`, `ArticleEditorState`; `src/utils/print-area.ts` moved out of the demo,
   with tests. Demo `articles.json` gets view ids.
2. **Editor multi-view core** — `views`/`articleId`/`activeViewId` props, single-canvas
   view switching, per-view state, v2 export, v1 read fallback. No UI yet.
3. **Thumbnail strip** — `showViewStrip`, `wtpEditorViewChanged`, previews on exit.
4. **Validation per decoration** — `issues` on `DecorationState`.
5. **Apply to all views** — `applyLogoToAllViews` + toolbar action.
6. **PDF rebuild** — `exportArticlePdf`, logo deduplication, per-decoration pages,
   proof labelling; delete the inline copy in `index.html` and rewire the demo.
7. **PDF/AI upload** — `pdfjs-dist`, `LogoSource` passthrough, error handling for
   non-PDF-compatible AI.
8. **Dependency update** — in-range only, verify `npm test`.
9. **Docs + release** — component readmes (auto-generated), migration note in the README,
   version `0.2.0`.

## 13. Open questions

1. **Decoration id in the shop payload.** The b2c shop is a Stencil SPA and every path
   returns the shell; `api.experimental.connect-shop.net` answers with JSON 404s on
   `/articles/:id`, `/api/articles/:id`, `/docs-json`, `/api-json`; the MongoDB route was
   blocked by the permission classifier. Needed from a real article payload: **what the
   decoration id is called, whether it is globally unique or unique per article, and
   whether a default flag exists.** Until then the spec assumes host-supplied `id` and
   optional `isDefault`.
2. **`Blob` vs. data URLs** in the export payload for IndexedDB (§3.4) — recommendation
   recorded, decision deferred, no version impact.
