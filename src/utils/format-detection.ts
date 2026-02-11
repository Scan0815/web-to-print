import { LogoFormat } from '../types';

const MAGIC_BYTES: { format: LogoFormat; bytes: number[]; offset?: number }[] = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'tiff', bytes: [0x49, 0x49, 0x2a, 0x00] }, // Little-endian
  { format: 'tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // Big-endian
  { format: 'avif', bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], offset: 4 }, // ISO BMFF "ftypavif"
];

export function mimeToFormat(mime: string): LogoFormat {
  const map: Record<string, LogoFormat> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'image/avif': 'avif',
  };
  return map[mime] ?? 'unknown';
}

export function isSvgContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<svg');
}

function matchMagicBytes(bytes: Uint8Array): LogoFormat | null {
  for (const entry of MAGIC_BYTES) {
    const offset = entry.offset ?? 0;
    if (bytes.length < offset + entry.bytes.length) continue;
    const match = entry.bytes.every((b, i) => bytes[offset + i] === b);
    if (match) return entry.format;
  }
  return null;
}

export async function detectFileFormat(file: File): Promise<LogoFormat> {
  // Try magic bytes first (most reliable)
  const buffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const magicFormat = matchMagicBytes(bytes);
  if (magicFormat !== null) return magicFormat;

  // Check for SVG by reading text content
  if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
    const text = await file.text();
    if (isSvgContent(text)) return 'svg';
  }

  // Fallback to MIME type
  return mimeToFormat(file.type);
}
