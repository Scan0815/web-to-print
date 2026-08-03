# wtp-editor



<!-- Auto Generated Below -->


## Properties

| Property        | Attribute         | Description                                                                                                                                                                                                                                                                                                                                                                                                     | Type            | Default                                                           |
| --------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `activeViewId`  | `active-view-id`  | Id of the decoration currently being edited. Defaults to the `isDefault` view, else the first.                                                                                                                                                                                                                                                                                                                  | `string`        | `undefined`                                                       |
| `articleId`     | `article-id`      | Article id written into the exported envelope.                                                                                                                                                                                                                                                                                                                                                                  | `string`        | `''`                                                              |
| `debug`         | `debug`           | Show print area overlay and bounding box for debugging.                                                                                                                                                                                                                                                                                                                                                         | `boolean`       | `false`                                                           |
| `fonts`         | --                | Available font families for the text tool.                                                                                                                                                                                                                                                                                                                                                                      | `string[]`      | `['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana']` |
| `height`        | `height`          | Canvas height in pixels.                                                                                                                                                                                                                                                                                                                                                                                        | `number`        | `600`                                                             |
| `initialLogo`   | --                | Logo the customer already picked in the catalog, placed once when the editor initializes. It lands in the decoration the editor opens on and nowhere else: `status: 'designed'` is what the shop charges for, so auto-filling every decoration would order — and bill — positions the customer never chose. `applyLogoToAllViews` is the one visible click that extends it. Ignored when `initialState` is set. | `LogoData`      | `undefined`                                                       |
| `initialState`  | `initial-state`   | JSON-serialized initial editor state.                                                                                                                                                                                                                                                                                                                                                                           | `string`        | `undefined`                                                       |
| `labels`        | --                | Override any of the user-facing toolbar strings. Missing keys fall back to English defaults.                                                                                                                                                                                                                                                                                                                    | `EditorLabels`  | `{}`                                                              |
| `printArea`     | --                | <span style="color:red">**[DEPRECATED]**</span> Single-decoration fallback used only when `views` is empty.<br/><br/>Print area definition (0-1 relative coordinates) to constrain objects.                                                                                                                                                                                                                     | `PrintArea`     | `undefined`                                                       |
| `productImage`  | `product-image`   | <span style="color:red">**[DEPRECATED]**</span> Single-decoration fallback used only when `views` is empty.<br/><br/>Product background image URL.                                                                                                                                                                                                                                                              | `string`        | `undefined`                                                       |
| `showViewStrip` | `show-view-strip` | Show the built-in decoration strip. Turn off to build your own switcher around `activeViewId`.                                                                                                                                                                                                                                                                                                                  | `boolean`       | `true`                                                            |
| `views`         | --                | Decoration options (Veredelungen) of the article. Each view needs a stable `id`.                                                                                                                                                                                                                                                                                                                                | `ArticleView[]` | `[]`                                                              |
| `width`         | `width`           | Canvas width in pixels.                                                                                                                                                                                                                                                                                                                                                                                         | `number`        | `800`                                                             |


## Events

| Event                       | Description                                                   | Type                                              |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `wtpEditorObjectDeselected` | Fires when the current selection is cleared.                  | `CustomEvent<void>`                               |
| `wtpEditorObjectSelected`   | Fires when an object is selected on the canvas.               | `CustomEvent<{ id: string; type: string; }>`      |
| `wtpEditorReady`            | Fires when the canvas is initialized and ready.               | `CustomEvent<void>`                               |
| `wtpEditorStateChanged`     | Fires when the editor state changes (object add/move/remove). | `CustomEvent<ArticleEditorState>`                 |
| `wtpEditorViewChanged`      | Fires when the edited decoration changes.                     | `CustomEvent<{ viewId: string; index: number; }>` |


## Methods

### `addLogo(logoData: LogoData) => Promise<string>`

Add a logo image to the canvas and return its object ID.

#### Parameters

| Name       | Type       | Description |
| ---------- | ---------- | ----------- |
| `logoData` | `LogoData` |             |

#### Returns

Type: `Promise<string>`



### `addText(text: string, options?: { fontFamily?: string; fontSize?: number; fill?: string; }) => Promise<string>`

Add a text object to the canvas and return its object ID.

#### Parameters

| Name      | Type                                                         | Description |
| --------- | ------------------------------------------------------------ | ----------- |
| `text`    | `string`                                                     |             |
| `options` | `{ fontFamily?: string; fontSize?: number; fill?: string; }` |             |

#### Returns

Type: `Promise<string>`



### `applyLogoToAllViews(logoId: string) => Promise<string[]>`

Places the given logo on every decoration that is still empty, fitted to that
decoration's own print area. Decorations that already carry a design are left alone.
Returns the ids of the views that received the logo.

#### Parameters

| Name     | Type     | Description |
| -------- | -------- | ----------- |
| `logoId` | `string` |             |

#### Returns

Type: `Promise<string[]>`



### `exportImage(format?: "png" | "jpeg", quality?: number) => Promise<string>`

Export the canvas as a data URL image.

#### Parameters

| Name      | Type              | Description |
| --------- | ----------------- | ----------- |
| `format`  | `"png" \| "jpeg"` |             |
| `quality` | `number`          |             |

#### Returns

Type: `Promise<string>`



### `exportImageHighRes(format?: "png" | "jpeg", quality?: number, multiplier?: number) => Promise<{ dataUrl: string; width: number; height: number; }>`

Export the canvas as a high-resolution data URL image (for PDF/print).
Returns the data URL plus the actual canvas dimensions (which may differ
from the width/height props after setCanvasBackground resizes the canvas).

#### Parameters

| Name         | Type              | Description |
| ------------ | ----------------- | ----------- |
| `format`     | `"png" \| "jpeg"` |             |
| `quality`    | `number`          |             |
| `multiplier` | `number`          |             |

#### Returns

Type: `Promise<{ dataUrl: string; width: number; height: number; }>`



### `exportPdf(article: Article, config?: Partial<PdfExportConfig>) => Promise<void>`

Renders the proof PDF for every designed decoration and triggers the download.

Hosts can also call `exportArticlePdf` themselves — but importing the library's ESM
bundle into a page that already loaded the components pulls in a second Stencil
runtime, so going through the component is the safer route.
Requires jsPDF to be loaded globally.

#### Parameters

| Name      | Type                                                                                                                                                                                      | Description |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `article` | `Article`                                                                                                                                                                                 |             |
| `config`  | `{ pageFormat?: "a4" \| "letter"; orientation?: "portrait" \| "landscape"; marginMm?: number; showPrintAreaGuides?: boolean; title?: string; viewIds?: string[]; proofNotice?: string; }` |             |

#### Returns

Type: `Promise<void>`



### `exportState() => Promise<ArticleEditorState>`

Export the state of every decoration as a versioned envelope.

#### Returns

Type: `Promise<ArticleEditorState>`



### `exportViewImage(viewId: string, format?: "png" | "jpeg", quality?: number) => Promise<string>`

Renders one decoration to an image, whether or not it is the one on screen. The
decoration is put on the canvas, exported, and the original one restored — so a host
building its own switcher can render a thumbnail for any decoration.

The round trip goes through the same path as a manual switch, so it clears the
current selection when the requested decoration is not the active one.

#### Parameters

| Name      | Type              | Description |
| --------- | ----------------- | ----------- |
| `viewId`  | `string`          |             |
| `format`  | `"png" \| "jpeg"` |             |
| `quality` | `number`          |             |

#### Returns

Type: `Promise<string>`



### `getObjects() => Promise<{ id: string; type: string; }[]>`

Get a list of all objects on the canvas with their IDs and types.

#### Returns

Type: `Promise<{ id: string; type: string; }[]>`



### `loadState(state: ArticleEditorState | EditorState) => Promise<void>`

Load a previously exported state — the v2 envelope or a legacy single-view state.

#### Parameters

| Name    | Type                                | Description |
| ------- | ----------------------------------- | ----------- |
| `state` | `EditorState \| ArticleEditorState` |             |

#### Returns

Type: `Promise<void>`



### `removeObject(id: string) => Promise<void>`

Remove an object from the canvas by its ID.

#### Parameters

| Name | Type     | Description |
| ---- | -------- | ----------- |
| `id` | `string` |             |

#### Returns

Type: `Promise<void>`



### `renderMockups(viewIds?: string[], multiplier?: number) => Promise<Record<string, { dataUrl: string; width: number; height: number; }>>`

Renders a high-resolution mockup per decoration, keyed by view id — the input the
PDF export needs. Only the editor can produce these, because each decoration has to
be put on the canvas first. The originally active decoration is restored afterwards.

#### Parameters

| Name         | Type       | Description |
| ------------ | ---------- | ----------- |
| `viewIds`    | `string[]` |             |
| `multiplier` | `number`   |             |

#### Returns

Type: `Promise<Record<string, { dataUrl: string; width: number; height: number; }>>`



### `resetCanvas() => Promise<void>`

Clear all user objects from the canvas, keeping the instance alive.

#### Returns

Type: `Promise<void>`



### `setActiveView(viewId: string) => Promise<void>`

Switch to another decoration, storing the current one first.

#### Parameters

| Name     | Type     | Description |
| -------- | -------- | ----------- |
| `viewId` | `string` |             |

#### Returns

Type: `Promise<void>`



### `updateText(id: string, text: string) => Promise<void>`

Update the text content of a text object by its ID.

#### Parameters

| Name   | Type     | Description |
| ------ | -------- | ----------- |
| `id`   | `string` |             |
| `text` | `string` |             |

#### Returns

Type: `Promise<void>`




----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
