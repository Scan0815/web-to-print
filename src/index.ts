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
} from './types';
export { DEFAULT_VALIDATION_CONFIG, DEFAULT_BG_REMOVAL_CONFIG } from './types';

export type * from './components.d.ts';
