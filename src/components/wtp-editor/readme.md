# wtp-editor



<!-- Auto Generated Below -->


## Properties

| Property       | Attribute       | Description                                                                                  | Type           | Default                                                           |
| -------------- | --------------- | -------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------- |
| `debug`        | `debug`         | Show print area overlay and bounding box for debugging.                                      | `boolean`      | `false`                                                           |
| `fonts`        | --              | Available font families for the text tool.                                                   | `string[]`     | `['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana']` |
| `height`       | `height`        | Canvas height in pixels.                                                                     | `number`       | `600`                                                             |
| `initialState` | `initial-state` | JSON-serialized initial editor state.                                                        | `string`       | `undefined`                                                       |
| `labels`       | --              | Override any of the user-facing toolbar strings. Missing keys fall back to English defaults. | `EditorLabels` | `{}`                                                              |
| `printArea`    | --              | Print area definition (0-1 relative coordinates) to constrain objects.                       | `PrintArea`    | `undefined`                                                       |
| `productImage` | `product-image` | Product background image URL.                                                                | `string`       | `undefined`                                                       |
| `width`        | `width`         | Canvas width in pixels.                                                                      | `number`       | `800`                                                             |


## Events

| Event                       | Description                                                   | Type                                         |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `wtpEditorObjectDeselected` | Fires when the current selection is cleared.                  | `CustomEvent<void>`                          |
| `wtpEditorObjectSelected`   | Fires when an object is selected on the canvas.               | `CustomEvent<{ id: string; type: string; }>` |
| `wtpEditorReady`            | Fires when the canvas is initialized and ready.               | `CustomEvent<void>`                          |
| `wtpEditorStateChanged`     | Fires when the editor state changes (object add/move/remove). | `CustomEvent<EditorState>`                   |


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



### `exportState() => Promise<EditorState>`

Export the current editor state as a serializable object.

#### Returns

Type: `Promise<EditorState>`



### `getObjects() => Promise<{ id: string; type: string; }[]>`

Get a list of all objects on the canvas with their IDs and types.

#### Returns

Type: `Promise<{ id: string; type: string; }[]>`



### `loadState(state: EditorState) => Promise<void>`

Load a previously exported editor state.

#### Parameters

| Name    | Type          | Description |
| ------- | ------------- | ----------- |
| `state` | `EditorState` |             |

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



### `resetCanvas() => Promise<void>`

Clear all user objects from the canvas, keeping the instance alive.

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
