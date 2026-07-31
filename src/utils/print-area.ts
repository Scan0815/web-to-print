import type { ArticleView, CoordinateImageSize, PrintArea } from '../types/editor';
import { isPixelPrintArea, normalizePrintArea } from './canvas-helpers';

// The pixel/relative conversion itself lives in canvas-helpers; this module adds the
// view-level resolution on top of it.
export { isPixelPrintArea, normalizePrintArea };

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
  // Returning the pixel area would place logos and guides using nonsense geometry —
  // callers treat a PrintArea as 0-1. No print area is the honest answer.
  if (dimensions == null) return null;

  return normalizePrintArea(area, dimensions.width, dimensions.height);
}
