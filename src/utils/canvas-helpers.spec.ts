import { generateObjectId, fitLogoToPrintArea, printAreaFrame, printAreaPixelSize, projectOntoFrame, toFrameLocal, fromFrameLocal, printAreaToPixelCorners, pixelCornersToPrintArea, legacyToPrintArea, defaultPrintArea, trimSvgWhitespace, isPixelPrintArea, normalizePrintArea, parseSvgDimensions, upscaleSvgDataUrl, clampToPrintAreaFrame, markAsBackground } from './canvas-helpers';
import { Rect } from 'fabric';
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

describe('printAreaFrame', () => {
  // 45° diamond on the editor's default 800x600 canvas: every edge is 250px long, so the
  // frame is square even though the canvas is not.
  const tilted: PrintArea = {
    topLeft: { x: 0.5, y: 0.25 },
    topRight: { x: 0.75, y: 0.5 },
    bottomRight: { x: 0.5, y: 0.75 },
    bottomLeft: { x: 0.25, y: 0.5 },
  };

  it('takes the centroid as its origin', () => {
    const frame = printAreaFrame(tilted, 800, 600);
    expect(frame.cx).toBe(400);
    expect(frame.cy).toBe(300);
  });

  it('reports half-extents along its own axes, not the bounding box', () => {
    const frame = printAreaFrame(tilted, 800, 600);
    expect(frame.halfW).toBeCloseTo(125, 6);
    expect(frame.halfH).toBeCloseTo(125, 6);
  });

  it('takes its angle from the bottom edge', () => {
    const frame = printAreaFrame(tilted, 800, 600);
    expect(frame.angle).toBeCloseTo(Math.atan2(150, 200), 6);
    expect(frame.cos).toBeCloseTo(Math.cos(frame.angle), 6);
    expect(frame.sin).toBeCloseTo(Math.sin(frame.angle), 6);
  });

  it('has no rotation for an axis-aligned area', () => {
    const square: PrintArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    expect(printAreaFrame(square, 400, 400).angle).toBe(0);
  });

  describe('projectOntoFrame', () => {
    it('leaves an object aligned with the frame at half its own size', () => {
      const frame = printAreaFrame(tilted, 800, 600);
      const degrees = (frame.angle * 180) / Math.PI;
      const projected = projectOntoFrame({ width: 200, height: 100, angle: degrees }, frame);
      expect(projected.halfW).toBeCloseTo(100, 6);
      expect(projected.halfH).toBeCloseTo(50, 6);
    });

    it('swaps the axes for an object turned 90° against the frame', () => {
      const frame = printAreaFrame(tilted, 800, 600);
      const degrees = (frame.angle * 180) / Math.PI + 90;
      const projected = projectOntoFrame({ width: 200, height: 100, angle: degrees }, frame);
      expect(projected.halfW).toBeCloseTo(50, 6);
      expect(projected.halfH).toBeCloseTo(100, 6);
    });
  });

  describe('toFrameLocal / fromFrameLocal', () => {
    it('puts the frame centre at the local origin', () => {
      const frame = printAreaFrame(tilted, 800, 600);
      const local = toFrameLocal(400, 300, frame);
      expect(local.x).toBeCloseTo(0, 6);
      expect(local.y).toBeCloseTo(0, 6);
    });

    it('round-trips a world point', () => {
      const frame = printAreaFrame(tilted, 800, 600);
      const local = toFrameLocal(510, 240, frame);
      const world = fromFrameLocal(local.x, local.y, frame);
      expect(world.x).toBeCloseTo(510, 6);
      expect(world.y).toBeCloseTo(240, 6);
    });

    it('measures along the frame axis, not the canvas axis', () => {
      const frame = printAreaFrame(tilted, 800, 600);
      // Midpoint of the area's right-hand edge: exactly halfW along its local x-axis,
      // and on the local x-axis itself — although it is 100px right and 75px down in
      // canvas coordinates.
      const local = toFrameLocal(500, 375, frame);
      expect(local.x).toBeCloseTo(125, 6);
      expect(local.y).toBeCloseTo(0, 6);
    });
  });
});

describe('clampToPrintAreaFrame', () => {
  // Axis-aligned 200x200 area centred on a 400x400 canvas: half-extents of 100 around (200, 200).
  const area: PrintArea = {
    topLeft: { x: 0.25, y: 0.25 },
    topRight: { x: 0.75, y: 0.25 },
    bottomRight: { x: 0.75, y: 0.75 },
    bottomLeft: { x: 0.25, y: 0.75 },
  };
  const frame = () => printAreaFrame(area, 400, 400);

  it('leaves an object that is already inside alone', () => {
    const rect = new Rect({ left: 180, top: 180, width: 40, height: 40 });
    clampToPrintAreaFrame(rect, frame());
    expect(rect.left).toBe(180);
    expect(rect.top).toBe(180);
  });

  it('slides an object that escaped back onto the boundary', () => {
    const rect = new Rect({ left: 300, top: 180, width: 40, height: 40 });
    clampToPrintAreaFrame(rect, frame());
    // Its right edge now sits exactly on the area's right edge, and nothing moved vertically.
    expect(rect.getCenterPoint().x + 20).toBeCloseTo(300, 6);
    expect(rect.top).toBe(180);
  });

  it('leaves an object exactly on the boundary where it is', () => {
    const rect = new Rect({ left: 260, top: 180, width: 40, height: 40 });
    clampToPrintAreaFrame(rect, frame());
    expect(rect.left).toBe(260);
    expect(rect.top).toBe(180);
  });

  it('shrinks an object larger than the area and centres it', () => {
    const rect = new Rect({ left: 0, top: 0, width: 400, height: 400 });
    clampToPrintAreaFrame(rect, frame());
    expect(rect.scaleX).toBeCloseTo(0.5, 6);
    expect(rect.scaleY).toBeCloseTo(0.5, 6);
    expect(rect.getCenterPoint().x).toBeCloseTo(200, 6);
    expect(rect.getCenterPoint().y).toBeCloseTo(200, 6);
  });

  it('never touches the product image', () => {
    const background = new Rect({ left: -500, top: -500, width: 40, height: 40 });
    markAsBackground(background);
    clampToPrintAreaFrame(background, frame());
    expect(background.left).toBe(-500);
    expect(background.top).toBe(-500);
  });

  it('clamps along the area axes for a tilted area', () => {
    const tilted: PrintArea = {
      topLeft: { x: 0.5, y: 0.25 },
      topRight: { x: 0.75, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.5 },
    };
    const tiltedFrame = printAreaFrame(tilted, 400, 400);
    const rect = new Rect({ left: 380, top: 190, width: 20, height: 20 });

    clampToPrintAreaFrame(rect, tiltedFrame);

    // Inside the area's own frame, not merely inside its bounding box.
    const center = rect.getCenterPoint();
    const local = toFrameLocal(center.x, center.y, tiltedFrame);
    const projected = projectOntoFrame({ width: 20, height: 20, angle: 0 }, tiltedFrame);
    expect(Math.abs(local.x) + projected.halfW).toBeLessThanOrEqual(tiltedFrame.halfW + 1e-6);
    expect(Math.abs(local.y) + projected.halfH).toBeLessThanOrEqual(tiltedFrame.halfH + 1e-6);
  });
});

describe('printAreaPixelSize', () => {
  it('measures an axis-aligned area', () => {
    const area: PrintArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    expect(printAreaPixelSize(area, 400, 400)).toEqual({ width: 200, height: 200 });
  });

  it('averages opposite edges of a tapered area', () => {
    // Top edge spans 100px, bottom edge 200px — the effective width is the average.
    const tapered: PrintArea = {
      topLeft: { x: 0.375, y: 0 },
      topRight: { x: 0.625, y: 0 },
      bottomRight: { x: 0.75, y: 1 },
      bottomLeft: { x: 0.25, y: 1 },
    };
    expect(printAreaPixelSize(tapered, 400, 400).width).toBe(150);
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
