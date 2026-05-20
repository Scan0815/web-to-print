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
  dataUrl: string;
  /** Downscaled preview for product catalog rendering (optional). */
  previewDataUrl?: string;
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

export interface ArticleView {
  image: string;
  label: string;
  printArea: PrintArea | null;
  impMethod?: string;
  impLocation?: string;
  impWidthMm?: number;
  impHeightMm?: number;
  impDiameterMm?: number;
  maxColours?: number;
}

export interface Article {
  id: string;
  name: string;
  description: string;
  views: ArticleView[];
}
