/**
 * Whether a thumbnail produced by the editor's background image preload still belongs in
 * the decoration strip by the time it resolves.
 *
 * Preload is asynchronous, so between requesting a view's thumbnail and receiving it the
 * customer may have switched articles — and view ids repeat across articles ("front"), so
 * a stale thumbnail would otherwise land under the wrong article's decoration. A design
 * preview captured on view exit may also already fill the slot; it shows the customer's
 * work and must win over the bare product shot.
 *
 * @param capturedArticleKey the loaded-article key when the thumbnail was requested
 * @param currentArticleKey  the loaded-article key now that it has resolved
 * @param existingPreview    the preview already stored for this view, if any
 */
export function shouldApplyPreloadedThumbnail(capturedArticleKey: string, currentArticleKey: string, existingPreview: string | undefined): boolean {
  return capturedArticleKey === currentArticleKey && existingPreview === undefined;
}
