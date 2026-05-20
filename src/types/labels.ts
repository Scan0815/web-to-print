// User-facing strings for components, overridable via the `labels` prop.
// Pass any subset; missing keys fall back to the English defaults below.

export interface LogoUploadLabels {
  urlPlaceholder: string;
  urlSubmit: string;
  dividerText: string;
  dropPromptText: string;
  dropPromptHint: string;
  uploadAriaLabel: string;
  removeAriaLabel: (fileName: string) => string;
  urlErrorEmpty: string;
  urlErrorInvalid: string;
  urlErrorProtocol: string;
  urlErrorHttp: (status: number, statusText: string) => string;
  urlErrorNetwork: string;
  urlErrorFetch: string;
  bgRemovalProcessing: string;
  bgRemovalUseOriginal: string;
  bgRemovalUseRemoved: string;
  bgRemovalFailed: string;
  rejectionDpiUnit: string;
}

export const DEFAULT_LOGO_UPLOAD_LABELS: LogoUploadLabels = {
  urlPlaceholder: 'https://example.com/logo.png',
  urlSubmit: 'Fetch',
  dividerText: 'or',
  dropPromptText: 'Drag & drop your logo here or click to browse',
  dropPromptHint: 'PNG, JPEG, SVG, TIFF, or AVIF',
  uploadAriaLabel: 'Upload logo file',
  removeAriaLabel: (fileName) => `Remove ${fileName}`,
  urlErrorEmpty: 'Please enter a URL',
  urlErrorInvalid: 'Invalid URL format',
  urlErrorProtocol: 'Only HTTPS URLs are supported',
  urlErrorHttp: (status, statusText) => `HTTP ${status}: ${statusText}`,
  urlErrorNetwork: 'Could not fetch the image. The server may not allow cross-origin requests (CORS).',
  urlErrorFetch: 'Failed to fetch image',
  bgRemovalProcessing: 'Removing background...',
  bgRemovalUseOriginal: 'Use Original',
  bgRemovalUseRemoved: 'Without Background',
  bgRemovalFailed: 'Failed',
  rejectionDpiUnit: 'DPI',
};

export interface EditorLabels {
  addTextButton: string;
  addTextTooltip: string;
  fontSelectTooltip: string;
  colorPickerTooltip: string;
  deleteButtonTooltip: string;
  defaultText: string;
}

export const DEFAULT_EDITOR_LABELS: EditorLabels = {
  addTextButton: 'Add Text',
  addTextTooltip: 'Add text',
  fontSelectTooltip: 'Font family',
  colorPickerTooltip: 'Text color',
  deleteButtonTooltip: 'Delete selected',
  defaultText: 'New Text',
};
