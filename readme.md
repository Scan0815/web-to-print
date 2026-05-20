# web-to-print

A Stencil.js Web Components library for promotional product customization. Upload logos, preview them on products, and edit layouts — all client-side, no server required.

## Components

| Component | Description | Encapsulation |
|---|---|---|
| `<wtp-logo-upload>` | Logo upload with drag-and-drop, URL fetch, format detection, print validation, and optional background removal | Shadow DOM |
| `<wtp-logo-renderer>` | Static logo-on-product rendering via Fabric.js StaticCanvas | Scoped |
| `<wtp-editor>` | Interactive canvas editor with toolbar, text tool, and JSON serialization via Fabric.js | Scoped |

Components communicate via CustomEvents and can be used standalone or composed together.

## Installation

```bash
npm install web-to-print
```

### Lazy-loading (recommended)

```html
<script type="module" src="web-to-print/loader/index.js"></script>
```

Or with a bundler:

```js
import { defineCustomElements } from 'web-to-print/loader';
defineCustomElements();
```

### Standalone custom elements

```js
import 'web-to-print/wtp-logo-upload';
import 'web-to-print/wtp-editor';
import 'web-to-print/wtp-logo-renderer';
```

## Quick Start

```html
<!-- 1. Upload a logo -->
<wtp-logo-upload id="uploader"></wtp-logo-upload>

<!-- 2. Render it on a product -->
<wtp-logo-renderer id="renderer" width="400" height="300"></wtp-logo-renderer>

<!-- 3. Open an interactive editor -->
<wtp-editor id="editor" width="800" height="600"></wtp-editor>

<script>
  const uploader = document.getElementById('uploader');
  const renderer = document.getElementById('renderer');
  const editor = document.getElementById('editor');

  uploader.addEventListener('wtpLogoValidated', async (e) => {
    const logo = e.detail;

    // Place logo on the static renderer
    renderer.logos = [{
      id: 'logo-1',
      dataUrl: logo.dataUrl,
      transform: { x: 200, y: 150, scaleX: 0.5, scaleY: 0.5, angle: 0 },
    }];

    // Or add it to the interactive editor
    await editor.addLogo(logo);
  });
</script>
```

## Component API

### `<wtp-logo-upload>`

Validates uploaded files against configurable print-quality rules (format, DPI, dimensions, file size). Supports file picker, drag-and-drop, and URL fetch.

#### Properties

| Property | Attribute | Type | Default | Description |
|---|---|---|---|---|
| `config` | — | `LogoValidationConfig` | See below | Validation rules for uploaded logos |
| `accept` | `accept` | `string` | `'image/png,image/jpeg,image/svg+xml,image/tiff,image/avif,application/pdf'` | Accepted MIME types for file input |
| `multiple` | `multiple` | `boolean` | `false` | Allow multiple file uploads |
| `disabled` | `disabled` | `boolean` | `false` | Disable the upload component |
| `enableBackgroundRemoval` | `enable-background-removal` | `boolean` | `false` | Enable client-side background removal for raster images |
| `bgRemovalConfig` | — | `Partial<BgRemovalConfig>` | `{}` | Configuration for the color-based background removal algorithm |
| `labels` | — | `Partial<LogoUploadLabels>` | `{}` | Override user-facing strings (see [Localizing text](#localizing-text-labels-prop)) |

**Default validation config:**

```js
{
  minDpi: 300,
  maxFileSize: 50 * 1024 * 1024, // 50 MB
  minWidth: 100,
  minHeight: 100,
  allowedFormats: ['png', 'jpeg', 'svg', 'pdf', 'tiff', 'avif'],
}
```

#### Events

| Event | Detail | Description |
|---|---|---|
| `wtpLogoValidated` | `LogoData` | Fires when a logo passes validation |
| `wtpLogoRejected` | `{ file: File; issues: LogoValidationIssue[] }` | Fires when a logo fails validation |
| `wtpLogoProcessing` | `boolean` | Fires when processing state changes (`true` = busy) |

#### Background Removal

When `enable-background-removal` is set and a raster image (PNG, JPEG, TIFF, AVIF) is uploaded, the user is presented with a choice between the original image and a version with the background removed. SVG and PDF files skip this step entirely.

The background removal runs entirely client-side using a color-based flood-fill algorithm with zero external dependencies:

1. Samples all pixels along the 4 edges of the image
2. Finds the dominant edge color (quantized into buckets)
3. BFS flood-fills from edge pixels within `tolerance` distance of the background color
4. Sets matched pixels to transparent — interior regions of the same color (e.g. white text) are preserved

Configure via `bgRemovalConfig`:

| Option | Type | Default | Description |
|---|---|---|---|
| `tolerance` | `number` | `40` | Color distance threshold (0-255, Euclidean RGB distance) |
| `minEdgeRatio` | `number` | `0.3` | Minimum fraction of edge pixels sharing a color to count as background |

```html
<wtp-logo-upload enable-background-removal></wtp-logo-upload>
```

#### URL Input

Users can also paste an HTTPS URL to fetch a remote logo. The fetched file goes through the same validation pipeline. Non-HTTPS URLs are rejected, and CORS errors are displayed with a clear message.

---

### `<wtp-logo-renderer>`

Non-interactive canvas for rendering logos on product images. Uses Fabric.js `StaticCanvas` for lightweight rendering without user interaction.

#### Properties

| Property | Attribute | Type | Default | Description |
|---|---|---|---|---|
| `productImage` | `product-image` | `string \| undefined` | `undefined` | Product background image URL |
| `width` | `width` | `number` | `600` | Canvas width in pixels |
| `height` | `height` | `number` | `400` | Canvas height in pixels |
| `logos` | — | `PlacedLogo[]` | `[]` | Array of logos to place on the canvas |
| `backgroundColor` | `background-color` | `string` | `'#ffffff'` | Canvas background color |
| `printArea` | — | `PrintArea \| undefined` | `undefined` | Auto-fits logos without an explicit `transform` into the area (0–1 relative coords) |

#### Events

| Event | Detail | Description |
|---|---|---|
| `wtpRenderComplete` | `{ dataUrl: string }` | Fires when all logos have been rendered |
| `wtpRenderError` | `{ message: string }` | Fires on rendering error |

#### Methods

| Method | Signature | Description |
|---|---|---|
| `exportImage` | `(format?: 'png' \| 'jpeg', quality?: number) => Promise<string>` | Export canvas as a data URL |

---

### `<wtp-editor>`

Interactive canvas editor with a built-in toolbar for adding text, changing fonts, deleting objects, and exporting. Uses Fabric.js `Canvas` for full interactivity (drag, resize, rotate).

#### Properties

| Property | Attribute | Type | Default | Description |
|---|---|---|---|---|
| `width` | `width` | `number` | `800` | Canvas width in pixels |
| `height` | `height` | `number` | `600` | Canvas height in pixels |
| `productImage` | `product-image` | `string \| undefined` | `undefined` | Product background image URL |
| `initialState` | `initial-state` | `string \| undefined` | `undefined` | JSON-serialized initial editor state |
| `fonts` | — | `string[]` | `['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana']` | Available font families for the text tool |
| `printArea` | — | `PrintArea \| undefined` | `undefined` | Print area (0–1 relative coords) used to constrain objects to a defined region |
| `debug` | `debug` | `boolean` | `false` | Show the print-area overlay and clamp bounding box on the canvas |
| `labels` | — | `Partial<EditorLabels>` | `{}` | Override toolbar strings (see [Localizing text](#localizing-text-labels-prop)) |

#### Events

| Event | Detail | Description |
|---|---|---|
| `wtpEditorReady` | `void` | Fires when the canvas is initialized |
| `wtpEditorStateChanged` | `EditorState` | Fires on any object change (add/move/remove) |
| `wtpEditorObjectSelected` | `{ id: string; type: string }` | Fires when an object is selected |
| `wtpEditorObjectDeselected` | `void` | Fires when the selection is cleared |

#### Methods

| Method | Signature | Description |
|---|---|---|
| `addLogo` | `(logoData: LogoData) => Promise<string>` | Add a logo image, returns its object ID |
| `addText` | `(text: string, options?: { fontFamily?, fontSize?, fill? }) => Promise<string>` | Add a text object, returns its object ID |
| `updateText` | `(id: string, text: string) => Promise<void>` | Update the text content of an `i-text` object by ID |
| `removeObject` | `(id: string) => Promise<void>` | Remove an object by ID |
| `resetCanvas` | `() => Promise<void>` | Clear all user objects, keep the canvas instance alive |
| `exportState` | `() => Promise<EditorState>` | Export the full editor state as a serializable object |
| `loadState` | `(state: EditorState) => Promise<void>` | Restore a previously exported editor state |
| `exportImage` | `(format?: 'png' \| 'jpeg', quality?: number) => Promise<string>` | Export canvas as a data URL (1× resolution) |
| `exportImageHighRes` | `(format?, quality?, multiplier?) => Promise<{ dataUrl, width, height }>` | High-resolution export for PDF/print (default 3× multiplier) |
| `getObjects` | `() => Promise<{ id: string; type: string }[]>` | List all objects on the canvas |

## TypeScript Types

All types are exported from the package root:

```ts
import type {
  LogoFormat,           // 'png' | 'jpeg' | 'svg' | 'pdf' | 'tiff' | 'avif' | 'unknown'
  LogoMetadata,         // Format, dimensions, DPI, file size, transparency
  LogoValidationConfig, // Validation rules (minDpi, maxFileSize, minWidth, etc.)
  LogoValidationIssue,  // { code, severity, message }
  LogoValidationResult, // { valid, metadata, issues }
  LogoData,             // { dataUrl, previewDataUrl?, metadata }
  BgRemovalConfig,      // { tolerance, minEdgeRatio }
  CanvasTransform,      // { x, y, scaleX, scaleY, angle, skewX?, skewY? }
  PlacedLogo,           // { id, dataUrl, previewDataUrl?, transform? }
  PlacedText,           // { id, text, fontFamily, fontSize, fill, transform }
  EditorState,          // { fabricJson, logos, texts, productImage, width, height }
  PrintArea,            // { topLeft, topRight, bottomRight, bottomLeft, bulge? } (0–1 coords)
  RelativePoint,        // { x, y } in 0–1 space
  ArticleView,          // Single article view + print-method metadata
  Article,              // Multi-view article descriptor
  LogoUploadLabels,     // Strings used by <wtp-logo-upload>
  EditorLabels,         // Strings used by <wtp-editor>
} from 'web-to-print';

import {
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_BG_REMOVAL_CONFIG,
  DEFAULT_LOGO_UPLOAD_LABELS,
  DEFAULT_EDITOR_LABELS,
} from 'web-to-print';
```

## Theming

Components expose colors and the font family as **CSS custom properties** with sensible fallbacks. Override them with a plain CSS rule — no build step or SCSS knowledge required. CSS variables inherit through the Shadow DOM, so the same rule themes `wtp-logo-upload` (shadow-encapsulated) and the scoped components.

```css
/* Theme all components globally */
:root {
  --wtp-color-primary: #ff6600;
  --wtp-color-primary-hover: #e65500;
  --wtp-color-primary-light: #ffe4d1;
  --wtp-color-primary-fade: rgba(255, 102, 0, 0.2); /* used for focus glow */
  --wtp-font-family: 'Inter', sans-serif;
}

/* Or scope to a single instance */
wtp-editor {
  --wtp-color-border: #aaaaaa;
  --wtp-color-bg-muted: #1e1e1e;
  --wtp-color-text: #ffffff;
}
```

### Available CSS custom properties

| Variable | Default | Description |
|---|---|---|
| `--wtp-color-primary` | `#2563eb` | Primary action color (buttons, focus rings, dashed outlines) |
| `--wtp-color-primary-hover` | `#1d4ed8` | Primary hover state |
| `--wtp-color-primary-light` | `#dbeafe` | Primary tint (drop zone hover/drag-over) |
| `--wtp-color-primary-fade` | `rgba(37, 99, 235, 0.2)` | Translucent primary (selected-preview glow) |
| `--wtp-color-secondary` | `#64748b` | Secondary accent (upload icon stroke, preview hover) |
| `--wtp-color-error` | `#dc2626` | Error state color |
| `--wtp-color-error-light` | `#fee2e2` | Error background tint |
| `--wtp-color-success` | `#16a34a` | Success state color |
| `--wtp-color-success-light` | `#dcfce7` | Success background tint |
| `--wtp-color-warning` | `#d97706` | Warning state color |
| `--wtp-color-warning-light` | `#fef3c7` | Warning background tint |
| `--wtp-color-text` | `#1e293b` | Primary text color |
| `--wtp-color-text-muted` | `#64748b` | Muted/secondary text color |
| `--wtp-color-border` | `#e2e8f0` | Border color |
| `--wtp-color-bg` | `#ffffff` | Background color |
| `--wtp-color-bg-muted` | `#f8fafc` | Muted background (toolbar, drop zone) |
| `--wtp-font-family` | system stack | UI font family |

> Spacing and border-radius remain build-time SCSS tokens (`$wtp-spacing-*`, `$wtp-radius-*`) — they're not exposed as CSS variables. Fork the package if you need to change them.

### `::part()` styling (`wtp-logo-upload`)

Because `wtp-logo-upload` uses Shadow DOM, internal elements aren't reachable with normal selectors. Use the `::part()` pseudo-element to target specific elements:

```css
wtp-logo-upload::part(url-submit-btn) {
  background: #16a34a;
  border-color: #16a34a;
}

wtp-logo-upload::part(upload-zone drag-over) {
  border-color: red;
  background: #ffe5e5;
}

wtp-logo-upload::part(preview-item selected) {
  outline: 3px solid gold;
}
```

| Part name | Element |
|---|---|
| `root` | Outer wrapper |
| `url-input` | URL `<input type="url">` |
| `url-submit-btn` | "Fetch" button |
| `url-error` | URL error message paragraph |
| `divider` | "or" divider line |
| `upload-zone` | Drag-and-drop zone (also `drag-over` and `disabled` modifier parts) |
| `prompt-text` / `prompt-hint` | Default prompt text and hint inside the drop zone |
| `rejections` / `rejection-item` | Validation failure container and items |
| `pending-choices` / `choice-card` / `choice-option` | Background-removal choice cards |
| `previews` / `preview-item` | Preview gallery and items (selected items also get `selected`) |
| `remove-btn` | Per-preview remove button |

### Localizing text (`labels` prop)

`wtp-logo-upload` and `wtp-editor` accept a `labels` prop with **partial** overrides — supply only the keys you want to change; missing keys fall back to the English defaults.

```html
<wtp-logo-upload id="uploader"></wtp-logo-upload>
<script>
  document.getElementById('uploader').labels = {
    dropPromptText: 'Logo hierher ziehen oder klicken',
    dropPromptHint: 'PNG, JPEG, SVG, TIFF oder AVIF',
    dividerText: 'oder',
    urlSubmit: 'Laden',
    urlPlaceholder: 'https://beispiel.de/logo.png',
    urlErrorEmpty: 'Bitte eine URL eingeben',
    urlErrorInvalid: 'Ungültiges URL-Format',
    urlErrorProtocol: 'Nur HTTPS-URLs werden unterstützt',
    urlErrorNetwork: 'Bild konnte nicht geladen werden (CORS).',
    bgRemovalUseOriginal: 'Original verwenden',
    bgRemovalUseRemoved: 'Ohne Hintergrund',
    bgRemovalProcessing: 'Hintergrund wird entfernt...',
    bgRemovalFailed: 'Fehlgeschlagen',
    uploadAriaLabel: 'Logo-Datei hochladen',
    removeAriaLabel: (name) => `${name} entfernen`,
    rejectionDpiUnit: 'DPI',
  };
</script>
```

```js
document.querySelector('wtp-editor').labels = {
  addTextButton: 'Text hinzufügen',
  addTextTooltip: 'Text hinzufügen',
  fontSelectTooltip: 'Schriftart',
  colorPickerTooltip: 'Textfarbe',
  deleteButtonTooltip: 'Auswahl löschen',
  defaultText: 'Neuer Text',
};
```

Import the type and the defaults if you want to start from a complete object:

```ts
import {
  LogoUploadLabels,
  EditorLabels,
  DEFAULT_LOGO_UPLOAD_LABELS,
  DEFAULT_EDITOR_LABELS,
} from 'web-to-print';

const myLabels: LogoUploadLabels = {
  ...DEFAULT_LOGO_UPLOAD_LABELS,
  dividerText: 'oder',
};
```

#### `LogoUploadLabels` keys

`urlPlaceholder`, `urlSubmit`, `dividerText`, `dropPromptText`, `dropPromptHint`, `uploadAriaLabel`, `removeAriaLabel(fileName)`, `urlErrorEmpty`, `urlErrorInvalid`, `urlErrorProtocol`, `urlErrorHttp(status, statusText)`, `urlErrorNetwork`, `urlErrorFetch`, `bgRemovalProcessing`, `bgRemovalUseOriginal`, `bgRemovalUseRemoved`, `bgRemovalFailed`, `rejectionDpiUnit`.

#### `EditorLabels` keys

`addTextButton`, `addTextTooltip`, `fontSelectTooltip`, `colorPickerTooltip`, `deleteButtonTooltip`, `defaultText`.

## Development

```bash
# Install dependencies
npm install

# Dev server with hot reload
npm start

# Build for production
npm run build

# Run all tests (spec + e2e)
npm test

# Run only unit tests
npm run test.spec

# Run only e2e tests
npm run test.e2e

# Run tests in watch mode
npm run test.watch

# Run a single test file
npx stencil test --spec -- src/utils/format-detection.spec.ts

# Lint
npm run lint
```

## Project Structure

```
src/
  components/
    wtp-editor/            Interactive canvas editor
    wtp-logo-renderer/     Static logo-on-product renderer (HTML/img-based)
    wtp-logo-upload/       Logo upload with validation
    wtp-print-area-editor/ Interactive print-area definition tool (4-corner quad + bulge)
  styles/
    _variables.scss        Design tokens (colors and font-family exposed as CSS vars)
    _mixins.scss           SCSS mixins
    _reset.scss            CSS reset
  types/
    logo.ts                Logo-related interfaces
    editor.ts              Editor/canvas interfaces
    labels.ts              User-facing string interfaces and English defaults
    index.ts               Re-exports
  utils/
    background-removal.ts  Color-based flood-fill background removal
    canvas-helpers.ts      Fabric.js canvas utilities + CORS-safe image loader
    format-detection.ts    Magic-byte file format detection
    logo-validation.ts     DPI, dimension, and format validation
    image-preview.ts       Downscaled preview generation
    html-render-helpers.ts <img>-based layout/export helpers for the renderer
    pdf-export.ts          Multi-page PDF export with print-area metadata
  index.ts                 Public API exports
  index.html               Dev server demo page
scripts/
  image-proxy.mjs          Local dev-only CORS proxy for cross-origin product images
stencil.config.ts          Stencil build configuration
```

> The dev script (`npm start`) automatically launches `scripts/image-proxy.mjs` on port 3001. The canvas helper tries direct CORS first, then this proxy as a fallback, before loading the image tainted (which would block export).

## Key Dependencies

| Package | Purpose |
|---|---|
| [Fabric.js](https://fabricjs.com/) v7 | Canvas rendering, object manipulation, JSON serialization |
| [ExifReader](https://github.com/nicolo-ribaudo/exifreader) | DPI and metadata extraction from raster images |
| — | Background removal uses a built-in color-based flood-fill (zero dependencies) |
| [@stencil/core](https://stenciljs.com/) v4 | Web component compiler |
| [@stencil/sass](https://github.com/ionic-team/stencil-sass) | SCSS support |

## License

MIT
