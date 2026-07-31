import { isPixelPrintArea, normalizePrintArea, resolveViewPrintArea } from './print-area';
import type { ArticleView, PrintArea } from '../types/editor';

const PIXEL_AREA: PrintArea = {
  topLeft: { x: 447, y: 255 },
  topRight: { x: 1338, y: 255 },
  bottomRight: { x: 1338, y: 1245 },
  bottomLeft: { x: 447, y: 1245 },
};

const RELATIVE_AREA: PrintArea = {
  topLeft: { x: 0.2, y: 0.3 },
  topRight: { x: 0.8, y: 0.3 },
  bottomRight: { x: 0.8, y: 0.7 },
  bottomLeft: { x: 0.2, y: 0.7 },
};

describe('isPixelPrintArea', () => {
  it('detects pixel coordinates', () => {
    expect(isPixelPrintArea(PIXEL_AREA)).toBe(true);
  });

  it('treats relative coordinates as normalized', () => {
    expect(isPixelPrintArea(RELATIVE_AREA)).toBe(false);
  });

  it('treats coordinates of exactly 1 as normalized', () => {
    expect(
      isPixelPrintArea({
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1, y: 0 },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 1 },
      }),
    ).toBe(false);
  });
});

describe('normalizePrintArea', () => {
  it('divides pixel coordinates by the image dimensions', () => {
    const result = normalizePrintArea(PIXEL_AREA, 2400, 2400);
    expect(result.topLeft.x).toBeCloseTo(447 / 2400, 6);
    expect(result.bottomRight.y).toBeCloseTo(1245 / 2400, 6);
  });

  it('uses width and height independently', () => {
    const result = normalizePrintArea(PIXEL_AREA, 2400, 1200);
    expect(result.topLeft.x).toBeCloseTo(447 / 2400, 6);
    expect(result.topLeft.y).toBeCloseTo(255 / 1200, 6);
  });

  it('passes already normalized areas through unchanged', () => {
    expect(normalizePrintArea(RELATIVE_AREA, 2400, 2400)).toBe(RELATIVE_AREA);
  });

  it('keeps a non-zero bulge', () => {
    const result = normalizePrintArea({ ...PIXEL_AREA, bulge: 0.4 }, 2400, 2400);
    expect(result.bulge).toBe(0.4);
  });

  it('drops a zero bulge', () => {
    const result = normalizePrintArea({ ...PIXEL_AREA, bulge: 0 }, 2400, 2400);
    expect(result.bulge).toBeUndefined();
  });

  it('returns the input unchanged for non-positive dimensions', () => {
    expect(normalizePrintArea(PIXEL_AREA, 0, 2400)).toBe(PIXEL_AREA);
  });
});

describe('resolveViewPrintArea', () => {
  const view = (overrides: Partial<ArticleView>): ArticleView => ({
    id: 'view-1',
    image: 'https://example.com/product.png',
    label: 'Front',
    printArea: PIXEL_AREA,
    ...overrides,
  });

  it('returns null when the view has no print area', async () => {
    expect(await resolveViewPrintArea(view({ printArea: null }))).toBeNull();
  });

  it('returns relative areas without measuring the image', async () => {
    expect(await resolveViewPrintArea(view({ printArea: RELATIVE_AREA }))).toBe(RELATIVE_AREA);
  });

  it('falls back to the declared coordinate size when the image cannot be measured', async () => {
    const resolved = await resolveViewPrintArea(
      view({ coordinateImageSize: { width: 2400, height: null, longestSide: 'width' } }),
    );
    expect(resolved?.topLeft.x).toBeCloseTo(447 / 2400, 6);
  });

  it('falls back to a declared height', async () => {
    const resolved = await resolveViewPrintArea(
      view({ coordinateImageSize: { width: null, height: 1600, longestSide: 'height' } }),
    );
    expect(resolved?.topLeft.y).toBeCloseTo(255 / 1600, 6);
  });

  it('returns null rather than unresolved pixel coordinates', async () => {
    expect(await resolveViewPrintArea(view({}))).toBeNull();
  });
});
