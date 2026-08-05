import type { LogoValidationIssue, LogoSource } from './logo';

export interface CanvasTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  skewX?: number;
  skewY?: number;
}

export interface PlacedLogo {
  id: string;
  /** Canvas representation — always something the browser can draw. */
  dataUrl: string;
  /** Downscaled preview for product catalog rendering (optional). */
  previewDataUrl?: string;
  /** The uploaded original. Absent for logos placed before 0.2.0. */
  source?: LogoSource;
  transform?: CanvasTransform;
}

/** A point in 0-1 relative coordinates (fraction of canvas width/height). */
export interface RelativePoint {
  x: number;
  y: number;
}

/** Print area defined by 4 independent corner points (any quadrilateral). */
export interface PrintArea {
  /** Top-left corner (0-1, relative to canvas) */
  topLeft: RelativePoint;
  /** Top-right corner (0-1, relative to canvas) */
  topRight: RelativePoint;
  /** Bottom-right corner (0-1, relative to canvas) */
  bottomRight: RelativePoint;
  /** Bottom-left corner (0-1, relative to canvas) */
  bottomLeft: RelativePoint;
  /** Top/bottom edge curvature (-1 to 1; positive = outward/convex, negative = inward/concave, default: 0) */
  bulge?: number;
}

/** Legacy print area format (center + dimensions + transforms) for migration. */
export interface LegacyPrintArea {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  skewX?: number;
  skewY?: number;
  bulge?: number;
  taper?: number;
}

export interface PlacedText {
  id: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  transform: CanvasTransform;
}

export interface EditorState {
  fabricJson: string;
  logos: PlacedLogo[];
  texts: PlacedText[];
  productImage: string | null;
  width: number;
  height: number;
}

/** Resolution the pixel coordinates of a print area refer to. */
export interface CoordinateImageSize {
  width: number | null;
  height: number | null;
  longestSide: 'width' | 'height';
}

/** Number of printable colours, or 'full color' for digital/sublimation printing. */
export type MaxColours = number | 'full color';

/**
 * What the catalog says about how a decoration is printed. Named as one thing because it
 * travels as one thing: from `ArticleView` into `DecorationState`, and on into the PDF's
 * decoration page. Every field is optional — shop payloads vary in what they declare.
 */
export interface DecorationMeta {
  impMethod?: string;
  impLocation?: string;
  impWidthMm?: number;
  impHeightMm?: number;
  maxColours?: MaxColours;
}

/** One decoration option (Veredelung) of an article. */
export interface ArticleView extends DecorationMeta {
  /**
   * Stable decoration id supplied by the host — in the shop payload this is the
   * `printCodeSKU`, which doubles as the key of the purchasable decoration.
   * Required: positional identity breaks when the supplier feed reorders views.
   */
  id: string;
  image: string;
  label: string;
  printArea: PrintArea | null;
  /** Source resolution when `printArea` holds pixel instead of 0-1 coordinates. */
  coordinateImageSize?: CoordinateImageSize;
  /** Pre-selects this decoration when the editor opens. Falls back to the first view. */
  isDefault?: boolean;
  /** Round print areas. Stays on the view: the PDF reads it, the envelope does not carry it. */
  impDiameterMm?: number;
}

export interface Article {
  id: string;
  name: string;
  description: string;
  views: ArticleView[];
}

/** State of a single decoration inside the article-level envelope. */
export interface DecorationState extends DecorationMeta {
  /** Matches ArticleView.id. */
  viewId: string;
  label: string;
  /** 'designed' iff the canvas holds at least one logo or text object. */
  status: 'empty' | 'designed';
  state: EditorState;
  /** Downscaled preview for shop thumbnails. */
  previewDataUrl?: string;
  /** Non-blocking validation findings for this decoration. */
  issues: LogoValidationIssue[];
}

/** Versioned envelope returned by the editor for a whole article. */
export interface ArticleEditorState {
  version: 2;
  articleId: string;
  decorations: DecorationState[];
}
