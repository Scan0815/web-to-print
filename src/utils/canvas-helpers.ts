import { StaticCanvas, FabricImage, FabricObject } from 'fabric';
import { CanvasTransform, PrintArea, LegacyPrintArea, RelativePoint } from '../types';

export function generateObjectId(): string {
  return crypto.randomUUID();
}

/**
 * Fabric objects carry two properties of ours. They live on the object itself because
 * that is what survives `toObject(['_objectId'])` and comes back through `loadFromJSON`;
 * these accessors keep the cast in one place instead of at every use.
 */
interface TaggedFabricObject extends FabricObject {
  _objectId?: string;
  _isBackground?: boolean;
}

/** The editor's stable id for an object, or undefined for objects it did not place. */
export function getObjectId(obj: FabricObject): string | undefined {
  const id = (obj as TaggedFabricObject)._objectId;
  return id === undefined || id === '' ? undefined : id;
}

export function setObjectId(obj: FabricObject, id: string): void {
  (obj as TaggedFabricObject)._objectId = id;
}

/** True for the product image, which is a canvas object but never part of the design. */
export function isBackgroundObject(obj: FabricObject): boolean {
  return (obj as TaggedFabricObject)._isBackground === true;
}

export function markAsBackground(obj: FabricObject): void {
  (obj as TaggedFabricObject)._isBackground = true;
}

const IMAGE_PROXY_BASE = 'http://localhost:3001';

/**
 * Which loading strategy worked for a URL, so switching back and forth between
 * decorations does not repeat a failing CORS request and a proxy connection that is
 * refused in production.
 */
type ImageStrategy = 'cors' | 'proxy' | 'plain';

interface ImageRoute {
  strategy: ImageStrategy;
  /** When this route was recorded — only consulted for `plain`, see `isRouteUsable`. */
  recordedAt: number;
}

const imageStrategies: Map<string, ImageRoute> = new Map();

/**
 * How long the `plain` last resort is trusted before the good routes are tried again.
 *
 * Long enough to cover the burst of loads that view switching produces, short enough that
 * a session still open when the shop fixes its CORS headers picks that up.
 */
export const PLAIN_RETRY_AFTER_MS = 60_000;

/**
 * Whether a remembered route may be reused.
 *
 * `cors` and `proxy` retire themselves: when they stop working they throw, and the caller
 * drops them. `plain` cannot — it never throws, it just taints the canvas and blocks every
 * export. Without an expiry, one CORS failure would keep a session degraded for as long as
 * it stays open, however long after the cause was fixed.
 */
export function isRouteUsable(route: ImageRoute, now: number): boolean {
  return route.strategy !== 'plain' || now - route.recordedAt < PLAIN_RETRY_AFTER_MS;
}

function proxyUrlFor(url: string): string {
  return `${IMAGE_PROXY_BASE}/?url=${encodeURIComponent(url)}`;
}

async function loadWithStrategy(url: string, strategy: ImageStrategy): Promise<FabricImage> {
  if (strategy === 'cors') return FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
  if (strategy === 'proxy') return FabricImage.fromURL(proxyUrlFor(url), { crossOrigin: 'anonymous' });
  return FabricImage.fromURL(url);
}

/** Load a FabricImage from a URL, trying CORS → local proxy → plain load (tainted). */
async function loadFabricImage(url: string): Promise<FabricImage> {
  // Data URLs and blob URLs are always same-origin
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return FabricImage.fromURL(url);
  }

  const known = imageStrategies.get(url);
  if (known !== undefined && isRouteUsable(known, Date.now())) {
    try {
      return await loadWithStrategy(url, known.strategy);
    } catch {
      // The remembered route stopped working — fall through and probe again.
      imageStrategies.delete(url);
    }
  }

  for (const strategy of ['cors', 'proxy'] as const) {
    try {
      const img = await loadWithStrategy(url, strategy);
      imageStrategies.set(url, { strategy, recordedAt: Date.now() });
      return img;
    } catch { /* try the next route */ }
  }

  // Fallback: load without CORS (canvas will be tainted, export blocked). The timestamp
  // restarts the cooldown, so a URL that stays broken is probed once a minute, not once
  // per view switch.
  imageStrategies.set(url, { strategy: 'plain', recordedAt: Date.now() });
  return FabricImage.fromURL(url);
}

/** Forgets the remembered loading routes. Exposed for tests. */
export function clearImageStrategyCache(): void {
  imageStrategies.clear();
}

/** Removes the product image, leaving the customer's objects in place. */
export function clearCanvasBackground(canvas: StaticCanvas): void {
  const existing = canvas.getObjects().find(isBackgroundObject);
  if (existing !== undefined) canvas.remove(existing);
}

export async function setCanvasBackground(
  canvas: StaticCanvas,
  imageUrl: string,
  fitMode: 'cover' | 'contain' | 'fill' = 'contain',
): Promise<void> {
  const img = await loadFabricImage(imageUrl);
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

  clearCanvasBackground(canvas);
  markAsBackground(img);
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

/** Detect whether a PrintArea uses pixel coordinates (at least one value > 1). */
export function isPixelPrintArea(pa: PrintArea): boolean {
  return [pa.topLeft, pa.topRight, pa.bottomRight, pa.bottomLeft].some(p => p.x > 1 || p.y > 1);
}

/** Normalize a PrintArea from pixel coordinates to 0–1 relative values. Already-normalized areas are returned unchanged. */
export function normalizePrintArea(pa: PrintArea, imageWidth: number, imageHeight: number): PrintArea {
  if (!isPixelPrintArea(pa)) return pa;
  if (imageWidth <= 0 || imageHeight <= 0) return pa;
  return pixelCornersToPrintArea(
    [pa.topLeft, pa.topRight, pa.bottomRight, pa.bottomLeft],
    imageWidth,
    imageHeight,
    pa.bulge ?? 0,
  );
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
 * The print area's own coordinate system: centroid, half-extents along its local axes,
 * and its rotation.
 *
 * Everything that reasons about "inside the print area" has to use this same frame —
 * placement, the editor's drag clamp, and the geometry validations. A print area is any
 * quadrilateral and is printed straight, so comparing against its world-space bounding
 * box instead reports up to 1.41x the real size for a tilted one. Since it is a quad and
 * not a rectangle, it has no single width either; averaging opposite edges is the
 * effective size all three consumers agree on.
 */
export interface PrintAreaFrame {
  /** Centroid in canvas pixels. */
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  /** Rotation in radians, taken from the bottom edge. */
  angle: number;
  cos: number;
  sin: number;
}

export function printAreaFrame(printArea: PrintArea, canvasWidth: number, canvasHeight: number): PrintAreaFrame {
  const [tl, tr, br, bl] = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);

  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);

  const angle = Math.atan2(br.y - bl.y, br.x - bl.x);

  return {
    cx: (tl.x + tr.x + br.x + bl.x) / 4,
    cy: (tl.y + tr.y + br.y + bl.y) / 4,
    halfW: (topLen + botLen) / 4,
    halfH: (leftLen + rightLen) / 4,
    angle,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
  };
}

/** Half-extents of a rotated object projected onto the frame's axes. `angle` in degrees. */
export function projectOntoFrame(size: { width: number; height: number; angle: number }, frame: PrintAreaFrame): { halfW: number; halfH: number } {
  const relAngle = (size.angle * Math.PI) / 180 - frame.angle;
  const cos = Math.abs(Math.cos(relAngle));
  const sin = Math.abs(Math.sin(relAngle));

  return {
    halfW: (size.width * cos + size.height * sin) / 2,
    halfH: (size.width * sin + size.height * cos) / 2,
  };
}

/** A canvas point in the frame's local coordinates, with the origin at its centre. */
export function toFrameLocal(x: number, y: number, frame: PrintAreaFrame): RelativePoint {
  const relX = x - frame.cx;
  const relY = y - frame.cy;
  return { x: relX * frame.cos + relY * frame.sin, y: -relX * frame.sin + relY * frame.cos };
}

/** Inverse of `toFrameLocal`. */
export function fromFrameLocal(x: number, y: number, frame: PrintAreaFrame): RelativePoint {
  return { x: frame.cx + x * frame.cos - y * frame.sin, y: frame.cy + x * frame.sin + y * frame.cos };
}

/**
 * Holds an object inside the print area by shrinking it if it is too big, then sliding it
 * back in — all in the area's own frame, so a tilted decoration is not clamped against a
 * bounding box the customer cannot see. Background objects are left alone.
 *
 * Mutates the object in place, the way Fabric's `object:moving` handlers do.
 */
export function clampToPrintAreaFrame(obj: FabricObject, frame: PrintAreaFrame): void {
  if (isBackgroundObject(obj)) return;

  const sizeOf = (): { width: number; height: number; angle: number } => ({
    // The object's visual size, not getBoundingRect — that includes the control handles.
    width: (obj.width ?? 0) * (obj.scaleX ?? 1),
    height: (obj.height ?? 0) * (obj.scaleY ?? 1),
    angle: obj.angle ?? 0,
  });

  let projected = projectOntoFrame(sizeOf(), frame);

  if (projected.halfW > frame.halfW || projected.halfH > frame.halfH) {
    const scaleRatio = Math.min(frame.halfW / Math.max(projected.halfW, 1), frame.halfH / Math.max(projected.halfH, 1));
    obj.set({ scaleX: (obj.scaleX ?? 1) * scaleRatio, scaleY: (obj.scaleY ?? 1) * scaleRatio });
    obj.setCoords();
    projected = projectOntoFrame(sizeOf(), frame);
  }

  // getCenterPoint stays accurate for every originX/originY combination.
  obj.setCoords();
  const center = obj.getCenterPoint();
  const local = toFrameLocal(center.x, center.y, frame);

  const clampedX = Math.max(-frame.halfW + projected.halfW, Math.min(frame.halfW - projected.halfW, local.x));
  const clampedY = Math.max(-frame.halfH + projected.halfH, Math.min(frame.halfH - projected.halfH, local.y));
  if (clampedX === local.x && clampedY === local.y) return;

  const world = fromFrameLocal(clampedX, clampedY, frame);
  obj.set({ left: (obj.left ?? 0) + (world.x - center.x), top: (obj.top ?? 0) + (world.y - center.y) });
  obj.setCoords();
}

/** Draws the print area outline, its corners and its clamping box — debug mode only. */
export function drawPrintAreaOverlay(ctx: CanvasRenderingContext2D, printArea: PrintArea, canvasWidth: number, canvasHeight: number): void {
  const corners = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);

  ctx.save();

  // The quad outline — the actual print area shape.
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
  ctx.fill();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const c of corners) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.setLineDash([]);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#2563eb';
  const labels = ['TL', 'TR', 'BR', 'BL'];
  for (let i = 0; i < 4; i++) {
    ctx.fillText(labels[i], corners[i].x + 6, corners[i].y - 6);
  }

  ctx.restore();
}

/** Effective pixel size of a print area — the frame's extents, for callers that need no axes. */
export function printAreaPixelSize(printArea: PrintArea, canvasWidth: number, canvasHeight: number): { width: number; height: number } {
  const frame = printAreaFrame(printArea, canvasWidth, canvasHeight);
  return { width: frame.halfW * 2, height: frame.halfH * 2 };
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
  const frame = printAreaFrame(printArea, canvasWidth, canvasHeight);
  const scale = Math.min((frame.halfW * 2) / logoWidth, (frame.halfH * 2) / logoHeight);

  return {
    x: frame.cx,
    y: frame.cy,
    scaleX: scale,
    scaleY: scale,
    angle: (frame.angle * 180) / Math.PI,
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

/** Decode SVG text from a data URL. Returns null for non-SVG URLs. */
function decodeSvgDataUrl(svgDataUrl: string): string | null {
  if (!svgDataUrl.startsWith('data:image/svg+xml')) return null;

  const base64Idx = svgDataUrl.indexOf(';base64,');
  if (base64Idx !== -1) {
    return atob(svgDataUrl.slice(base64Idx + 8));
  }
  const commaIdx = svgDataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  return decodeURIComponent(svgDataUrl.slice(commaIdx + 1));
}

/**
 * Extract width/height from an SVG data URL by parsing viewBox or width/height attributes.
 * Returns null for non-SVG data URLs or when dimensions cannot be determined.
 */
export function parseSvgDimensions(svgDataUrl: string): { width: number; height: number } | null {
  const svgText = decodeSvgDataUrl(svgDataUrl);
  if (svgText === null) return null;

  const widthMatch = svgText.match(/\bwidth=["']([.\d]+)/);
  const heightMatch = svgText.match(/\bheight=["']([.\d]+)/);
  if (widthMatch !== null && heightMatch !== null) {
    return { width: Math.round(parseFloat(widthMatch[1])), height: Math.round(parseFloat(heightMatch[1])) };
  }

  const viewBoxMatch = svgText.match(/viewBox=["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/);
  if (viewBoxMatch !== null) {
    return { width: Math.round(parseFloat(viewBoxMatch[1])), height: Math.round(parseFloat(viewBoxMatch[2])) };
  }

  return null;
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
  const svgText = decodeSvgDataUrl(svgDataUrl);
  if (svgText === null) {
    return { dataUrl: svgDataUrl, scaleApplied: 1 };
  }

  // Parse SVG document. Real browsers return the SVG as documentElement when
  // parsing image/svg+xml; some environments (mock-doc, fallback parsers) wrap
  // it in <html><body>, so probe both.
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.documentElement.tagName.toLowerCase() === 'svg'
    ? doc.documentElement
    : doc.querySelector('svg');
  if (svgEl === null) return { dataUrl: svgDataUrl, scaleApplied: 1 };

  // Determine intrinsic dimensions from viewBox or width/height attributes
  const viewBox = svgEl.getAttribute('viewBox') ?? svgEl.getAttribute('viewbox');
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
  } else if (svgEl.getAttribute('viewBox') === null) {
    // mock-doc lowercases attribute names; re-set with canonical case for serialization
    svgEl.setAttribute('viewBox', viewBox);
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
  const svgText = decodeSvgDataUrl(svgDataUrl);
  if (svgText === null) {
    return svgDataUrl;
  }

  // Parse SVG document. See upscaleSvgDataUrl for the documentElement vs
  // querySelector('svg') rationale.
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.documentElement.tagName.toLowerCase() === 'svg'
    ? doc.documentElement
    : doc.querySelector('svg');
  if (svgEl === null) return svgDataUrl;

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

  setObjectId(img, id);

  canvas.add(img);
  canvas.renderAll();

  return img;
}
