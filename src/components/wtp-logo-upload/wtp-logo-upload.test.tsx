import { render, h, describe, it, expect, afterEach } from '@stencil/vitest';
import type { LogoData } from '../../types/logo';

/** Feeds a file into the component's hidden file input, as a real upload would. */
function selectFile(root: HTMLElement, file: File): void {
  const input = root.shadowRoot?.querySelector('input[type="file"]');
  if (input == null) return;

  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Minimal pdf.js stand-in: renders a 1200x800 page onto the canvas it is handed. */
function installFakePdfJs(behaviour: 'ok' | 'unreadable'): void {
  (window as unknown as Record<string, unknown>)['pdfjsLib'] = {
    getDocument: () => ({
      promise:
        behaviour === 'ok'
          ? Promise.resolve({
              numPages: 1,
              getPage: () =>
                Promise.resolve({
                  getViewport: ({ scale }: { scale: number }) => ({ width: 1200 * scale, height: 800 * scale }),
                  render: () => ({ promise: Promise.resolve() }),
                }),
            })
          : Promise.reject(new Error('Invalid PDF structure')),
    }),
  };
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect/></svg>';

describe('wtp-logo-upload browser', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['pdfjsLib'];
  });

  it('renders', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root).not.toBeNull();
  });

  it('shows upload zone with prompt text', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const promptText = root.shadowRoot?.querySelector('.prompt-text');
    expect(promptText).not.toBeNull();
    expect(promptText?.textContent).toContain('Drag & drop');
  });

  it('applies disabled styling', async () => {
    const { root } = await render(<wtp-logo-upload disabled></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.upload-zone')?.classList.contains('disabled')).toBe(true);
  });

  it('opens file dialog on click', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('emits wtpLogoRejected for invalid files', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, new File([new Uint8Array([0x00])], 'bad.bmp', { type: 'image/bmp' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(rejectedSpy).toHaveReceivedEvent();
  });

  it('emits wtpLogoValidated for valid SVG', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });

  // --- PDF and AI uploads ---

  it('rasterizes a PDF for the canvas and keeps the original as source', async () => {
    installFakePdfJs('ok');
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([PDF_BYTES], 'logo.pdf', { type: 'application/pdf' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
    const logo = validatedSpy.lastEvent?.detail as LogoData;

    // The canvas gets a raster, the print shop gets the uploaded PDF
    expect(logo.dataUrl.startsWith('data:image/png')).toBe(true);
    expect(logo.source?.mimeType).toBe('application/pdf');
    expect(logo.source?.fileName).toBe('logo.pdf');
    expect(logo.source?.dataUrl.startsWith('data:application/pdf')).toBe(true);
    expect(logo.metadata.format).toBe('pdf');
    expect(logo.metadata.width).toBeGreaterThan(0);
  });

  it('explains an AI file saved without PDF compatibility', async () => {
    installFakePdfJs('unreadable');
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, new File([PDF_BYTES], 'legacy.ai', { type: 'application/illustrator' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(rejectedSpy).toHaveReceivedEvent();
    const detail = rejectedSpy.lastEvent?.detail as { issues: { code: string; message: string }[] };
    expect(detail.issues[0].code).toBe('PDF_RENDER_FAILED');
    expect(detail.issues[0].message).toContain('PDF compatibility');
  });

  it('rejects a PDF when pdf.js is not loaded, naming the script', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, new File([PDF_BYTES], 'logo.pdf', { type: 'application/pdf' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(rejectedSpy).toHaveReceivedEvent();
    const detail = rejectedSpy.lastEvent?.detail as { issues: { message: string }[] };
    expect(detail.issues[0].message).toContain('pdf.js is required');
  });

  it('keeps the uploaded original for SVG uploads too', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([VALID_SVG], 'logo.svg', { type: 'image/svg+xml' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    const logo = validatedSpy.lastEvent?.detail as LogoData;
    // dataUrl is whitespace-trimmed by the editor path; source must be the upload
    expect(logo.source?.fileName).toBe('logo.svg');
    expect(logo.source?.mimeType).toBe('image/svg+xml');
  });

  // --- URL input tests ---

  it('renders URL input and button in browser', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.url-input')).not.toBeNull();
    expect(root.shadowRoot?.querySelector('.url-submit-btn')).not.toBeNull();
  });

  it('shows error for invalid URL', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);

    const urlInput = root.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    nativeInputValueSetter.call(urlInput, 'http://example.com/logo.png');
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChanges();

    (root.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement).click();
    await waitForChanges();

    const urlError = root.shadowRoot?.querySelector('.url-error');
    expect(urlError).not.toBeNull();
    expect(urlError?.textContent).toContain('HTTPS');
  });

  it('SVG emits wtpLogoValidated immediately even with enable-background-removal', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload enable-background-removal></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });
});
