import { detectFileFormat, mimeToFormat, isSvgContent } from './format-detection';

function createFileFromBytes(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function createFileFromString(content: string, name: string, type: string): File {
  return new File([content], name, { type });
}

describe('mimeToFormat', () => {
  it('maps known MIME types', () => {
    expect(mimeToFormat('image/png')).toBe('png');
    expect(mimeToFormat('image/jpeg')).toBe('jpeg');
    expect(mimeToFormat('image/svg+xml')).toBe('svg');
    expect(mimeToFormat('image/tiff')).toBe('tiff');
    expect(mimeToFormat('image/avif')).toBe('avif');
  });

  it('returns unknown for unrecognized types', () => {
    expect(mimeToFormat('text/plain')).toBe('unknown');
    expect(mimeToFormat('')).toBe('unknown');
  });
});

describe('isSvgContent', () => {
  it('detects SVG with xml declaration', () => {
    expect(isSvgContent('<?xml version="1.0"?><svg></svg>')).toBe(true);
  });

  it('detects SVG starting with svg tag', () => {
    expect(isSvgContent('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
  });

  it('detects SVG with leading whitespace', () => {
    expect(isSvgContent('  \n<svg></svg>')).toBe(true);
  });

  it('rejects non-SVG content', () => {
    expect(isSvgContent('<html lang="en"></html>')).toBe(false);
    expect(isSvgContent('hello world')).toBe(false);
  });
});

describe('detectFileFormat', () => {
  it('detects PNG by magic bytes', async () => {
    const file = createFileFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'test.png', 'image/png');
    expect(await detectFileFormat(file)).toBe('png');
  });

  it('detects JPEG by magic bytes', async () => {
    const file = createFileFromBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'test.jpg', 'image/jpeg');
    expect(await detectFileFormat(file)).toBe('jpeg');
  });

  it('detects TIFF little-endian', async () => {
    const file = createFileFromBytes([0x49, 0x49, 0x2a, 0x00], 'test.tiff', 'image/tiff');
    expect(await detectFileFormat(file)).toBe('tiff');
  });

  it('detects TIFF big-endian', async () => {
    const file = createFileFromBytes([0x4d, 0x4d, 0x00, 0x2a], 'test.tiff', 'image/tiff');
    expect(await detectFileFormat(file)).toBe('tiff');
  });

  it('detects SVG by content', async () => {
    const file = createFileFromString('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>', 'test.svg', 'image/svg+xml');
    expect(await detectFileFormat(file)).toBe('svg');
  });

  it('detects AVIF by magic bytes', async () => {
    // ISO BMFF box: size (4 bytes) + "ftypavif"
    const file = createFileFromBytes([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 'test.avif', 'image/avif');
    expect(await detectFileFormat(file)).toBe('avif');
  });

  it('falls back to MIME type for unknown magic bytes', async () => {
    const file = createFileFromBytes([0x00, 0x00, 0x00], 'test.png', 'image/png');
    expect(await detectFileFormat(file)).toBe('png');
  });

  it('returns unknown for completely unrecognized files', async () => {
    const file = createFileFromBytes([0x00, 0x00, 0x00], 'test.bin', 'application/octet-stream');
    expect(await detectFileFormat(file)).toBe('unknown');
  });
});
