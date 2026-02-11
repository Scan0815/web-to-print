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
| `removeObject` | `(id: string) => Promise<void>` | Remove an object by ID |
| `exportState` | `() => Promise<EditorState>` | Export the full editor state as a serializable object |
| `loadState` | `(state: EditorState) => Promise<void>` | Restore a previously exported editor state |
| `exportImage` | `(format?: 'png' \| 'jpeg', quality?: number) => Promise<string>` | Export canvas as a data URL |
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
  LogoData,             // { dataUrl, metadata }
  CanvasTransform,      // { x, y, scaleX, scaleY, angle }
  PlacedLogo,           // { id, dataUrl, transform }
  PlacedText,           // { id, text, fontFamily, fontSize, fill, transform }
  EditorState,          // { fabricJson, logos, texts, productImage, width, height }
} from 'web-to-print';
```

## Theming

Components use SCSS design tokens defined in `src/styles/_variables.scss`. Override the SCSS variables to match your brand:

| Token | Default | Description |
|---|---|---|
| `$wtp-color-primary` | `#2563eb` | Primary action color |
| `$wtp-color-primary-hover` | `#1d4ed8` | Primary hover state |
| `$wtp-color-error` | `#dc2626` | Error state color |
| `$wtp-color-success` | `#16a34a` | Success state color |
| `$wtp-color-warning` | `#d97706` | Warning state color |
| `$wtp-color-text` | `#1e293b` | Primary text color |
| `$wtp-color-text-muted` | `#64748b` | Secondary text color |
| `$wtp-color-border` | `#e2e8f0` | Border color |
| `$wtp-color-bg` | `#ffffff` | Background color |
| `$wtp-radius-sm` / `md` / `lg` | `4px` / `8px` / `12px` | Border radius scale |
| `$wtp-spacing-xs` ... `2xl` | `4px` ... `48px` | Spacing scale |

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
    wtp-logo-renderer/     Static logo-on-product renderer
    wtp-logo-upload/       Logo upload with validation
  styles/
    _variables.scss        Design tokens
    _mixins.scss           SCSS mixins
    _reset.scss            CSS reset
  types/
    logo.ts                Logo-related interfaces
    editor.ts              Editor/canvas interfaces
    index.ts               Re-exports
  utils/
    background-removal.ts  Color-based flood-fill background removal
    canvas-helpers.ts      Fabric.js canvas utilities
    format-detection.ts    Magic-byte file format detection
    logo-validation.ts     DPI, dimension, and format validation
  index.ts                 Public API exports
  index.html               Dev server demo page
stencil.config.ts          Stencil build configuration
```

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
