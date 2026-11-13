import type { ArticleView, EditorState, PlacedLogo, PrintArea } from '../types/editor';
import { DEFAULT_VALIDATION_CONFIG, type LogoMetadata, type LogoValidationIssue } from '../types/logo';
import { DEFAULT_DECORATION_ISSUE_LABELS, type DecorationIssueLabels } from '../types/labels';
import { printAreaFrame, printAreaToPixelCorners, projectOntoFrame, toFrameLocal, type PrintAreaFrame } from './canvas-helpers';

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

/** A raster logo as it sits on the canvas: its own pixels and the size it is placed at. */
export interface PlacedRaster {
  fileName: string;
  /** Intrinsic pixel size of the image on the canvas. */
  widthPx: number;
  heightPx: number;
  size: ObjectSize;
}

/**
 * Whether a placed logo is pixel data. SVG and print files (PDF/AI) scale losslessly, so
 * a resolution check on their canvas raster would warn about something that is not printed.
 * Decided from the persisted logo alone, so it also holds for a restored state.
 */
export function isRasterLogo(logo: PlacedLogo): boolean {
  const original = logo.source?.dataUrl ?? logo.dataUrl;
  if (original.startsWith('data:image/svg+xml')) return false;
  return !original.startsWith('data:') || original.startsWith('data:image/');
}

/**
 * The decoration's print area, or why there is none to check against.
 *
 * `'pending'` is not the same as `null`: a catalog delivers pixel coordinates that have to
 * be normalized against the product image first, and until that finishes the editor does
 * not yet know the area. Collapsing the two would report `missingPrintArea` for a
 * decoration that has a perfectly good one — and a finding computed in that window gets
 * frozen into the decoration when the view is left.
 */
export type PrintAreaInput = PrintArea | null | 'pending';

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
  printArea: PrintAreaInput;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * The raster logos on the canvas, for the resolution check at print size. Only used
   * when the view declares `impWidthMm` and `impHeightMm`.
   */
  rasters?: PlacedRaster[];
  /**
   * Upload metadata of the logos placed on this decoration. Only the fallback for the
   * resolution check on views without declared print dimensions.
   */
  logoMetadata?: LogoMetadata[];
  /** Recommended print resolution; defaults to the shared validation config. */
  minDpi?: number;
  /** The view's product image failed to load, so the canvas has no mockup under the design. */
  productImageFailed?: boolean;
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
  const { view, state, bounds, canvasWidth, canvasHeight } = input;
  const labels: DecorationIssueLabels = { ...DEFAULT_DECORATION_ISSUE_LABELS, ...input.labels };

  // Everything below the product-image check needs to know the print area. While it is
  // still being normalized, saying nothing is the only honest answer — see PrintAreaInput.
  const pending = input.printArea === 'pending';
  const printArea: PrintArea | null = input.printArea === 'pending' ? null : input.printArea;

  // Reported even for an empty decoration: the editor degrades to a blank canvas rather
  // than failing, so this finding is the only way the host learns the mockup is missing.
  if (input.productImageFailed === true) {
    issues.push({
      code: 'productImageUnavailable',
      severity: 'warning',
      message: labels.productImageUnavailable(view.label),
    });
  }

  const hasContent = state.logos.length > 0 || state.texts.length > 0;
  if (!hasContent) return issues;

  const sizes = input.sizes;

  // Only the geometry findings wait for the print area. The colour and resolution checks
  // read the state and the upload metadata, so withholding those too would be silence for
  // no reason.
  if (!pending) {
    if (printArea != null && (sizes !== undefined ? sizes.length > 0 : bounds.length > 0)) {
      const overflowing =
        sizes !== undefined
          ? sizes.some(s => escapesPrintAreaFrame(s, printAreaFrame(printArea, canvasWidth, canvasHeight)))
          : escapesPrintAreaBox(bounds, printArea, canvasWidth, canvasHeight);

      if (overflowing) {
        issues.push({
          code: 'printAreaOverflow',
          severity: 'warning',
          message: labels.printAreaOverflow(view.label),
        });
      }
    }

    if (printArea == null) {
      issues.push({
        code: 'missingPrintArea',
        severity: 'warning',
        message: labels.missingPrintArea(view.label),
      });
    }

    issues.push(...validatePhysicalSize(view, sizes ?? bounds.map(boxToSize), printArea, canvasWidth, canvasHeight, labels));
  }

  issues.push(...validateColours(view, state, labels));

  // With declared print dimensions the resolution is measured at print size, which needs
  // the print area. Without them only the DPI tag of the file is left to go by.
  const minDpi = input.minDpi ?? DEFAULT_VALIDATION_CONFIG.minDpi;
  if (view.impWidthMm === undefined || view.impHeightMm === undefined) {
    issues.push(...validateTaggedResolution(view, input.logoMetadata ?? [], minDpi, labels));
  } else if (!pending) {
    issues.push(...validatePrintResolution(view, input.rasters ?? [], printArea, canvasWidth, canvasHeight, minDpi, labels));
  }

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
function escapesPrintAreaFrame(size: ObjectSize, frame: PrintAreaFrame): boolean {
  const projected = projectOntoFrame(size, frame);
  const local = toFrameLocal(size.centerX, size.centerY, frame);

  return (
    Math.abs(local.x) + projected.halfW > frame.halfW + OVERFLOW_TOLERANCE_PX ||
    Math.abs(local.y) + projected.halfH > frame.halfH + OVERFLOW_TOLERANCE_PX
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

  // A tilted print area is printed straight; the editor rotates the logo to match it.
  // Measuring in the area's own frame keeps a perfectly fitted logo at exactly 100%,
  // where a world-space bounding box would report up to 141% and warn every time.
  const frame = printAreaFrame(printArea, canvasWidth, canvasHeight);
  if (frame.halfW <= 0 || frame.halfH <= 0) return [];

  const mmPerPxX = impWidthMm / (frame.halfW * 2);
  const mmPerPxY = impHeightMm / (frame.halfH * 2);

  // Report the single worst offender — the customer shrinks that element, then
  // re-validates. Taking a per-axis maximum across objects would report a width and
  // height belonging to two different logos, describing no element actually on the canvas.
  let worst: { widthMm: number; heightMm: number; overshoot: number } | null = null;
  for (const size of sizes) {
    const projected = projectOntoFrame(size, frame);
    const widthMm = projected.halfW * 2 * mmPerPxX;
    const heightMm = projected.halfH * 2 * mmPerPxY;
    const overshoot = Math.max(widthMm - impWidthMm, heightMm - impHeightMm);
    if (overshoot > SIZE_TOLERANCE_MM && (worst === null || overshoot > worst.overshoot)) {
      worst = { widthMm, heightMm, overshoot };
    }
  }

  if (worst === null) return [];

  return [
    {
      code: 'sizeOverflow',
      severity: 'warning',
      message: labels.sizeOverflow(view.label, round1(worst.widthMm), round1(worst.heightMm), impWidthMm, impHeightMm),
    },
  ];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const MM_PER_INCH = 25.4;

/**
 * Resolution of each raster logo at the size it will be printed: its pixels divided by
 * the inches it covers. The DPI tag inside the file says nothing about that — a 200 px
 * logo tagged 300 DPI is still blurry at 50 mm, and a 4000 px one tagged 72 is fine.
 */
function validatePrintResolution(
  view: ArticleView,
  rasters: PlacedRaster[],
  printArea: PrintArea | null,
  canvasWidth: number,
  canvasHeight: number,
  minDpi: number,
  labels: DecorationIssueLabels,
): LogoValidationIssue[] {
  const { impWidthMm, impHeightMm } = view;
  if (impWidthMm === undefined || impHeightMm === undefined || printArea == null) return [];

  const frame = printAreaFrame(printArea, canvasWidth, canvasHeight);
  if (frame.halfW <= 0 || frame.halfH <= 0) return [];

  const mmPerPxX = impWidthMm / (frame.halfW * 2);
  const mmPerPxY = impHeightMm / (frame.halfH * 2);

  const issues: LogoValidationIssue[] = [];
  for (const raster of rasters) {
    // The logo's own edges, turned into the print area's frame. Unlike its projected
    // extent, their length does not grow when the logo is rotated inside the area.
    const angle = (raster.size.angle * Math.PI) / 180 - frame.angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const widthMm = Math.hypot(raster.size.width * cos * mmPerPxX, raster.size.width * sin * mmPerPxY);
    const heightMm = Math.hypot(raster.size.height * sin * mmPerPxX, raster.size.height * cos * mmPerPxY);
    if (!(widthMm > 0) || !(heightMm > 0)) continue;

    // Rounded before comparing, so the message never reads "300 DPI, below 300".
    const dpi = Math.round(Math.min((raster.widthPx / widthMm) * MM_PER_INCH, (raster.heightPx / heightMm) * MM_PER_INCH));
    if (dpi < minDpi) {
      issues.push({ code: 'lowDpi', severity: 'warning', message: labels.lowDpi(view.label, raster.fileName, dpi, minDpi) });
    }
  }

  return issues;
}

/**
 * Fallback for views without declared print dimensions: surfaces the DPI tag of the
 * upload. The upload component already reports this at pick time, but the envelope is
 * what the shop persists — a finding that only ever lived in the upload UI is lost by the
 * time anyone looks at the order.
 */
function validateTaggedResolution(view: ArticleView, logoMetadata: LogoMetadata[], minDpi: number, labels: DecorationIssueLabels): LogoValidationIssue[] {
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
