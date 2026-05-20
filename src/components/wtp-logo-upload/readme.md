# wtp-logo-upload



<!-- Auto Generated Below -->


## Properties

| Property                  | Attribute                   | Description                                                     | Type                   | Default                                                      |
| ------------------------- | --------------------------- | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `accept`                  | `accept`                    | Accepted file MIME types for the file input.                    | `string`               | `'image/png,image/jpeg,image/svg+xml,image/tiff,image/avif'` |
| `bgRemovalConfig`         | --                          | Configuration for the color-based background removal algorithm. | `BgRemovalConfig`      | `{}`                                                         |
| `config`                  | --                          | Validation rules for uploaded logos.                            | `LogoValidationConfig` | `DEFAULT_VALIDATION_CONFIG`                                  |
| `disabled`                | `disabled`                  | Disables the upload component.                                  | `boolean`              | `false`                                                      |
| `enableBackgroundRemoval` | `enable-background-removal` | Enables background removal for raster images after upload.      | `boolean`              | `false`                                                      |
| `multiple`                | `multiple`                  | Whether multiple files can be uploaded at once.                 | `boolean`              | `false`                                                      |


## Events

| Event               | Description                                                      | Type                                                          |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `wtpLogoProcessing` | Fires when processing state changes (true = busy, false = idle). | `CustomEvent<boolean>`                                        |
| `wtpLogoRejected`   | Fires when a logo fails validation.                              | `CustomEvent<{ file: File; issues: LogoValidationIssue[]; }>` |
| `wtpLogoSelected`   | Fires when a logo is selected from the preview gallery.          | `CustomEvent<LogoData>`                                       |
| `wtpLogoValidated`  | Fires when a logo passes validation and is ready for use.        | `CustomEvent<LogoData>`                                       |


----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
