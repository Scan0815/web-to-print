import { decorationMetaOf } from './decoration-meta';
import type { ArticleView } from '../types/editor';

function view(overrides: Partial<ArticleView> = {}): ArticleView {
  return { id: 'front', image: '', label: 'Front', printArea: null, ...overrides };
}

describe('decorationMetaOf', () => {
  it('copies the declared print metadata', () => {
    const meta = decorationMetaOf(view({ impMethod: 'Siebdruck', impLocation: 'Beutel', impWidthMm: 100, impHeightMm: 80, maxColours: 2 }));
    expect(meta).toEqual({ impMethod: 'Siebdruck', impLocation: 'Beutel', impWidthMm: 100, impHeightMm: 80, maxColours: 2 });
  });

  it('omits keys the catalog does not declare rather than setting them undefined', () => {
    const meta = decorationMetaOf(view({ impMethod: 'Tampondruck' }));
    expect(meta).toEqual({ impMethod: 'Tampondruck' });
    // A persisted envelope must not carry `impWidthMm: undefined` — it does not survive
    // a JSON round trip the way a missing key does.
    expect('impWidthMm' in meta).toBe(false);
  });

  it('carries the full-colour marker through unchanged', () => {
    expect(decorationMetaOf(view({ maxColours: 'full color' })).maxColours).toBe('full color');
  });

  it('drops everything the view carries beyond the print metadata', () => {
    const meta = decorationMetaOf(view({ impDiameterMm: 40, isDefault: true, impMethod: 'Laser' }));
    expect(meta).toEqual({ impMethod: 'Laser' });
  });

  it('returns an empty object for a view that declares nothing', () => {
    expect(decorationMetaOf(view())).toEqual({});
  });
});
