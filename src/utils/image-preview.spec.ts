import { generatePreviewDataUrl } from './image-preview';

describe('generatePreviewDataUrl', () => {
  it('returns SVG data URLs unchanged', async () => {
    const svgDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48L3N2Zz4=';
    const result = await generatePreviewDataUrl(svgDataUrl);
    expect(result).toBe(svgDataUrl);
  });

  it('returns SVG data URLs with charset unchanged', async () => {
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E';
    const result = await generatePreviewDataUrl(svgDataUrl);
    expect(result).toBe(svgDataUrl);
  });

  it('returns the original data URL in non-browser environments (no Image constructor)', async () => {
    // JSDOM test environment lacks real Image constructor — the utility
    // detects this via the globalThis.Image / document check and falls back
    // to returning the original. This test verifies that fallback.
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await generatePreviewDataUrl(pngDataUrl);
    expect(result).toBe(pngDataUrl);
  });

  it('accepts a custom maxSize parameter', async () => {
    const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const result = await generatePreviewDataUrl(svgDataUrl, 400);
    expect(result).toBe(svgDataUrl);
  });
});
