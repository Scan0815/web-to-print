const DEFAULT_MAX_SIZE = 800;

/**
 * Returns true if the data URL contains an SVG image (image/svg+xml).
 */
function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:image/svg+xml');
}

/**
 * Generate a downscaled preview data URL from a full-resolution data URL.
 *
 * - SVG data URLs are returned unchanged (vectors are compact and scale-independent).
 * - Raster images are downscaled so the longest side is at most `maxSize` pixels.
 *   If the image is already smaller, the original is returned unchanged.
 * - Output is PNG to preserve transparency.
 *
 * @param dataUrl  Full-resolution data URL
 * @param maxSize  Maximum pixel dimension for the longest side (default: 800)
 * @returns  Downscaled PNG data URL, or the original for SVGs / small images
 */
export async function generatePreviewDataUrl(dataUrl: string, maxSize: number = DEFAULT_MAX_SIZE): Promise<string> {
  if (isSvgDataUrl(dataUrl)) {
    return dataUrl;
  }

  // Browser-only: requires Image and canvas
  if (typeof globalThis.Image === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }

  const img = await loadImageElement(dataUrl);
  const { width, height } = img;

  // Already within bounds — no scaling needed
  if (width <= maxSize && height <= maxSize) {
    return dataUrl;
  }

  const scale = maxSize / Math.max(width, height);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return dataUrl;
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/png');
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for preview generation'));
    img.src = src;
  });
}
