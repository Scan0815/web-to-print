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

/** A real 120x120 PNG — above the default minimum size, so it passes validation. */
const RASTER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAABSElEQVR4nO3OQQ0AIAwAsUlENrLmgnuUpAI6c+73Qj9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/QPQDRD9A9ANEP0D0A0Q/MCxwbYmUNu15gwAAAABJRU5ErkJggg==';

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

  /** Valid PNG magic bytes with garbage behind them: passes format detection, will not decode. */
  function corruptPng(name = 'broken.png'): File {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(4000).fill(0x41)])], name, { type: 'image/png' });
  }

  it('clears the processing state when a file cannot be decoded', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const processingSpy = spyOnEvent('wtpLogoProcessing');

    selectFile(root, corruptPng());
    await waitForChanges();
    await new Promise(r => setTimeout(r, 800));

    // Leaving this on strands the host: the spinner never goes away and it keeps
    // believing the component is busy.
    const emitted = processingSpy.events.map((e: CustomEvent) => e.detail);
    expect(emitted[emitted.length - 1]).toBe(false);
    expect(root.shadowRoot?.querySelector('.processing-overlay')).toBeNull();
  });

  it('reports a file it cannot decode instead of failing silently', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, corruptPng());
    await waitForChanges();
    await new Promise(r => setTimeout(r, 800));

    expect(rejectedSpy).toHaveReceivedEvent();
    expect(root.shadowRoot?.querySelector('.rejection-item')?.textContent).toContain('broken.png');
  });

  it('carries on with the rest of the batch after an undecodable file', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload multiple></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(corruptPng());
    dt.items.add(new File([VALID_SVG], 'good.svg', { type: 'image/svg+xml' }));
    Object.defineProperty(input, 'files', { value: dt.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 800));

    expect(validatedSpy).toHaveReceivedEvent();
  });

  it('activates a preview with the keyboard', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    selectFile(root, new File([VALID_SVG], 'first.svg', { type: 'image/svg+xml' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    await waitForChanges();

    const selectedSpy = spyOnEvent('wtpLogoSelected');
    const target = root.shadowRoot?.querySelector('.preview-select') as HTMLElement | null;
    expect(target).not.toBeNull();

    target?.focus();
    expect(root.shadowRoot?.activeElement).toBe(target);
    // A real button activates on Enter; a div with role="button" does not.
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    target?.click();
    await waitForChanges();

    expect(selectedSpy).toHaveReceivedEvent();
  });

  it('does not nest the remove button inside the preview button', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    selectFile(root, new File([VALID_SVG], 'first.svg', { type: 'image/svg+xml' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    await waitForChanges();

    const select = root.shadowRoot?.querySelector('.preview-select');
    expect(select?.querySelector('.remove-btn')).toBeNull();
  });

  it('identifies a background-removal card by id, not by its position', async () => {
    // Cards are removed as the customer decides. A removal still running writes its result
    // back by identity; if that were the array position, it would land on whichever card
    // shifted into the freed slot — or on none, leaving that card spinning for good.
    const png = () => new File([Uint8Array.from(atob(RASTER_PNG), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' });
    const { root, waitForChanges } = await render(<wtp-logo-upload multiple enable-background-removal></wtp-logo-upload>);

    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(png());
    dt.items.add(png());
    Object.defineProperty(input, 'files', { value: dt.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 800));
    await waitForChanges();

    const idsOf = () => Array.from(root.shadowRoot?.querySelectorAll('.choice-option[data-choice-id]') ?? []).map(e => (e as HTMLElement).dataset.choiceId);
    const before = [...new Set(idsOf())];
    expect(before.length).toBe(2);

    // Take the first card out; the second must keep the identity its removal is writing to.
    (root.shadowRoot?.querySelector(`.choice-option[data-choice-id="${before[0]}"]`) as HTMLButtonElement).click();
    await waitForChanges();
    await new Promise(r => setTimeout(r, 200));
    await waitForChanges();

    expect([...new Set(idsOf())]).toEqual([before[1]]);
  });

  it('accepts the same file picked twice in a row', async () => {
    // A file input fires `change` only when its value differs from the last pick. The
    // component must clear it after processing, or uploading the same logo again — for
    // a second decoration — silently does nothing.
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validated = spyOnEvent('wtpLogoValidated');
    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;

    const pick = () => {
      const dt = new DataTransfer();
      dt.items.add(new File([VALID_SVG], 'same.svg', { type: 'image/svg+xml' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    pick();
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    // The precondition for the second `change` ever firing in a real browser.
    expect(input.value).toBe('');

    pick();
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    expect(validated.events.length).toBe(2);
  });

  it('emits wtpLogoSelected again when the selected logo is clicked again', async () => {
    // Click-to-place depends on this: switch decoration, click the (still selected)
    // logo, place it there too. A "nothing changed" guard would break that flow.
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    selectFile(root, new File([VALID_SVG], 'logo.svg', { type: 'image/svg+xml' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    await waitForChanges();

    const selectedSpy = spyOnEvent('wtpLogoSelected');
    const btn = root.shadowRoot?.querySelector('.preview-select') as HTMLButtonElement;
    btn.click();
    btn.click();
    await waitForChanges();

    expect(selectedSpy.events.length).toBe(2);
  });

  it('does not emit wtpLogoSelected when a removal auto-selects the next logo', async () => {
    // Nothing was picked there — a click-to-place host would otherwise add a logo to
    // the canvas as a side effect of deleting another one.
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload multiple></wtp-logo-upload>);
    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([VALID_SVG], 'one.svg', { type: 'image/svg+xml' }));
    dt.items.add(new File([VALID_SVG.replace('200', '300')], 'two.svg', { type: 'image/svg+xml' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));
    await waitForChanges();

    const selectedSpy = spyOnEvent('wtpLogoSelected');
    // The second upload is the selected one; removing it re-selects the first — silently.
    const removeButtons = root.shadowRoot?.querySelectorAll('.remove-btn');
    (removeButtons![1] as HTMLButtonElement).click();
    await waitForChanges();

    expect(root.shadowRoot?.querySelectorAll('.preview-item').length).toBe(1);
    expect(selectedSpy.events.length).toBe(0);
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
