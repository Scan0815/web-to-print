import { DEFAULT_LOGO_UPLOAD_LABELS, DEFAULT_EDITOR_LABELS } from './labels';

describe('DEFAULT_LOGO_UPLOAD_LABELS', () => {
  it('exposes all required string keys', () => {
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlPlaceholder).toBe('https://example.com/logo.png');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlSubmit).toBe('Fetch');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.dividerText).toBe('or');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.dropPromptText).toContain('Drag');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.dropPromptHint).toContain('PNG');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.bgRemovalProcessing).toContain('background');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.bgRemovalUseOriginal).toBe('Use Original');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.bgRemovalUseRemoved).toBe('Without Background');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.bgRemovalFailed).toBe('Failed');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.rejectionDpiUnit).toBe('DPI');
  });

  it('removeAriaLabel interpolates the file name', () => {
    expect(DEFAULT_LOGO_UPLOAD_LABELS.removeAriaLabel('logo.png')).toBe('Remove logo.png');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.removeAriaLabel('A B & C.svg')).toBe('Remove A B & C.svg');
  });

  it('urlErrorHttp interpolates status and statusText', () => {
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorHttp(404, 'Not Found')).toBe('HTTP 404: Not Found');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorHttp(500, 'Internal Server Error')).toBe('HTTP 500: Internal Server Error');
  });

  it('static URL error messages are non-empty strings', () => {
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorEmpty.length).toBeGreaterThan(0);
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorInvalid.length).toBeGreaterThan(0);
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorProtocol).toContain('HTTPS');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorNetwork).toContain('CORS');
    expect(DEFAULT_LOGO_UPLOAD_LABELS.urlErrorFetch.length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_EDITOR_LABELS', () => {
  it('exposes all required string keys', () => {
    expect(DEFAULT_EDITOR_LABELS.addTextButton).toBe('Add Text');
    expect(DEFAULT_EDITOR_LABELS.addTextTooltip).toBe('Add text');
    expect(DEFAULT_EDITOR_LABELS.fontSelectTooltip).toBe('Font family');
    expect(DEFAULT_EDITOR_LABELS.colorPickerTooltip).toBe('Text color');
    expect(DEFAULT_EDITOR_LABELS.deleteButtonTooltip).toBe('Delete selected');
    expect(DEFAULT_EDITOR_LABELS.defaultText).toBe('New Text');
  });
});
