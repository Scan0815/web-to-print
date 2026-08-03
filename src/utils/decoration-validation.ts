import type { ArticleView, EditorState, PrintArea } from '../types/editor';
import { DEFAULT_VALIDATION_CONFIG, type LogoMetadata, type LogoValidationIssue } from '../types/logo';
import { DEFAULT_DECORATION_ISSUE_LABELS, type DecorationIssueLabels } from '../types/labels';
import { printAreaPixelSize, printAreaToPixelCorners } from './canvas-helpers';

/** Axis-aligned bounds of a placed object, in canvas pixels. */
export interface ObjectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A placed object's own visual size in canvas pixels, plus its rotation. Distinct from
 * ObjectBounds on purpose: the world-space bounding box of a rotated object is up to 1.41×
 * its real size, which is fine for asking "does it stick out" and wrong for "how big is it".
 */
export interface ObjectSize {
  /** Centre of the object in canvas pixels. */
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  /** Degrees, matching Fabric's `angle`. */
  angle: number;
}

export interface DecorationValidationInput {
  view: ArticleView;
  state: EditorState;
  /** Bounds of the objects currently on the canvas; empty when the view is not active. */
  bounds: ObjectBounds[];
  /**
   * The same objects with their own size, centre and rotation. Supply this whenever you
   * have it — both geometry checks prefer it and ignore `bounds`, which can only be read
   * as an unrotated box. `bounds` alone remains supported for callers that have nothing else.
   */
  sizes?: ObjectSize[];
  printArea: PrintArea | null;
  canvasWidth: number;
  canvasHeight: number;
  /** Upload metadata of the logos placed on this decoration, for the DPI check. */
  logoMetadata?: LogoMetadata[];
  /** Recommended print resolution; defaults to the shared validation config. */
  minDpi?: number;
  /** Overrides for the finding messages; missing keys fall back to English defaults. */
  labels?: Partial<DecorationIssueLabels>;
}

/** Half a pixel of slack so a perfectly fitted logo is not reported as overflowing. */
const OVERFLOW_TOLERANCE_PX = 0.5;

/** Half a millimetre of slack — a logo fitted exactly to the print area lands on the limit. */
const SIZE_TOLERANCE_MM = 0.5;

/**
 * Per-decoration checks. Everything is a warning: colour counts of arbitrary customer
 * logos cannot be measured reliably, and a hard block on an unreliable measurement
 * prevents legitimate orders. The shop decides whether a warning stops checkout.
 */
export function validateDecoration(input: DecorationValidationInput): LogoValidationIssue[] {
  const issues: LogoValidationIssue[] = [];
  const { view, state, bounds, printArea, canvasWidth, canvasHeight } = input;
  const labels: DecorationIssueLabels = { ...DEFAULT_DECORATION_ISSUE_LABELS, ...input.labels };

  const hasContent = state.logos.length > 0 || state.texts.length > 0;
  if (!hasContent) return issues;

  const sizes = input.sizes;

  if (printArea != null && (sizes !== undefined ? sizes.length > 0 : bounds.length > 0)) {
    const overflowing =
      sizes !== undefined
        ? sizes.some(s => escapesPrintAreaFrame(s, printArea, canvasWidth, canvasHeight))
        : escapesPrintAreaBox(bounds, printArea, canvasWidth, canvasHeight);

    if (overflowing) {
      issues.push({
        code: 'printAreaOverflow',
        severity: 'warning',
        message: labels.printAreaOverflow(view.label),
      });
    }
  }

  if (printArea == null && hasContent) {
    issues.push({
      code: 'missingPrintArea',
      severity: 'warning',
      message: labels.missingPrintArea(view.label),
    });
  }

  issues.push(
    ...validatePhysicalSize(view, sizes ?? bounds.map(boxToSize), printArea, canvasWidth, canvasHeight, labels),
  );
  issues.push(...validateColours(view, state, labels));
  issues.push(...validateResolution(view, input.logoMetadata ?? [], input.minDpi ?? DEFAULT_VALIDATION_CONFIG.minDpi, labels));

  return issues;
}

/** Treats an axis-aligned box as an unrotated object, for callers that only have bounds. */
function boxToSize(b: ObjectBounds): ObjectSize {
  return { centerX: b.left + b.width / 2, centerY: b.top + b.height / 2, width: b.width, height: b.height, angle: 0 };
}

/**
 * Does the object leave the print area's own frame?
 *
 * This has to agree with the editor's drag clamp, which also works in the area's local
 * frame: a print area is printed straight, so an element rotated to match a tilted area
 * is inside it even though its world-space box is not. Comparing boxes would flag every
 * element the clamp just held in place.
 */
function escapesPrintAreaFrame(size: ObjectSize, printArea: PrintArea, canvasWidth: number, canvasHeight: number): boolean {
  const { width: areaW, height: areaH } = printAreaPixelSize(printArea, canvasWidth, canvasHeight);
  const angle = printAreaAngle(printArea, canvasWidth, canvasHeight);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const [tl, tr, br, bl] = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;

  // Object half-size projected onto the area's axes.
  const relAngle = (size.angle * Math.PI) / 180 - angle;
  const relCos = Math.abs(Math.cos(relAngle));
  const relSin = Math.abs(Math.sin(relAngle));
  const halfW = (size.width * relCos + size.height * relSin) / 2;
  const halfH = (size.width * relSin + size.height * relCos) / 2;

  // Object centre in the area's local frame.
  const relX = size.centerX - cx;
  const relY = size.centerY - cy;
  const localX = relX * cos + relY * sin;
  const localY = -relX * sin + relY * cos;

  return (
    Math.abs(localX) + halfW > areaW / 2 + OVERFLOW_TOLERANCE_PX || Math.abs(localY) + halfH > areaH / 2 + OVERFLOW_TOLERANCE_PX
  );
}

/** Bounding-box fallback for callers that supply `bounds` without sizes and angles. */
function escapesPrintAreaBox(bounds: ObjectBounds[], printArea: PrintArea, canvasWidth: number, canvasHeight: number): boolean {
  const corners = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);
  const minX = Math.min(...corners.map(c => c.x));
  const maxX = Math.max(...corners.map(c => c.x));
  const minY = Math.min(...corners.map(c => c.y));
  const maxY = Math.max(...corners.map(c => c.y));

  return bounds.some(
    b =>
      b.left < minX - OVERFLOW_TOLERANCE_PX ||
      b.top < minY - OVERFLOW_TOLERANCE_PX ||
      b.left + b.width > maxX + OVERFLOW_TOLERANCE_PX ||
      b.top + b.height > maxY + OVERFLOW_TOLERANCE_PX,
  );
}

/**
 * Compares the placed elements against the decoration's declared print size. The print
 * area *is* `impWidthMm × impHeightMm`, so the pixel-to-mm scale comes straight from its
 * on-canvas size. Skipped when the catalog does not declare the mm dimensions — several
 * shop payloads encode the limit only in the option name (e.g. "100 cm²").
 */
function validatePhysicalSize(
  view: ArticleView,
  sizes: ObjectSize[],
  printArea: PrintArea | null,
  canvasWidth: number,
  canvasHeight: number,
  labels: DecorationIssueLabels,
): LogoValidationIssue[] {
  const { impWidthMm, impHeightMm } = view;
  if (impWidthMm === undefined || impHeightMm === undefined || printArea == null || sizes.length === 0) return [];

  const area = printAreaPixelSize(printArea, canvasWidth, canvasHeight);
  if (area.width <= 0 || area.height <= 0) return [];

  const mmPerPxX = impWidthMm / area.width;
  const mmPerPxY = impHeightMm / area.height;

  // A tilted print area is printed straight; the editor rotates the logo to match it.
  // Measuring in the area's own frame keeps a perfectly fitted logo at exactly 100%,
  // where a world-space bounding box would report up to 141% and warn every time.
  const frameAngle = printAreaAngle(printArea, canvasWidth, canvasHeight);

  // Report the worst offender rather than one finding per object — the customer fixes
  // the oversized element, then re-validates.
  let widthMm = 0;
  let heightMm = 0;
  for (const size of sizes) {
    const relAngle = (size.angle * Math.PI) / 180 - frameAngle;
    const cos = Math.abs(Math.cos(relAngle));
    const sin = Math.abs(Math.sin(relAngle));
    widthMm = Math.max(widthMm, (size.width * cos + size.height * sin) * mmPerPxX);
    heightMm = Math.max(heightMm, (size.width * sin + size.height * cos) * mmPerPxY);
  }

  if (widthMm <= impWidthMm + SIZE_TOLERANCE_MM && heightMm <= impHeightMm + SIZE_TOLERANCE_MM) return [];

  return [
    {
      code: 'sizeOverflow',
      severity: 'warning',
      message: labels.sizeOverflow(view.label, round1(widthMm), round1(heightMm), impWidthMm, impHeightMm),
    },
  ];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Rotation of the print area in radians, taken from its bottom edge like the placement math. */
function printAreaAngle(printArea: PrintArea, canvasWidth: number, canvasHeight: number): number {
  const [, , br, bl] = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);
  return Math.atan2(br.y - bl.y, br.x - bl.x);
}

/**
 * Surfaces the upload DPI per decoration. The upload component already reports this at
 * pick time, but the envelope is what the shop persists — a finding that only ever lived
 * in the upload UI is lost by the time anyone looks at the order.
 */
function validateResolution(view: ArticleView, logoMetadata: LogoMetadata[], minDpi: number, labels: DecorationIssueLabels): LogoValidationIssue[] {
  const issues: LogoValidationIssue[] = [];

  for (const meta of logoMetadata) {
    // Vector sources scale losslessly, and an unknown DPI is not evidence of a bad one.
    if (meta.format === 'svg' || meta.dpiX === null) continue;

    const dpi = Math.min(meta.dpiX, meta.dpiY ?? meta.dpiX);
    if (dpi < minDpi) {
      issues.push({
        code: 'lowDpi',
        severity: 'warning',
        message: labels.lowDpi(view.label, meta.fileName, Math.round(dpi), minDpi),
      });
    }
  }

  return issues;
}

function validateColours(view: ArticleView, state: EditorState, labels: DecorationIssueLabels): LogoValidationIssue[] {
  const maxColours = view.maxColours;
  if (maxColours === undefined || maxColours === 'full color') return [];

  const issues: LogoValidationIssue[] = [];
  const textColours = new Set(state.texts.map(t => t.fill.toLowerCase()));

  if (textColours.size > maxColours) {
    issues.push({
      code: 'colourLimit',
      severity: 'warning',
      message: labels.colourLimit(view.label, maxColours, textColours.size),
    });
  }

  // The colour count of an uploaded logo cannot be measured reliably, so for
  // single-colour methods (screen print, laser, embroidery) we ask instead of guess.
  if (maxColours === 1 && state.logos.length > 0) {
    issues.push({
      code: 'singleColourPrint',
      severity: 'warning',
      message: labels.singleColourPrint(view.label),
    });
  }

  return issues;
}
