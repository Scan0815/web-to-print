# wtp-logo-renderer



<!-- Auto Generated Below -->


## Properties

| Property          | Attribute          | Description                                                              | Type           | Default     |
| ----------------- | ------------------ | ------------------------------------------------------------------------ | -------------- | ----------- |
| `backgroundColor` | `background-color` | Background color.                                                        | `string`       | `'#ffffff'` |
| `height`          | `height`           | Container height in pixels.                                              | `number`       | `400`       |
| `logos`           | --                 | Array of logos to place on the renderer.                                 | `PlacedLogo[]` | `[]`        |
| `printArea`       | --                 | Print area definition for auto-fitting logos (relative 0-1 coordinates). | `PrintArea`    | `undefined` |
| `productImage`    | `product-image`    | Product background image URL.                                            | `string`       | `undefined` |
| `width`           | `width`            | Container width in pixels.                                               | `number`       | `600`       |


## Events

| Event               | Description                                               | Type                                |
| ------------------- | --------------------------------------------------------- | ----------------------------------- |
| `wtpRenderComplete` | Fires when the renderer has finished rendering all logos. | `CustomEvent<{ dataUrl: string; }>` |
| `wtpRenderError`    | Fires when a rendering error occurs.                      | `CustomEvent<{ message: string; }>` |


## Methods

### `exportImage(format?: "png" | "jpeg", quality?: number) => Promise<string>`

Export the rendered scene as a data URL image.

#### Parameters

| Name      | Type              | Description |
| --------- | ----------------- | ----------- |
| `format`  | `"png" \| "jpeg"` |             |
| `quality` | `number`          |             |

#### Returns

Type: `Promise<string>`




----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
