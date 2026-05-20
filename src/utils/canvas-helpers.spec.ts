import { generateObjectId, fitLogoToPrintArea, printAreaToPixelCorners, pixelCornersToPrintArea, legacyToPrintArea, defaultPrintArea, trimSvgWhitespace, isPixelPrintArea, normalizePrintArea, parseSvgDimensions, upscaleSvgDataUrl } from './canvas-helpers';
import { PrintArea, LegacyPrintArea } from '../types';

// Canvas helpers rely on Fabric.js which requires a real canvas context.
// setCanvasBackground and addLogoToCanvas are tested via e2e tests.
// Here we test the pure utility functions.

describe('generateObjectId', () => {
  it('returns a valid UUID string', () => {
    const id = generateObjectId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateObjectId()));
    expect(ids.size).toBe(100);
  });
});

describe('printAreaToPixelCorners', () => {
  it('converts 0-1 corners to absolute pixel positions', () => {
    const pa: PrintArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    const [tl, tr, br, bl] = printAreaToPixelCorners(pa, 800, 600);
    expect(tl).toEqual({ x: 200, y: 150 });
    expect(tr).toEqual({ x: 600, y: 150 });
    expect(br).toEqual({ x: 600, y: 450 });
    expect(bl).toEqual({ x: 200, y: 450 });
  });

  it('handles non-rectangular quads', () => {
    const pa: PrintArea = {
      topLeft: { x: 0.3, y: 0.2 },
      topRight: { x: 0.7, y: 0.3 },
      bottomRight: { x: 0.8, y: 0.8 },
      bottomLeft: { x: 0.2, y: 0.7 },
    };
    const [tl, tr, br, bl] = printAreaToPixelCorners(pa, 400, 400);
    expect(tl).toEqual({ x: 120, y: 80 });
    expect(tr).toEqual({ x: 280, y: 120 });
    expect(br).toEqual({ x: 320, y: 320 });
    expect(bl).toEqual({ x: 80, y: 280 });
  });
});

describe('pixelCornersToPrintArea', () => {
  it('converts pixel positions back to 0-1 coordinates', () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 200, y: 150 },
      { x: 600, y: 150 },
      { x: 600, y: 450 },
      { x: 200, y: 450 },
    ];
    const pa = pixelCornersToPrintArea(corners, 800, 600);
    expect(pa.topLeft).toEqual({ x: 0.25, y: 0.25 });
    expect(pa.topRight).toEqual({ x: 0.75, y: 0.25 });
    expect(pa.bottomRight).toEqual({ x: 0.75, y: 0.75 });
    expect(pa.bottomLeft).toEqual({ x: 0.25, y: 0.75 });
  });

  it('includes bulge when non-zero', () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const pa = pixelCornersToPrintArea(corners, 100, 100, 0.5);
    expect(pa.bulge).toBe(0.5);
  });

  it('omits bulge when zero', () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const pa = pixelCornersToPrintArea(corners, 100, 100);
    expect(pa.bulge).toBeUndefined();
  });

  it('round-trips with printAreaToPixelCorners', () => {
    const original: PrintArea = {
      topLeft: { x: 0.1, y: 0.2 },
      topRight: { x: 0.8, y: 0.15 },
      bottomRight: { x: 0.9, y: 0.85 },
      bottomLeft: { x: 0.05, y: 0.9 },
      bulge: 0.3,
    };
    const pixels = printAreaToPixelCorners(original, 800, 600);
    const result = pixelCornersToPrintArea(pixels, 800, 600, original.bulge);
    expect(result.topLeft.x).toBeCloseTo(original.topLeft.x);
    expect(result.topLeft.y).toBeCloseTo(original.topLeft.y);
    expect(result.topRight.x).toBeCloseTo(original.topRight.x);
    expect(result.topRight.y).toBeCloseTo(original.topRight.y);
    expect(result.bottomRight.x).toBeCloseTo(original.bottomRight.x);
    expect(result.bottomRight.y).toBeCloseTo(original.bottomRight.y);
    expect(result.bottomLeft.x).toBeCloseTo(original.bottomLeft.x);
    expect(result.bottomLeft.y).toBeCloseTo(original.bottomLeft.y);
    expect(result.bulge).toBe(original.bulge);
  });
});

describe('legacyToPrintArea', () => {
  it('converts a simple centered rectangle', () => {
    const legacy: LegacyPrintArea = { x: 0.5, y: 0.5, width: 0.4, height: 0.3 };
    const pa = legacyToPrintArea(legacy);
    expect(pa.topLeft.x).toBeCloseTo(0.3);
    expect(pa.topLeft.y).toBeCloseTo(0.35);
    expect(pa.topRight.x).toBeCloseTo(0.7);
    expect(pa.topRight.y).toBeCloseTo(0.35);
    expect(pa.bottomRight.x).toBeCloseTo(0.7);
    expect(pa.bottomRight.y).toBeCloseTo(0.65);
    expect(pa.bottomLeft.x).toBeCloseTo(0.3);
    expect(pa.bottomLeft.y).toBeCloseTo(0.65);
    expect(pa.bulge).toBeUndefined();
  });

  it('preserves bulge', () => {
    const legacy: LegacyPrintArea = { x: 0.5, y: 0.5, width: 0.4, height: 0.3, bulge: -0.5 };
    const pa = legacyToPrintArea(legacy);
    expect(pa.bulge).toBe(-0.5);
  });

  it('converts a 90-degree rotated rectangle', () => {
    const legacy: LegacyPrintArea = { x: 0.5, y: 0.5, width: 0.4, height: 0.2, angle: 90 };
    const pa = legacyToPrintArea(legacy);
    // After 90° rotation, width and height swap visually
    // TL was (-0.2, -0.1) → rotated 90° → (0.1, -0.2) → translated to (0.6, 0.3)
    expect(pa.topLeft.x).toBeCloseTo(0.6);
    expect(pa.topLeft.y).toBeCloseTo(0.3);
    expect(pa.topRight.x).toBeCloseTo(0.6);
    expect(pa.topRight.y).toBeCloseTo(0.7);
  });

  it('converts with taper (top narrows)', () => {
    const legacy: LegacyPrintArea = { x: 0.5, y: 0.5, width: 0.4, height: 0.3, taper: 0.5 };
    const pa = legacyToPrintArea(legacy);
    // Top half-width = 0.2 * (1 - 0.5) = 0.1, bottom half-width = 0.2
    expect(pa.topLeft.x).toBeCloseTo(0.4); // 0.5 - 0.1
    expect(pa.topRight.x).toBeCloseTo(0.6); // 0.5 + 0.1
    expect(pa.bottomLeft.x).toBeCloseTo(0.3); // 0.5 - 0.2
    expect(pa.bottomRight.x).toBeCloseTo(0.7); // 0.5 + 0.2
  });

  it('handles zero-angle with no transforms as identity', () => {
    const legacy: LegacyPrintArea = { x: 0.5, y: 0.5, width: 0.3, height: 0.35 };
    const pa = legacyToPrintArea(legacy);
    const def = defaultPrintArea();
    expect(pa.topLeft.x).toBeCloseTo(def.topLeft.x);
    expect(pa.topLeft.y).toBeCloseTo(def.topLeft.y);
    expect(pa.bottomRight.x).toBeCloseTo(def.bottomRight.x);
    expect(pa.bottomRight.y).toBeCloseTo(def.bottomRight.y);
  });
});

describe('defaultPrintArea', () => {
  it('returns a centered 30% x 35% rectangle', () => {
    const pa = defaultPrintArea();
    expect(pa.topLeft).toEqual({ x: 0.35, y: 0.325 });
    expect(pa.topRight).toEqual({ x: 0.65, y: 0.325 });
    expect(pa.bottomRight).toEqual({ x: 0.65, y: 0.675 });
    expect(pa.bottomLeft).toEqual({ x: 0.35, y: 0.675 });
    expect(pa.bulge).toBeUndefined();
  });
});

describe('trimSvgWhitespace', () => {
  // The trimming path needs XMLSerializer and a real getBBox() (browser-only);
  // here we cover only the early-return cases that don't.

  it('returns non-SVG data URLs unchanged', async () => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await trimSvgWhitespace(pngDataUrl);
    expect(result).toBe(pngDataUrl);
  });

  it('returns plain HTTP URLs unchanged (decodeSvgDataUrl returns null)', async () => {
    const url = 'https://example.com/logo.svg';
    const result = await trimSvgWhitespace(url);
    expect(result).toBe(url);
  });
});

describe('isPixelPrintArea', () => {
  it('returns true when coordinates are pixel values', () => {
    const pa: PrintArea = {
      topLeft: { x: 447, y: 255 },
      topRight: { x: 1338, y: 255 },
      bottomRight: { x: 1338, y: 1245 },
      bottomLeft: { x: 447, y: 1245 },
    };
    expect(isPixelPrintArea(pa)).toBe(true);
  });

  it('returns false when coordinates are normalized (0-1)', () => {
    const pa: PrintArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    expect(isPixelPrintArea(pa)).toBe(false);
  });

  it('returns false for edge case where all values are exactly 0 or 1', () => {
    const pa: PrintArea = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 },
      bottomLeft: { x: 0, y: 1 },
    };
    expect(isPixelPrintArea(pa)).toBe(false);
  });
});

describe('normalizePrintArea', () => {
  it('converts pixel coordinates to 0-1 values', () => {
    const pa: PrintArea = {
      topLeft: { x: 600, y: 300 },
      topRight: { x: 1800, y: 300 },
      bottomRight: { x: 1800, y: 900 },
      bottomLeft: { x: 600, y: 900 },
    };
    const result = normalizePrintArea(pa, 2400, 1200);
    expect(result.topLeft.x).toBeCloseTo(0.25);
    expect(result.topLeft.y).toBeCloseTo(0.25);
    expect(result.topRight.x).toBeCloseTo(0.75);
    expect(result.topRight.y).toBeCloseTo(0.25);
    expect(result.bottomRight.x).toBeCloseTo(0.75);
    expect(result.bottomRight.y).toBeCloseTo(0.75);
    expect(result.bottomLeft.x).toBeCloseTo(0.25);
    expect(result.bottomLeft.y).toBeCloseTo(0.75);
  });

  it('passes through bulge value', () => {
    const pa: PrintArea = {
      topLeft: { x: 600, y: 300 },
      topRight: { x: 1800, y: 300 },
      bottomRight: { x: 1800, y: 900 },
      bottomLeft: { x: 600, y: 900 },
      bulge: 0.3,
    };
    const result = normalizePrintArea(pa, 2400, 1200);
    expect(result.bulge).toBe(0.3);
  });

  it('returns already-normalized area unchanged', () => {
    const pa: PrintArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    const result = normalizePrintArea(pa, 2400, 1200);
    expect(result).toBe(pa);
  });
});

describe('fitLogoToPrintArea', () => {
  const baseArea: PrintArea = {
    topLeft: { x: 0.25, y: 0.25 },
    topRight: { x: 0.75, y: 0.25 },
    bottomRight: { x: 0.75, y: 0.75 },
    bottomLeft: { x: 0.25, y: 0.75 },
  };

  it('computes centroid as position', () => {
    const result = fitLogoToPrintArea(100, 100, baseArea, 400, 400);
    expect(result.x).toBe(200);
    expect(result.y).toBe(200);
  });

  it('preserves aspect ratio for a wide logo', () => {
    // Area is 200x200 px on 400x400 canvas
    const result = fitLogoToPrintArea(400, 100, baseArea, 400, 400);
    expect(result.scaleX).toBe(result.scaleY);
    // scale = min(200/400, 200/100) = 0.5
    expect(result.scaleX).toBe(0.5);
  });

  it('preserves aspect ratio for a tall logo', () => {
    const result = fitLogoToPrintArea(100, 400, baseArea, 400, 400);
    expect(result.scaleX).toBe(result.scaleY);
    expect(result.scaleX).toBe(0.5);
  });

  it('scales a square logo into a square area', () => {
    const result = fitLogoToPrintArea(500, 500, baseArea, 400, 400);
    expect(result.scaleX).toBe(result.scaleY);
    expect(result.scaleX).toBeCloseTo(0.4);
  });

  it('computes angle from bottom edge', () => {
    // Bottom edge from (0.25,0.75) to (0.75,0.75) → horizontal → angle 0
    const result = fitLogoToPrintArea(100, 100, baseArea, 400, 400);
    expect(result.angle).toBeCloseTo(0);
  });

  it('derives angle from tilted quad', () => {
    const tilted: PrintArea = {
      topLeft: { x: 0.3, y: 0.2 },
      topRight: { x: 0.7, y: 0.3 },
      bottomRight: { x: 0.6, y: 0.8 },
      bottomLeft: { x: 0.2, y: 0.7 },
    };
    const result = fitLogoToPrintArea(100, 100, tilted, 400, 400);
    // Bottom edge: (0.2*400, 0.7*400) to (0.6*400, 0.8*400) = (80,280) to (240,320)
    // angle = atan2(40, 160) ≈ 14.04°
    expect(result.angle).toBeCloseTo(14.04, 1);
  });

  it('works with non-square canvas', () => {
    const area: PrintArea = {
      topLeft: { x: 0.3, y: 0.2 },
      topRight: { x: 0.7, y: 0.2 },
      bottomRight: { x: 0.7, y: 0.8 },
      bottomLeft: { x: 0.3, y: 0.8 },
    };
    // canvas 400x200 → area corners: (120,40), (280,40), (280,160), (120,160)
    const result = fitLogoToPrintArea(320, 120, area, 400, 200);
    expect(result.x).toBe(200);
    expect(result.y).toBe(100);
    // width=160px, height=120px, logo=320x120 → scale=min(160/320,120/120)=0.5
    expect(result.scaleX).toBe(0.5);
    expect(result.scaleY).toBe(0.5);
  });
});

describe('parseSvgDimensions', () => {
  it('returns null for non-SVG data URLs', () => {
    expect(parseSvgDimensions('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(parseSvgDimensions('https://example.com/logo.svg')).toBeNull();
  });

  it('extracts width and height from explicit attributes', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect/></svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    expect(parseSvgDimensions(url)).toEqual({ width: 120, height: 80 });
  });

  it('extracts width and height from URI-encoded SVG (no base64)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>';
    const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
    expect(parseSvgDimensions(url)).toEqual({ width: 64, height: 64 });
  });

  it('rounds fractional pixel dimensions', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100.7" height="50.4"/>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    expect(parseSvgDimensions(url)).toEqual({ width: 101, height: 50 });
  });

  it('falls back to viewBox when width/height are missing', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"/>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    expect(parseSvgDimensions(url)).toEqual({ width: 200, height: 150 });
  });

  it('returns null when neither dimensions nor viewBox are present', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    expect(parseSvgDimensions(url)).toBeNull();
  });

  it('prefers width/height over viewBox when both exist', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 200 200"/>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    expect(parseSvgDimensions(url)).toEqual({ width: 50, height: 50 });
  });
});

describe('upscaleSvgDataUrl', () => {
  // The full upscale path needs a working XMLSerializer (browser-only).
  // These tests cover the pure early-return paths that don't require it;
  // the actual transformation is verified via e2e.

  it('returns non-SVG data URLs unchanged with scale 1', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const result = upscaleSvgDataUrl(png);
    expect(result.dataUrl).toBe(png);
    expect(result.scaleApplied).toBe(1);
  });

  it('returns SVG unchanged when intrinsic dimensions cannot be determined', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    const result = upscaleSvgDataUrl(url);
    expect(result.dataUrl).toBe(url);
    expect(result.scaleApplied).toBe(1);
  });

  it('skips upscaling when SVG already exceeds maxSize', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"/>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    const result = upscaleSvgDataUrl(url, 4000);
    expect(result.dataUrl).toBe(url);
    expect(result.scaleApplied).toBe(1);
  });

  it('returns unchanged for completely unparseable input', () => {
    const url = 'data:image/svg+xml;base64,' + btoa('not actually svg');
    const result = upscaleSvgDataUrl(url);
    expect(result.scaleApplied).toBe(1);
    expect(result.dataUrl).toBe(url);
  });
});
