# wtp-print-area-editor



<!-- Auto Generated Below -->


## Properties

| Property       | Attribute       | Description                                    | Type        | Default     |
| -------------- | --------------- | ---------------------------------------------- | ----------- | ----------- |
| `height`       | `height`        | Canvas height in pixels.                       | `number`    | `600`       |
| `printArea`    | --              | Current print area (relative 0-1 coordinates). | `PrintArea` | `undefined` |
| `productImage` | `product-image` | Product background image URL.                  | `string`    | `undefined` |
| `width`        | `width`         | Canvas width in pixels.                        | `number`    | `800`       |


## Events

| Event                | Description                                      | Type                     |
| -------------------- | ------------------------------------------------ | ------------------------ |
| `wtpPrintAreaChange` | Fires when the print area rectangle is modified. | `CustomEvent<PrintArea>` |


## Methods

### `getPrintArea() => Promise<PrintArea>`

Get the current print area as relative 0-1 coordinates.

#### Returns

Type: `Promise<PrintArea>`



### `setPrintArea(printArea: PrintArea) => Promise<void>`

Set the print area and update the quad on canvas.

#### Parameters

| Name        | Type        | Description |
| ----------- | ----------- | ----------- |
| `printArea` | `PrintArea` |             |

#### Returns

Type: `Promise<void>`




----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
