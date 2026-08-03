import type { DecorationMeta } from '../types/editor';

/**
 * Copies the print metadata out of a catalog view, dropping the keys it does not declare.
 *
 * The dropping is the point: the envelope is persisted in a cart and read back, and an
 * explicit `impWidthMm: undefined` survives neither `JSON.stringify` nor an `in` check the
 * way a missing key does. Both the editor's envelope and the single-decoration PDF wrapper
 * build the same object, so it lives here rather than being spelled out twice.
 */
export function decorationMetaOf(source: DecorationMeta): DecorationMeta {
  return {
    ...(source.impMethod !== undefined ? { impMethod: source.impMethod } : {}),
    ...(source.impLocation !== undefined ? { impLocation: source.impLocation } : {}),
    ...(source.impWidthMm !== undefined ? { impWidthMm: source.impWidthMm } : {}),
    ...(source.impHeightMm !== undefined ? { impHeightMm: source.impHeightMm } : {}),
    ...(source.maxColours !== undefined ? { maxColours: source.maxColours } : {}),
  };
}
