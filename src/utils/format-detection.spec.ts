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

describe('PDF and AI detection', () => {
  function fileFrom(bytes: number[], name: string, type = ''): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

  it('detects PDF from the %PDF header', async () => {
    expect(await detectFileFormat(fileFrom(PDF_HEADER, 'logo.pdf', 'application/pdf'))).toBe('pdf');
  });

  it('detects AI files, which carry the same PDF header', async () => {
    expect(await detectFileFormat(fileFrom(PDF_HEADER, 'logo.ai', 'application/pdf'))).toBe('ai');
  });

  it('detects AI files without a PDF header from the extension', async () => {
    expect(await detectFileFormat(fileFrom([0x00, 0x01, 0x02, 0x03], 'legacy.ai'))).toBe('ai');
  });

  it('maps the PDF mime type', () => {
    expect(mimeToFormat('application/pdf')).toBe('pdf');
  });

  it('maps the Illustrator mime type', () => {
    expect(mimeToFormat('application/illustrator')).toBe('ai');
  });

  it('does not treat PostScript as Illustrator — EPS is not renderable', () => {
    expect(mimeToFormat('application/postscript')).toBe('unknown');
  });

  it('leaves .eps files unknown so they are rejected outright', async () => {
    const eps = new File([new Uint8Array([0x25, 0x21, 0x50, 0x53])], 'logo.eps', { type: 'application/postscript' });
    expect(await detectFileFormat(eps)).toBe('unknown');
  });
});
