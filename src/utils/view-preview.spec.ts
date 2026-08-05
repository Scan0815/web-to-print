import { shouldApplyPreloadedThumbnail } from './view-preview';

describe('shouldApplyPreloadedThumbnail', () => {
  it('applies when the article is unchanged and the slot is empty', () => {
    expect(shouldApplyPreloadedThumbnail('A-1|front,back', 'A-1|front,back', undefined)).toBe(true);
  });

  it('drops a thumbnail whose article changed under it', () => {
    // View ids repeat across articles, so a late thumbnail from A-1 must not land in B-1.
    expect(shouldApplyPreloadedThumbnail('A-1|front', 'B-1|front', undefined)).toBe(false);
  });

  it('does not overwrite an existing preview (a design captured on view exit wins)', () => {
    expect(shouldApplyPreloadedThumbnail('A-1|front', 'A-1|front', 'data:image/png;base64,DESIGN')).toBe(false);
  });
});
