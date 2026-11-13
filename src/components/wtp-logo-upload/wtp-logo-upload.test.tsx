import { render, h, describe, it, expect, afterEach } from '@stencil/vitest';
import { jsPDF } from 'jspdf';
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

  /** A PNG of the given size carrying a pHYs chunk, i.e. tagged with that DPI. */
  async function pngTaggedWithDpi(size: number, dpi: number): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#0044cc';
    context.fillRect(0, 0, size, size);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b as Blob), 'image/png'));
    const png = new Uint8Array(await blob.arrayBuffer());

    // pHYs: pixels per metre on both axes, unit 1 (metre), followed by the chunk CRC.
    const chunk = new Uint8Array(4 + 4 + 9 + 4);
    const view = new DataView(chunk.buffer);
    const pixelsPerMetre = Math.round(dpi * 39.3701);
    view.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);
    view.setUint32(8, pixelsPerMetre);
    view.setUint32(12, pixelsPerMetre);
    chunk[16] = 1;
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, 17)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
    view.setUint32(17, (crc ^ 0xffffffff) >>> 0);

    // Signature (8 bytes) plus the IHDR chunk (25 bytes); pHYs has to come before IDAT.
    return new File([png.subarray(0, 33), chunk, png.subarray(33)], 'web-logo.png', { type: 'image/png' });
  }

  it('accepts a large raster logo whose file is tagged with 72 DPI', async () => {
    // The tag says nothing about print quality: 1200 px are plenty for a small print
    // area. Whether a logo is sharp enough is decided in the editor, at the printed size.
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, await pngTaggedWithDpi(1200, 72));
    await expect.poll(() => validatedSpy.length + rejectedSpy.length, { timeout: 5000 }).toBeGreaterThan(0);
    await waitForChanges();

    expect(rejectedSpy.length).toBe(0);
    const logo = validatedSpy.events[0].detail as LogoData;
    // The tag was really read, so this is not passing because the chunk went unnoticed.
    expect(logo.metadata.dpiX).toBe(72);
    expect(logo.metadata.width).toBe(1200);
  });

  describe('print size hint', () => {
    const CONFIG = { minDpi: 300, maxFileSize: 50 * 1024 * 1024, minWidth: 100, minHeight: 100, allowedFormats: ['png', 'svg'], printSizeMm: { width: 45, height: 50 } };

    async function upload(file: File, labels?: Record<string, unknown>) {
      const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
      const element = root as HTMLElement & { config: typeof CONFIG; labels: Record<string, unknown> };
      element.config = CONFIG;
      if (labels !== undefined) element.labels = labels;
      await waitForChanges();

      const validatedSpy = spyOnEvent('wtpLogoValidated');
      const rejectedSpy = spyOnEvent('wtpLogoRejected');
      selectFile(root, file);
      await expect.poll(() => validatedSpy.length + rejectedSpy.length, { timeout: 5000 }).toBeGreaterThan(0);
      await waitForChanges();

      expect(rejectedSpy.length).toBe(0);
      return { logo: validatedSpy.events[0].detail as LogoData, warnings: Array.from(root.shadowRoot?.querySelectorAll('.preview-warnings li') ?? []).map(li => li.textContent ?? '') };
    }

    it('accepts a logo that is too small for the print area, with a warning', async () => {
      // 240 px across a 45 mm wide area is 135 DPI.
      const { logo, warnings } = await upload(await pngTaggedWithDpi(240, 300));

      expect(logo.issues?.map(i => [i.code, i.severity])).toEqual([['LOW_PRINT_RESOLUTION', 'warning']]);
      expect(logo.issues?.[0].message).toContain('135 DPI');
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('web-logo.png');
      expect(warnings[0]).toContain('135 DPI');
      expect(warnings[0]).toContain('20 × 20 mm');
    });

    it('says nothing about a logo with enough pixels', async () => {
      const { logo, warnings } = await upload(await pngTaggedWithDpi(1200, 72));

      expect(logo.issues).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it('does not judge an SVG', async () => {
      const { logo, warnings } = await upload(new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' }));

      expect(logo.issues).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it('uses the host translation for the warning', async () => {
      const { logo } = await upload(await pngTaggedWithDpi(240, 300), {
        lowPrintResolution: (dpi: number, minDpi: number, w: number, h: number) => `Nur ${dpi} von ${minDpi} dpi, scharf bis ${w} x ${h} mm`,
      });

      expect(logo.issues?.[0].message).toBe('Nur 135 von 300 dpi, scharf bis 20 x 20 mm');
    });
  });

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

  // The fake above cannot prove that a PDF is actually parsed and drawn — these run the
  // pdf.js bundled with the library against real vector PDFs, with no host setup at all.
  describe('with the bundled pdf.js', () => {
    /** Uploads a jsPDF document and returns the logo plus a pixel reader for its raster. */
    async function uploadPdf(doc: jsPDF, backgroundRemoval: 'off' | 'expect-no-choice' | 'pick-removed' = 'off'): Promise<{ logo: LogoData; pixel: (x: number, y: number) => number[] }> {
      expect((window as unknown as Record<string, unknown>)['pdfjsLib']).toBeUndefined();
      const file = new File([doc.output('arraybuffer')], 'vector.pdf', { type: 'application/pdf' });

      const { root, spyOnEvent, waitForChanges } = await render(
        backgroundRemoval === 'off' ? <wtp-logo-upload></wtp-logo-upload> : <wtp-logo-upload enable-background-removal></wtp-logo-upload>,
      );
      const validatedSpy = spyOnEvent('wtpLogoValidated');
      const rejectedSpy = spyOnEvent('wtpLogoRejected');

      selectFile(root, file);

      if (backgroundRemoval === 'pick-removed') {
        // The second option is the cleaned version; it is enabled once the removal is done.
        const removedOption = () => root.shadowRoot?.querySelectorAll('.choice-option')[1] as HTMLButtonElement | undefined;
        await expect.poll(() => removedOption() !== undefined && !removedOption()?.classList.contains('choice-option--disabled'), { timeout: 10000 }).toBe(true);
        expect(validatedSpy).not.toHaveReceivedEvent();
        removedOption()?.click();
      }

      await expect.poll(() => validatedSpy.length + rejectedSpy.length, { timeout: 10000 }).toBeGreaterThan(0);
      await waitForChanges();

      expect(rejectedSpy).not.toHaveReceivedEvent();
      const logo = validatedSpy.lastEvent?.detail as LogoData;

      const img = new Image();
      img.src = logo.dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);

      return { logo, pixel: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data) };
    }

    it('trims the page to the artwork and renders it at full resolution', async () => {
      // A small red square on an A4 page: 20x20 mm of 210x297 mm.
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFillColor(255, 0, 0);
      doc.rect(60, 100, 20, 20, 'F');

      const { logo, pixel } = await uploadPdf(doc);

      expect(logo.metadata.format).toBe('pdf');
      expect(logo.source?.dataUrl.startsWith('data:application/pdf')).toBe(true);
      // The square, not the page, fills the raster — and at far more than the ~135 px a
      // crop of the 2000 px page render would have left.
      expect(logo.metadata.width / logo.metadata.height).toBeCloseTo(1, 1);
      expect(logo.metadata.width).toBeGreaterThan(1000);
      expect(pixel(logo.metadata.width >> 1, logo.metadata.height >> 1)).toEqual([255, 0, 0, 255]);
      expect(pixel(40, 40)).toEqual([255, 0, 0, 255]);
      expect(pixel(logo.metadata.width - 40, logo.metadata.height - 40)).toEqual([255, 0, 0, 255]);
    });

    it('keeps the area around the artwork transparent', async () => {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFillColor(255, 0, 0);
      doc.circle(105, 148, 40, 'F');

      const { logo, pixel } = await uploadPdf(doc);

      expect(pixel(logo.metadata.width >> 1, logo.metadata.height >> 1)).toEqual([255, 0, 0, 255]);
      expect(pixel(3, 3)[3]).toBe(0);
    });

    /** A4 with a painted white page and a small 30 mm red circle — a typical export. */
    function smallLogoOnWhitePage(): jsPDF {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 210, 297, 'F');
      doc.setFillColor(255, 0, 0);
      doc.circle(60, 60, 15, 'F');
      return doc;
    }

    // Without background removal the page colour stays, but the raster is still the
    // artwork at full resolution rather than the whole sheet.
    it('trims a PDF with a painted page background to the artwork', async () => {
      const { logo, pixel } = await uploadPdf(smallLogoOnWhitePage());

      expect(logo.metadata.width / logo.metadata.height).toBeCloseTo(1, 1);
      expect(logo.metadata.width).toBeGreaterThan(1500);
      expect(pixel(3, 3)).toEqual([255, 255, 255, 255]);
      expect(pixel(logo.metadata.width >> 1, logo.metadata.height >> 1)).toEqual([255, 0, 0, 255]);
    });

    it('offers background removal for a PDF with a painted page background', async () => {
      const { logo, pixel } = await uploadPdf(smallLogoOnWhitePage(), 'pick-removed');

      // The white sheet is gone …
      expect(pixel(1, 1)[3]).toBe(0);
      expect(pixel(logo.metadata.width >> 1, logo.metadata.height >> 1)).toEqual([255, 0, 0, 255]);
      expect(logo.metadata.width / logo.metadata.height).toBeCloseTo(1, 1);
      // … and the 30 mm logo is sharp: a crop of the page render would be ~200 px wide.
      expect(logo.metadata.width).toBeGreaterThan(1500);
      // The print shop still gets the untouched vector original.
      expect(logo.source?.dataUrl.startsWith('data:application/pdf')).toBe(true);
    });

    it('skips the background-removal choice for a PDF that is already transparent', async () => {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFillColor(255, 0, 0);
      doc.circle(105, 148, 40, 'F');

      const { pixel } = await uploadPdf(doc, 'expect-no-choice');

      expect(pixel(3, 3)[3]).toBe(0);
    });
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

  it('exposes each preview as a native button so it is keyboard-operable', async () => {
    // A dispatched KeyboardEvent does not trigger native activation, so simulating Enter
    // proves nothing. The real guarantee is the element itself: a native <button> is
    // activated by Enter/Space and sits in the tab order for free, whereas a div with
    // role="button" would need an onKeyDown the component does not add.
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    selectFile(root, new File([VALID_SVG], 'first.svg', { type: 'image/svg+xml' }));
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));
    await waitForChanges();

    const target = root.shadowRoot?.querySelector('.preview-select') as HTMLElement | null;
    expect(target).not.toBeNull();
    expect(target?.tagName).toBe('BUTTON');
    expect((target as HTMLButtonElement).type).toBe('button');
    // Focusable, and clicking it (Enter/Space route to the same handler natively) selects.
    const selectedSpy = spyOnEvent('wtpLogoSelected');
    target?.focus();
    expect(root.shadowRoot?.activeElement).toBe(target);
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
