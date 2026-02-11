/** Utility functions for the HTML/CSS-based logo renderer and Canvas 2D export. */

import { CanvasTransform } from '../types';

/** Load an image from a URL/data-URL and return the HTMLImageElement once loaded. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

/** Compute contain-fit dimensions (uniform scale to fit inside container). */
export function computeContainFit(
  containerW: number,
  containerH: number,
  imgW: number,
  imgH: number,
): { fittedW: number; fittedH: number } {
  const scale = Math.min(containerW / imgW, containerH / imgH);
  return { fittedW: imgW * scale, fittedH: imgH * scale };
}

/**
 * Convert a Fabric.js center-origin transform to CSS top-left positioning.
 * Fabric.js stores x/y as the center of the object. CSS `transform-origin: center`
 * means the origin is at the center of the unscaled element box, so left/top are
 * computed by subtracting half the *natural* (unscaled) dimensions.
 */
export function centerOriginToTopLeft(
  transform: CanvasTransform,
  naturalW: number,
  naturalH: number,
): { left: number; top: number } {
  return {
    left: transform.x - naturalW / 2,
    top: transform.y - naturalH / 2,
  };
}

/**
 * Parse an SVG data URL to extract intrinsic dimensions from viewBox or width/height attributes.
 * Returns null if the data URL is not SVG or dimensions cannot be determined.
 */
export function getSvgIntrinsicSize(svgDataUrl: string): { width: number; height: number } | null {
  if (!svgDataUrl.startsWith('data:image/svg+xml')) return null;

  let svgText: string;
  const base64Idx = svgDataUrl.indexOf(';base64,');
  if (base64Idx !== -1) {
    svgText = atob(svgDataUrl.slice(base64Idx + 8));
  } else {
    const commaIdx = svgDataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    svgText = decodeURIComponent(svgDataUrl.slice(commaIdx + 1));
  }

  // Use regex instead of DOMParser to avoid JSDOM/mock-doc XML parsing limitations
  const svgMatch = svgText.match(/<svg[^>]*>/i);
  if (svgMatch === null) return null;
  const svgTag = svgMatch[0];

  const viewBoxMatch = svgTag.match(/viewBox=["']([^"']+)["']/);
  if (viewBoxMatch !== null) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/);
    const vbW = parseFloat(parts[2]);
    const vbH = parseFloat(parts[3]);
    if (vbW > 0 && vbH > 0) return { width: vbW, height: vbH };
  }

  const widthMatch = svgTag.match(/\bwidth=["']([^"']+)["']/);
  const heightMatch = svgTag.match(/\bheight=["']([^"']+)["']/);
  if (widthMatch !== null && heightMatch !== null) {
    const svgW = parseFloat(widthMatch[1]);
    const svgH = parseFloat(heightMatch[1]);
    if (svgW > 0 && svgH > 0) return { width: svgW, height: svgH };
  }

  return null;
}

export interface RenderLayer {
  img: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  skewX: number;
  skewY: number;
}

/**
 * Canvas 2D export: draw product background + logo layers onto a plain canvas.
 * Returns a data URL string.
 */
export function renderToCanvas(
  containerW: number,
  containerH: number,
  bgColor: string,
  productImg: HTMLImageElement | undefined,
  layers: RenderLayer[],
  format: 'png' | 'jpeg' = 'png',
  quality: number = 1,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = containerW;
  canvas.height = containerH;
  const ctx = canvas.getContext('2d')!;

  // Background color
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, containerW, containerH);

  // Product image (contain-fit, centered)
  if (productImg !== undefined) {
    const { fittedW, fittedH } = computeContainFit(containerW, containerH, productImg.naturalWidth, productImg.naturalHeight);
    const ox = (containerW - fittedW) / 2;
    const oy = (containerH - fittedH) / 2;
    ctx.drawImage(productImg, ox, oy, fittedW, fittedH);
  }

  // Logo layers
  for (const layer of layers) {
    ctx.save();

    // Move to the center of the object (top-left + half natural size, matching CSS transform-origin: center)
    const cx = layer.left + layer.naturalWidth / 2;
    const cy = layer.top + layer.naturalHeight / 2;
    ctx.translate(cx, cy);

    // Apply transforms in Fabric.js order: rotate → skew → scale
    ctx.rotate((layer.angle * Math.PI) / 180);
    const tanSkX = Math.tan((layer.skewX * Math.PI) / 180);
    const tanSkY = Math.tan((layer.skewY * Math.PI) / 180);
    ctx.transform(1, tanSkY, tanSkX, 1, 0, 0);
    ctx.scale(layer.scaleX, layer.scaleY);

    // Draw image centered at origin
    ctx.drawImage(layer.img, -layer.naturalWidth / 2, -layer.naturalHeight / 2, layer.naturalWidth, layer.naturalHeight);

    ctx.restore();
  }

  return canvas.toDataURL(`image/${format}`, quality);
}
