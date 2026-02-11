import { StaticCanvas, FabricImage, FabricObject } from 'fabric';
import { CanvasTransform, PrintArea, LegacyPrintArea, RelativePoint } from '../types';

export function generateObjectId(): string {
  return crypto.randomUUID();
}

export async function setCanvasBackground(
  canvas: StaticCanvas,
  imageUrl: string,
  fitMode: 'cover' | 'contain' | 'fill' = 'contain',
): Promise<void> {
  const img = await FabricImage.fromURL(imageUrl);
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  let scaleX: number;
  let scaleY: number;

  if (fitMode === 'fill') {
    scaleX = canvasWidth / (img.width ?? canvasWidth);
    scaleY = canvasHeight / (img.height ?? canvasHeight);
  } else {
    const imgWidth = img.width ?? canvasWidth;
    const imgHeight = img.height ?? canvasHeight;
    const scale = fitMode === 'contain'
      ? Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight)
      : Math.max(canvasWidth / imgWidth, canvasHeight / imgHeight);
    scaleX = scale;
    scaleY = scale;

    // In contain mode, resize canvas to match scaled image so there's no letterboxing
    if (fitMode === 'contain') {
      const fittedWidth = imgWidth * scale;
      const fittedHeight = imgHeight * scale;
      canvas.setDimensions({ width: fittedWidth, height: fittedHeight });
    }
  }

  const finalWidth = canvas.getWidth();
  const finalHeight = canvas.getHeight();

  img.set({
    scaleX,
    scaleY,
    originX: 'center',
    originY: 'center',
    left: finalWidth / 2,
    top: finalHeight / 2,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });

  // Remove existing background image if any
  const objects = canvas.getObjects();
  const existingBg = objects.find(o => (o as FabricObject & { _isBackground?: boolean })._isBackground === true);
  if (existingBg !== undefined) canvas.remove(existingBg);

  (img as FabricObject & { _isBackground?: boolean })._isBackground = true;
  canvas.insertAt(0, img);
  canvas.renderAll();
}

/** Convert PrintArea corner coordinates (0-1) to absolute pixel positions. */
export function printAreaToPixelCorners(
  pa: PrintArea,
  canvasW: number,
  canvasH: number,
): [RelativePoint, RelativePoint, RelativePoint, RelativePoint] {
  return [
    { x: pa.topLeft.x * canvasW, y: pa.topLeft.y * canvasH },
    { x: pa.topRight.x * canvasW, y: pa.topRight.y * canvasH },
    { x: pa.bottomRight.x * canvasW, y: pa.bottomRight.y * canvasH },
    { x: pa.bottomLeft.x * canvasW, y: pa.bottomLeft.y * canvasH },
  ];
}

/** Convert absolute pixel corner positions back to 0-1 relative PrintArea. */
export function pixelCornersToPrintArea(
  corners: [RelativePoint, RelativePoint, RelativePoint, RelativePoint],
  canvasW: number,
  canvasH: number,
  bulge: number = 0,
): PrintArea {
  return {
    topLeft: { x: corners[0].x / canvasW, y: corners[0].y / canvasH },
    topRight: { x: corners[1].x / canvasW, y: corners[1].y / canvasH },
    bottomRight: { x: corners[2].x / canvasW, y: corners[2].y / canvasH },
    bottomLeft: { x: corners[3].x / canvasW, y: corners[3].y / canvasH },
    ...(bulge !== 0 ? { bulge } : {}),
  };
}

/**
 * Convert a legacy center+dimensions print area to the 4-corner format.
 * Applies taper, skew, and rotation in 0-1 coordinate space.
 */
export function legacyToPrintArea(legacy: LegacyPrintArea): PrintArea {
  const { x, y, width, height, angle = 0, skewX = 0, skewY = 0, taper = 0, bulge = 0 } = legacy;
  const halfW = width / 2;
  const halfH = height / 2;
  const topHalfW = halfW * (1 - taper);

  // Local corners (relative to center, in 0-1 coords)
  let corners = [
    { x: -topHalfW, y: -halfH }, // TL
    { x: topHalfW, y: -halfH },  // TR
    { x: halfW, y: halfH },      // BR
    { x: -halfW, y: halfH },     // BL
  ];

  // Apply skew
  if (skewX !== 0 || skewY !== 0) {
    const tanSkX = Math.tan(skewX * Math.PI / 180);
    const tanSkY = Math.tan(skewY * Math.PI / 180);
    corners = corners.map(c => ({
      x: c.x + c.y * tanSkX,
      y: c.y + c.x * tanSkY,
    }));
  }

  // Apply rotation
  if (angle !== 0) {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    corners = corners.map(c => ({
      x: c.x * cos - c.y * sin,
      y: c.x * sin + c.y * cos,
    }));
  }

  // Translate to center
  return {
    topLeft: { x: x + corners[0].x, y: y + corners[0].y },
    topRight: { x: x + corners[1].x, y: y + corners[1].y },
    bottomRight: { x: x + corners[2].x, y: y + corners[2].y },
    bottomLeft: { x: x + corners[3].x, y: y + corners[3].y },
    ...(bulge !== 0 ? { bulge } : {}),
  };
}

/** Returns a default centered print area (30% width x 35% height rectangle). */
export function defaultPrintArea(): PrintArea {
  return {
    topLeft: { x: 0.35, y: 0.325 },
    topRight: { x: 0.65, y: 0.325 },
    bottomRight: { x: 0.65, y: 0.675 },
    bottomLeft: { x: 0.35, y: 0.675 },
  };
}

/**
 * Compute a CanvasTransform to fit a logo within a 4-corner print area.
 * Uses the centroid for position, average edge lengths for dimensions,
 * and the bottom edge angle for rotation.
 */
export function fitLogoToPrintArea(
  logoWidth: number,
  logoHeight: number,
  printArea: PrintArea,
  canvasWidth: number,
  canvasHeight: number,
): CanvasTransform {
  const [tl, tr, br, bl] = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);

  // Centroid
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;

  // Average edge lengths for effective width/height
  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);

  const avgWidth = (topLen + botLen) / 2;
  const avgHeight = (leftLen + rightLen) / 2;

  // Angle from bottom edge
  const angle = Math.atan2(br.y - bl.y, br.x - bl.x) * 180 / Math.PI;

  const scale = Math.min(avgWidth / logoWidth, avgHeight / logoHeight);

  return {
    x: cx,
    y: cy,
    scaleX: scale,
    scaleY: scale,
    angle,
  };
}

/**
 * Warp a logo image to follow the bulge curvature of a print area.
 * Slices the image into vertical strips and displaces each vertically
 * according to the same quadratic Bezier curve used by the print area outline.
 */
export function warpImageForBulge(
  sourceImg: HTMLImageElement | HTMLCanvasElement,
  bulge: number,
  areaHeight: number,
  logoScale: number,
): HTMLCanvasElement {
  const w = sourceImg.width;
  const h = sourceImg.height;

  // Max displacement at center (t=0.5): 0.5 * |bulge| * areaHeight / logoScale
  const maxAbsDy = Math.ceil(Math.abs(0.5 * bulge * areaHeight / logoScale)) + 1;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + maxAbsDy * 2;
  const ctx = canvas.getContext('2d')!;

  for (let x = 0; x < w; x++) {
    const t = w > 1 ? x / (w - 1) : 0.5;
    // Displacement matching the quadratic Bezier control-point shift in PrintAreaQuad._render:
    // control point is at midY - bulge * areaHeight, Bezier weight at parameter t is 2t(1-t)
    const dy = -2 * t * (1 - t) * bulge * areaHeight / logoScale;
    ctx.drawImage(sourceImg, x, 0, 1, h, x, maxAbsDy + dy, 1, h);
  }

  return canvas;
}

/**
 * Upscale an SVG data URL so the browser rasterizes it at high resolution.
 * SVGs loaded via `<img src>` are rasterized at their intrinsic dimensions
 * (from viewBox or width/height attributes), which are often small. This
 * function sets explicit width/height on the root `<svg>` element to ensure
 * high-resolution rasterization when loaded into Fabric.js.
 *
 * Returns the (possibly modified) data URL and the uniform scale factor applied.
 * For non-SVG data URLs, returns the input unchanged with scaleApplied = 1.
 */
export function upscaleSvgDataUrl(svgDataUrl: string, maxSize: number = 4000): { dataUrl: string; scaleApplied: number } {
  if (!svgDataUrl.startsWith('data:image/svg+xml')) {
    return { dataUrl: svgDataUrl, scaleApplied: 1 };
  }

  // Decode SVG content from data URL
  let svgText: string;
  const base64Idx = svgDataUrl.indexOf(';base64,');
  if (base64Idx !== -1) {
    svgText = atob(svgDataUrl.slice(base64Idx + 8));
  } else {
    const commaIdx = svgDataUrl.indexOf(',');
    if (commaIdx === -1) return { dataUrl: svgDataUrl, scaleApplied: 1 };
    svgText = decodeURIComponent(svgDataUrl.slice(commaIdx + 1));
  }

  // Parse SVG document
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (svgEl.tagName !== 'svg') return { dataUrl: svgDataUrl, scaleApplied: 1 };

  // Determine intrinsic dimensions from viewBox or width/height attributes
  const viewBox = svgEl.getAttribute('viewBox');
  let intrinsicW: number;
  let intrinsicH: number;

  if (viewBox !== null) {
    const parts = viewBox.trim().split(/[\s,]+/);
    intrinsicW = parseFloat(parts[2]) || 0;
    intrinsicH = parseFloat(parts[3]) || 0;
  } else {
    intrinsicW = parseFloat(svgEl.getAttribute('width') || '') || 0;
    intrinsicH = parseFloat(svgEl.getAttribute('height') || '') || 0;
  }

  if (intrinsicW <= 0 || intrinsicH <= 0) return { dataUrl: svgDataUrl, scaleApplied: 1 };

  // Skip if already large enough
  const maxDim = Math.max(intrinsicW, intrinsicH);
  if (maxDim >= maxSize) return { dataUrl: svgDataUrl, scaleApplied: 1 };

  // Compute scale factor and target dimensions
  const scale = maxSize / maxDim;
  const targetW = Math.round(intrinsicW * scale);
  const targetH = Math.round(intrinsicH * scale);

  // Set explicit width/height and ensure viewBox is present for proper scaling
  svgEl.setAttribute('width', String(targetW));
  svgEl.setAttribute('height', String(targetH));
  if (viewBox === null) {
    svgEl.setAttribute('viewBox', `0 0 ${intrinsicW} ${intrinsicH}`);
  }

  // Serialize and re-encode as base64 data URL
  const newSvgText = new XMLSerializer().serializeToString(doc);
  const bytes = new TextEncoder().encode(newSvgText);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { dataUrl: 'data:image/svg+xml;base64,' + btoa(binary), scaleApplied: scale };
}

/**
 * Trim excess whitespace from an SVG by adjusting its viewBox to the actual content bounds.
 * Uses `getBBox()` which requires the SVG to be temporarily inserted into the DOM.
 * Returns the input unchanged for non-SVG data URLs or when trimming is not possible.
 */
export async function trimSvgWhitespace(svgDataUrl: string, padding: number = 1): Promise<string> {
  if (!svgDataUrl.startsWith('data:image/svg+xml')) {
    return svgDataUrl;
  }

  // Decode SVG content from data URL
  let svgText: string;
  const base64Idx = svgDataUrl.indexOf(';base64,');
  if (base64Idx !== -1) {
    svgText = atob(svgDataUrl.slice(base64Idx + 8));
  } else {
    const commaIdx = svgDataUrl.indexOf(',');
    if (commaIdx === -1) return svgDataUrl;
    svgText = decodeURIComponent(svgDataUrl.slice(commaIdx + 1));
  }

  // Parse SVG document
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (svgEl.tagName !== 'svg') return svgDataUrl;

  // Insert SVG offscreen to enable getBBox()
  const container = document.createElement('div');
  container.style.cssText = 'visibility:hidden;position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden';
  container.appendChild(svgEl);
  document.body.appendChild(container);

  let bbox: { x: number; y: number; width: number; height: number };
  try {
    bbox = (svgEl as unknown as SVGSVGElement).getBBox();
  } catch {
    container.remove();
    return svgDataUrl;
  }

  container.remove();

  // Graceful fallback: if getBBox returned zeros (e.g. JSDOM), skip trimming
  if (bbox.width <= 0 || bbox.height <= 0) {
    return svgDataUrl;
  }

  // Check if trimming is needed by comparing to existing viewBox
  const existingVB = svgEl.getAttribute('viewBox');
  if (existingVB !== null) {
    const parts = existingVB.trim().split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      Math.abs(parts[0] - bbox.x) < 1 &&
      Math.abs(parts[1] - bbox.y) < 1 &&
      Math.abs(parts[2] - bbox.width) < 1 &&
      Math.abs(parts[3] - bbox.height) < 1
    ) {
      return svgDataUrl;
    }
  }

  // Apply trimmed viewBox with padding
  const newVB = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + 2 * padding} ${bbox.height + 2 * padding}`;
  svgEl.setAttribute('viewBox', newVB);

  // Update width/height to match new aspect ratio
  const newW = bbox.width + 2 * padding;
  const newH = bbox.height + 2 * padding;
  svgEl.setAttribute('width', String(newW));
  svgEl.setAttribute('height', String(newH));

  // Re-attach svgEl to doc for serialization (it was moved to container)
  if (svgEl.parentNode !== doc) {
    doc.appendChild(svgEl);
  }

  // Serialize and re-encode as base64 data URL
  const newSvgText = new XMLSerializer().serializeToString(doc);
  const bytes = new TextEncoder().encode(newSvgText);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:image/svg+xml;base64,' + btoa(binary);
}

export async function addLogoToCanvas(
  canvas: StaticCanvas,
  logoDataUrl: string,
  transform: CanvasTransform,
  id: string,
): Promise<FabricObject> {
  const { dataUrl, scaleApplied } = upscaleSvgDataUrl(logoDataUrl);
  const img = await FabricImage.fromURL(dataUrl);

  img.set({
    left: transform.x,
    top: transform.y,
    scaleX: transform.scaleX / scaleApplied,
    scaleY: transform.scaleY / scaleApplied,
    angle: transform.angle,
    skewX: transform.skewX ?? 0,
    skewY: transform.skewY ?? 0,
    originX: 'center',
    originY: 'center',
  });

  (img as FabricObject & { _objectId?: string })._objectId = id;

  canvas.add(img);
  canvas.renderAll();

  return img;
}
