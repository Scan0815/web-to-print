import { validateLogo } from './logo-validation';
import { LogoValidationConfig } from '../types';

// Minimal PNG: 1x1 white pixel (no EXIF data)
const MINIMAL_PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // compressed data
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // ...
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
  0x44, 0xae, 0x42, 0x60, 0x82,
];

function createMockPng(name = 'test.png'): File {
  return new File([new Uint8Array(MINIMAL_PNG_BYTES)], name, { type: 'image/png' });
}

function createMockSvg(content?: string): File {
  const svg = content ?? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect/></svg>';
  return new File([svg], 'test.svg', { type: 'image/svg+xml' });
}

const testConfig: LogoValidationConfig = {
  minDpi: 300,
  maxFileSize: 50 * 1024 * 1024,
  minWidth: 100,
  minHeight: 100,
  allowedFormats: ['png', 'jpeg', 'svg', 'pdf', 'tiff', 'avif'],
};

describe('validateLogo', () => {
  it('validates a valid SVG', async () => {
    const file = createMockSvg();
    const result = await validateLogo(file, testConfig);
    expect(result.valid).toBe(true);
    expect(result.metadata.format).toBe('svg');
    expect(result.metadata.width).toBe(200);
    expect(result.metadata.height).toBe(200);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects disallowed format', async () => {
    const file = new File([new Uint8Array([0x00])], 'test.bmp', { type: 'image/bmp' });
    const config = { ...testConfig, allowedFormats: ['png' as const, 'jpeg' as const] };
    const result = await validateLogo(file, config);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'FORMAT_NOT_ALLOWED')).toBe(true);
  });

  it('rejects oversized files', async () => {
    const file = createMockSvg();
    const config = { ...testConfig, maxFileSize: 1 }; // 1 byte max
    const result = await validateLogo(file, config);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'FILE_TOO_LARGE')).toBe(true);
  });

  it('warns about unknown DPI for raster images', async () => {
    const file = createMockPng();
    // In JSDOM, Image doesn't load blobs, so dimensions will be 0
    const result = await validateLogo(file, testConfig);
    expect(result.metadata.format).toBe('png');
    expect(result.issues.some(i => i.code === 'DPI_UNKNOWN')).toBe(true);
    // DPI_UNKNOWN is a warning, so the file is still valid if no other errors
    const dpiIssue = result.issues.find(i => i.code === 'DPI_UNKNOWN');
    expect(dpiIssue?.severity).toBe('warning');
  });

  it('rejects SVG with invalid content', async () => {
    const file = new File(['<html>not svg</html>'], 'fake.svg', { type: 'image/svg+xml' });
    const result = await validateLogo(file, testConfig);
    expect(result.issues.some(i => i.code === 'INVALID_SVG')).toBe(true);
  });

  it('detects SVG dimensions from viewBox', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300"></svg>';
    const file = new File([svg], 'test.svg', { type: 'image/svg+xml' });
    const result = await validateLogo(file, testConfig);
    expect(result.metadata.width).toBe(500);
    expect(result.metadata.height).toBe(300);
  });

  it('does not reject small SVG dimensions (vectors are resolution-independent)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="50" height="50"></svg>';
    const file = new File([svg], 'small.svg', { type: 'image/svg+xml' });
    const result = await validateLogo(file, testConfig);
    expect(result.valid).toBe(true);
    expect(result.issues.some(i => i.code === 'WIDTH_TOO_SMALL')).toBe(false);
    expect(result.issues.some(i => i.code === 'HEIGHT_TOO_SMALL')).toBe(false);
  });

  it('detects PDF format', async () => {
    const file = new File(['%PDF-1.7 fake content'], 'test.pdf', { type: 'application/pdf' });
    const result = await validateLogo(file, testConfig);
    expect(result.metadata.format).toBe('pdf');
  });

  it('returns correct metadata structure', async () => {
    const file = createMockSvg();
    const result = await validateLogo(file, testConfig);
    expect(result.metadata).toEqual(expect.objectContaining({
      format: 'svg',
      fileName: 'test.svg',
      mimeType: 'image/svg+xml',
      hasTransparency: true,
    }));
  });
});
