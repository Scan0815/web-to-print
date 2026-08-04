# wtp-logo-upload



<!-- Auto Generated Below -->


## Overview

Logo upload with drag-and-drop, format detection and print validation.

## Properties

| Property                  | Attribute                   | Description                                                                          | Type                   | Default                                                                                                                                                                 |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accept`                  | `accept`                    | Accepted file MIME types for the file input.                                         | `string`               | `'image/png,image/jpeg,image/svg+xml,image/tiff,image/avif,application/pdf,.ai'`                                                                                        |
| `allowUrlUpload`          | `allow-url-upload`          | Shows the "fetch from URL" input. Hidden by default; set to true to opt in.          | `boolean`              | `false`                                                                                                                                                                 |
| `bgRemovalConfig`         | --                          | Configuration for the color-based background removal algorithm.                      | `BgRemovalConfig`      | `{}`                                                                                                                                                                    |
| `config`                  | --                          | Validation rules for uploaded logos.                                                 | `LogoValidationConfig` | `{   minDpi: 300,   maxFileSize: 50 * 1024 * 1024, // 50MB   minWidth: 100,   minHeight: 100,   allowedFormats: ['png', 'jpeg', 'svg', 'tiff', 'avif', 'pdf', 'ai'], }` |
| `disabled`                | `disabled`                  | Disables the upload component.                                                       | `boolean`              | `false`                                                                                                                                                                 |
| `enableBackgroundRemoval` | `enable-background-removal` | Enables background removal for raster images after upload.                           | `boolean`              | `false`                                                                                                                                                                 |
| `labels`                  | --                          | Override any of the user-facing strings. Missing keys fall back to English defaults. | `LogoUploadLabels`     | `{}`                                                                                                                                                                    |
| `multiple`                | `multiple`                  | Whether multiple files can be uploaded at once.                                      | `boolean`              | `false`                                                                                                                                                                 |


## Events

| Event               | Description                                                      | Type                                                          |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `wtpLogoProcessing` | Fires when processing state changes (true = busy, false = idle). | `CustomEvent<boolean>`                                        |
| `wtpLogoRejected`   | Fires when a logo fails validation.                              | `CustomEvent<{ file: File; issues: LogoValidationIssue[]; }>` |
| `wtpLogoSelected`   | Fires when a logo is selected from the preview gallery.          | `CustomEvent<LogoData>`                                       |
| `wtpLogoValidated`  | Fires when a logo passes validation and is ready for use.        | `CustomEvent<LogoData>`                                       |


## Slots

| Slot       | Description                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `"prompt"` | Replaces the default drop-zone prompt (icon, headline and hint). The fallback content is shown when nothing is slotted in. |


## Shadow Parts

| Part                | Description |
| ------------------- | ----------- |
| `"choice-card"`     |             |
| `"choice-option"`   |             |
| `"divider"`         |             |
| `"pending-choices"` |             |
| `"preview-select"`  |             |
| `"previews"`        |             |
| `"prompt-hint"`     |             |
| `"prompt-text"`     |             |
| `"rejection-item"`  |             |
| `"rejections"`      |             |
| `"remove-btn"`      |             |
| `"root"`            |             |
| `"url-error"`       |             |
| `"url-input"`       |             |
| `"url-submit-btn"`  |             |


----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
