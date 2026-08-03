/**
 * @fileoverview Entry point for the web-to-print component library.
 *
 * Use this file to export utilities, types, and constants.
 * Components are consumed via the approaches outlined in the README.
 */

export type {
  LogoFormat,
  LogoMetadata,
  LogoValidationIssue,
  LogoValidationConfig,
  LogoValidationResult,
  LogoData,
  BgRemovalConfig,
  CanvasTransform,
  PlacedLogo,
  PlacedText,
  EditorState,
  PrintArea,
  RelativePoint,
  LegacyPrintArea,
  ArticleView,
  Article,
  LogoSource,
  CoordinateImageSize,
  MaxColours,
  DecorationMeta,
  DecorationState,
  ArticleEditorState,
} from './types';
export { DEFAULT_VALIDATION_CONFIG, DEFAULT_BG_REMOVAL_CONFIG } from './types';

export { isPixelPrintArea, normalizePrintArea, resolveViewPrintArea } from './utils/print-area';

export type { PdfExportConfig, DecorationMockup, LogoSourcePage } from './utils/pdf-export';
export { exportProductPdf, exportArticlePdf, collectLogoSources, selectPrintableDecorations } from './utils/pdf-export';

export type { RenderedPdfPage } from './utils/pdf-render';
export { renderPdfFirstPage, isPdfRenderingAvailable } from './utils/pdf-render';

export type { ObjectBounds, ObjectSize, DecorationValidationInput } from './utils/decoration-validation';
export { validateDecoration } from './utils/decoration-validation';

export { decorationMetaOf } from './utils/decoration-meta';

export type * from './components.d.ts';
