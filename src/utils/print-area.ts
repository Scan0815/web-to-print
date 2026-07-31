import type { ArticleView, CoordinateImageSize, PrintArea } from '../types/editor';

/**
 * Print areas are defined in relative 0-1 coordinates, but supplier catalogs deliver
 * pixel coordinates relative to a source image. Relative coordinates are never above 1,
 * so any coordinate greater than 1 means the area is still in pixels.
 */
export function isPixelPrintArea(area: PrintArea): boolean {
  return [area.topLeft, area.topRight, area.bottomRight, area.bottomLeft].some(p => p.x > 1 || p.y > 1);
}

/** Converts a pixel print area to relative 0-1 coordinates. Relative areas pass through. */
export function normalizePrintArea(area: PrintArea, imageWidth: number, imageHeight: number): PrintArea {
  if (!isPixelPrintArea(area)) return area;
  if (imageWidth <= 0 || imageHeight <= 0) return area;

  const normalized: PrintArea = {
    topLeft: { x: area.topLeft.x / imageWidth, y: area.topLeft.y / imageHeight },
    topRight: { x: area.topRight.x / imageWidth, y: area.topRight.y / imageHeight },
    bottomRight: { x: area.bottomRight.x / imageWidth, y: area.bottomRight.y / imageHeight },
    bottomLeft: { x: area.bottomLeft.x / imageWidth, y: area.bottomLeft.y / imageHeight },
  };
  if (area.bulge != null && area.bulge !== 0) normalized.bulge = area.bulge;
  return normalized;
}

/** Loads the natural dimensions of an image, or null when it cannot be loaded. */
export function loadImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof globalThis.Image !== 'function') return Promise.resolve(null);

  return new Promise(resolve => {
    const img = new globalThis.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Falls back to the declared coordinate size when the image itself cannot be measured.
 * Catalogs usually declare only the longest side, so the other one is approximated.
 */
function fallbackDimensions(size: CoordinateImageSize | undefined): { width: number; height: number } | null {
  if (size == null) return null;
  if (size.longestSide === 'width' && size.width != null) {
    return { width: size.width, height: size.height ?? size.width };
  }
  if (size.longestSide === 'height' && size.height != null) {
    return { width: size.width ?? size.height, height: size.height };
  }
  return null;
}

/**
 * Returns the view's print area in relative 0-1 coordinates, loading the product image
 * only when the area still holds pixel coordinates.
 */
export async function resolveViewPrintArea(view: ArticleView): Promise<PrintArea | null> {
  const area = view.printArea;
  if (area == null || !isPixelPrintArea(area)) return area;

  const dimensions = (await loadImageDimensions(view.image)) ?? fallbackDimensions(view.coordinateImageSize);
  if (dimensions == null) return area;

  return normalizePrintArea(area, dimensions.width, dimensions.height);
}
