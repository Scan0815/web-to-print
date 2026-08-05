import { getPdfJs, isPdfRenderingAvailable, renderPdfFirstPage } from './pdf-render';

describe('pdf-render', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['pdfjsLib'];
  });

  it('reports pdf.js as unavailable when it was not loaded', () => {
    expect(isPdfRenderingAvailable()).toBe(false);
  });

  it('throws a helpful error naming the script tag', () => {
    expect(() => getPdfJs()).toThrow(/pdf\.js is required/);
  });

  it('finds pdf.js on the window', () => {
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = { getDocument: () => ({ promise: Promise.resolve({}) }) };
    expect(isPdfRenderingAvailable()).toBe(true);
  });

  it('explains AI files saved without PDF compatibility', async () => {
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = {
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }),
    };

    const file = new File([new Uint8Array([0x00])], 'legacy.ai', { type: 'application/illustrator' });
    await expect(renderPdfFirstPage(file)).rejects.toThrow(/PDF compatibility/);
  });

  it('passes through the reason for an unreadable PDF', async () => {
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = {
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }),
    };

    const file = new File([new Uint8Array([0x00])], 'broken.pdf', { type: 'application/pdf' });
    await expect(renderPdfFirstPage(file)).rejects.toThrow(/Invalid PDF structure/);
  });
});
