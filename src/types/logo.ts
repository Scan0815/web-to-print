export type LogoFormat = 'png' | 'jpeg' | 'svg' | 'tiff' | 'avif' | 'pdf' | 'ai' | 'unknown';

/** The file the customer uploaded, kept unmodified for the print shop. */
export interface LogoSource {
  dataUrl: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
}

export interface LogoMetadata {
  format: LogoFormat;
  width: number;
  height: number;
  dpiX: number | null;
  dpiY: number | null;
  fileSize: number;
  fileName: string;
  mimeType: string;
  hasTransparency: boolean;
}

export interface LogoValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface LogoValidationConfig {
  /**
   * Recommended print resolution. The upload does not judge a file by it — the DPI tag
   * of a file says nothing about print quality. The editor warns (`lowDpi`) when a
   * placed raster logo falls below it at its printed size.
   */
  minDpi: number;
  /**
   * Size of the print area the logo is meant for, in millimetres. When set, the upload
   * adds a `LOW_PRINT_RESOLUTION` warning to a raster logo that would fall below
   * `minDpi` if it filled that area. Never a reason to reject the file.
   */
  printSizeMm?: { width: number; height: number };
  maxFileSize: number;
  minWidth: number;
  minHeight: number;
  allowedFormats: LogoFormat[];
}

export interface LogoValidationResult {
  valid: boolean;
  metadata: LogoMetadata;
  issues: LogoValidationIssue[];
}

export interface LogoData {
  /** Canvas representation — always something the browser can draw. */
  dataUrl: string;
  /** Downscaled preview for product catalog rendering (optional, for backward compat). */
  previewDataUrl?: string;
  /** The uploaded original; differs from dataUrl for PDF/AI (and rasterized SVG). */
  source?: LogoSource;
  metadata: LogoMetadata;
  /** Warnings about an accepted upload, e.g. `LOW_PRINT_RESOLUTION`. Absent when there are none. */
  issues?: LogoValidationIssue[];
}

export const DEFAULT_VALIDATION_CONFIG: LogoValidationConfig = {
  minDpi: 300,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  minWidth: 100,
  minHeight: 100,
  allowedFormats: ['png', 'jpeg', 'svg', 'tiff', 'avif', 'pdf', 'ai'],
};

export interface BgRemovalConfig {
  /** Color distance threshold (0-255). Default: 40 */
  tolerance: number;
  /** Min fraction of edge pixels sharing a color to count as background. Default: 0.3 */
  minEdgeRatio: number;
  /** Trim result to opaque content bounding box after background removal. Default: true */
  autoCrop: boolean;
  /** Padding in pixels around the opaque bounding box when auto-cropping. Default: 2 */
  autoCropPadding: number;
}

export const DEFAULT_BG_REMOVAL_CONFIG: BgRemovalConfig = {
  tolerance: 40,
  minEdgeRatio: 0.3,
  autoCrop: true,
  autoCropPadding: 2,
};
