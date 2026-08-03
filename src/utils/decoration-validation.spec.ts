import { validateDecoration } from './decoration-validation';
import type { ArticleView, EditorState, PlacedText, PrintArea } from '../types/editor';
import type { LogoMetadata } from '../types/logo';

const PRINT_AREA: PrintArea = {
  topLeft: { x: 0.25, y: 0.25 },
  topRight: { x: 0.75, y: 0.25 },
  bottomRight: { x: 0.75, y: 0.75 },
  bottomLeft: { x: 0.25, y: 0.75 },
};

function text(fill: string, id = 't1'): PlacedText {
  return { id, text: 'Hello', fontFamily: 'Arial', fontSize: 24, fill, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0 } };
}

function state(overrides: Partial<EditorState> = {}): EditorState {
  return { fabricJson: '', logos: [], texts: [], productImage: null, width: 400, height: 400, ...overrides };
}

function view(overrides: Partial<ArticleView> = {}): ArticleView {
  return { id: 'front', image: '', label: 'Front', printArea: PRINT_AREA, ...overrides };
}

describe('validateDecoration', () => {
  it('returns nothing for an empty decoration', () => {
    expect(validateDecoration({ view: view(), state: state(), bounds: [], printArea: PRINT_AREA, canvasWidth: 400, canvasHeight: 400 })).toEqual([]);
  });

  // A catalog delivers pixel coordinates that have to be normalized against the product
  // image first. Until that finishes there is no print area to check against — but that is
  // not the same as the decoration having none, and reporting it as such freezes a wrong
  // finding into the decoration when the view is left.
  describe("printArea: 'pending'", () => {
    const pendingIssues = (overrides: Partial<Parameters<typeof validateDecoration>[0]> = {}) =>
      validateDecoration({
        view: view({ impWidthMm: 100, impHeightMm: 100 }),
        state: state({ texts: [text('#000000')] }),
        bounds: [{ left: 0, top: 0, width: 400, height: 400 }],
        printArea: 'pending',
        canvasWidth: 400,
        canvasHeight: 400,
        ...overrides,
      }).map(i => i.code);

    it('does not claim the decoration has no print area', () => {
      expect(pendingIssues()).not.toContain('missingPrintArea');
    });

    it('withholds the geometry findings rather than guessing them', () => {
      // The bounds above cover the whole canvas, so both would fire against a known area.
      expect(pendingIssues()).not.toContain('printAreaOverflow');
      expect(pendingIssues()).not.toContain('sizeOverflow');
    });

    it('still reports what does not depend on the print area', () => {
      const withLogo = { view: view({ maxColours: 1 }), state: state({ logos: [{ id: 'l1', dataUrl: 'data:image/png;base64,abc' }] }) };
      expect(pendingIssues(withLogo)).toContain('singleColourPrint');
      expect(pendingIssues({ productImageFailed: true })).toContain('productImageUnavailable');
    });

    it('reports a genuinely absent print area as before', () => {
      expect(pendingIssues({ printArea: null })).toContain('missingPrintArea');
    });
  });

  // A 45° print area: the case where a world-space bounding box and the area's own frame
  // disagree. The editor always supplies `sizes`, so this is the path it actually runs.
  const TILTED_AREA: PrintArea = {
    topLeft: { x: 0.5, y: 0.25 },
    topRight: { x: 0.75, y: 0.5 },
    bottomRight: { x: 0.5, y: 0.75 },
    bottomLeft: { x: 0.25, y: 0.5 },
  };

  it('reports an object outside a tilted print area', () => {
    // Centre sits ~106px along the area's local x-axis, well past its ~71px half-extent.
    const issues = validateDecoration({
      view: view({ printArea: TILTED_AREA }),
      state: state({ texts: [text('#000000')] }),
      bounds: [],
      sizes: [{ centerX: 350, centerY: 200, width: 20, height: 20, angle: 0 }],
      printArea: TILTED_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).toContain('printAreaOverflow');
  });

  it('accepts an object inside a tilted print area', () => {
    const issues = validateDecoration({
      view: view({ printArea: TILTED_AREA }),
      state: state({ texts: [text('#000000')] }),
      bounds: [],
      sizes: [{ centerX: 200, centerY: 200, width: 20, height: 20, angle: 0 }],
      printArea: TILTED_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).not.toContain('printAreaOverflow');
  });

  // Covers the bounds-only fallback for callers without sizes and angles — not the path
  // the editor takes.
  it('reports objects reaching outside the print area', () => {
    const issues = validateDecoration({
      view: view(),
      state: state({ texts: [text('#000000')] }),
      bounds: [{ left: 10, top: 10, width: 50, height: 50 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).toContain('printAreaOverflow');
    expect(issues.every(i => i.severity === 'warning')).toBe(true);
  });

  it('accepts objects inside the print area', () => {
    const issues = validateDecoration({
      view: view(),
      state: state({ texts: [text('#000000')] }),
      bounds: [{ left: 150, top: 150, width: 40, height: 40 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues).toEqual([]);
  });

  it('warns when a designed decoration has no print area', () => {
    const issues = validateDecoration({
      view: view({ printArea: null }),
      state: state({ texts: [text('#000000')] }),
      bounds: [],
      printArea: null,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).toEqual(['missingPrintArea']);
  });

  it('warns when more text colours than maxColours are used', () => {
    const issues = validateDecoration({
      view: view({ maxColours: 1 }),
      state: state({ texts: [text('#000000', 't1'), text('#ff0000', 't2')] }),
      bounds: [{ left: 150, top: 150, width: 10, height: 10 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).toContain('colourLimit');
  });

  it('ignores the colour limit for full colour printing', () => {
    const issues = validateDecoration({
      view: view({ maxColours: 'full color' }),
      state: state({ texts: [text('#000000', 't1'), text('#ff0000', 't2'), text('#00ff00', 't3')] }),
      bounds: [{ left: 150, top: 150, width: 10, height: 10 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues).toEqual([]);
  });

  it('asks for a monochrome logo on single-colour decorations', () => {
    const issues = validateDecoration({
      view: view({ maxColours: 1 }),
      state: state({ logos: [{ id: 'l1', dataUrl: 'data:image/png;base64,abc' }] }),
      bounds: [{ left: 150, top: 150, width: 10, height: 10 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues.map(i => i.code)).toEqual(['singleColourPrint']);
  });

  it('does not ask about monochrome for multi-colour decorations', () => {
    const issues = validateDecoration({
      view: view({ maxColours: 4 }),
      state: state({ logos: [{ id: 'l1', dataUrl: 'data:image/png;base64,abc' }] }),
      bounds: [{ left: 150, top: 150, width: 10, height: 10 }],
      printArea: PRINT_AREA,
      canvasWidth: 400,
      canvasHeight: 400,
    });

    expect(issues).toEqual([]);
  });

  // The print area spans 0.25-0.75 of a 400px canvas, so it is 200px wide and tall.
  // Declaring it as 100 x 100 mm makes the conversion exactly 0.5 mm per pixel.
  describe('physical size', () => {
    const sized = () => view({ impWidthMm: 100, impHeightMm: 100 });
    const logo = { id: 'l1', dataUrl: 'data:image/png;base64,abc' };

    it('warns when an element is larger than the declared print size', () => {
      const issues = validateDecoration({
        view: sized(),
        state: state({ logos: [logo] }),
        bounds: [{ left: 100, top: 100, width: 240, height: 100 }],
        printArea: PRINT_AREA,
        canvasWidth: 400,
        canvasHeight: 400,
      });

      const finding = issues.find(i => i.code === 'sizeOverflow');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('120');
      expect(finding?.message).toContain('100');
    });

    it('accepts an element fitted exactly to the print area', () => {
      const issues = validateDecoration({
        view: sized(),
        state: state({ logos: [logo] }),
        bounds: [{ left: 100, top: 100, width: 200, height: 200 }],
        printArea: PRINT_AREA,
        canvasWidth: 400,
        canvasHeight: 400,
      });

      expect(issues.map(i => i.code)).not.toContain('sizeOverflow');
    });

    it('measures a rotated element in the print area frame, not its bounding box', () => {
      // A 45° print area of the same 200 x 200 px, with a logo rotated to match it.
      // The world-space bounding box would be 1.41x too large and warn on a perfect fit.
      const tilted: PrintArea = {
        topLeft: { x: 0.5, y: 0.25 },
        topRight: { x: 0.75, y: 0.5 },
        bottomRight: { x: 0.5, y: 0.75 },
        bottomLeft: { x: 0.25, y: 0.5 },
      };
      const side = Math.hypot(100, 100);

      const issues = validateDecoration({
        view: view({ printArea: tilted, impWidthMm: 100, impHeightMm: 100 }),
        state: state({ logos: [logo] }),
        bounds: [{ left: 100, top: 100, width: 200, height: 200 }],
        sizes: [{ centerX: 200, centerY: 200, width: side, height: side, angle: 45 }],
        printArea: tilted,
        canvasWidth: 400,
        canvasHeight: 400,
      });

      expect(issues.map(i => i.code)).not.toContain('sizeOverflow');
    });

    it('still catches a rotated element that is genuinely too large', () => {
      const issues = validateDecoration({
        view: sized(),
        state: state({ logos: [logo] }),
        bounds: [{ left: 0, top: 0, width: 400, height: 400 }],
        sizes: [{ centerX: 200, centerY: 200, width: 300, height: 200, angle: 90 }],
        printArea: PRINT_AREA,
        canvasWidth: 400,
        canvasHeight: 400,
      });

      expect(issues.map(i => i.code)).toContain('sizeOverflow');
    });

    it('skips the check when the catalog declares no mm dimensions', () => {
      const issues = validateDecoration({
        view: view({ impWidthMm: 100 }),
        state: state({ logos: [logo] }),
        bounds: [{ left: 100, top: 100, width: 240, height: 240 }],
        printArea: PRINT_AREA,
        canvasWidth: 400,
        canvasHeight: 400,
      });

      expect(issues.map(i => i.code)).not.toContain('sizeOverflow');
    });
  });

  describe('resolution', () => {
    const metadata = (overrides: Partial<LogoMetadata> = {}): LogoMetadata => ({
      format: 'png',
      width: 500,
      height: 500,
      dpiX: 72,
      dpiY: 72,
      fileSize: 1024,
      fileName: 'logo.png',
      mimeType: 'image/png',
      hasTransparency: false,
      ...overrides,
    });

    const withLogo = (logoMetadata: LogoMetadata[]) =>
      validateDecoration({
        view: view(),
        state: state({ logos: [{ id: 'l1', dataUrl: 'data:image/png;base64,abc' }] }),
        bounds: [{ left: 150, top: 150, width: 10, height: 10 }],
        printArea: PRINT_AREA,
        canvasWidth: 400,
        canvasHeight: 400,
        logoMetadata,
      });

    it('warns about a logo below the recommended print resolution', () => {
      const finding = withLogo([metadata()]).find(i => i.code === 'lowDpi');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('logo.png');
      expect(finding?.message).toContain('72');
    });

    it('accepts a logo at the recommended resolution', () => {
      expect(withLogo([metadata({ dpiX: 300, dpiY: 300 })]).map(i => i.code)).not.toContain('lowDpi');
    });

    it('stays quiet when the DPI could not be determined', () => {
      expect(withLogo([metadata({ dpiX: null, dpiY: null })]).map(i => i.code)).not.toContain('lowDpi');
    });

    it('does not judge vector sources by DPI', () => {
      expect(withLogo([metadata({ format: 'svg', dpiX: 72 })]).map(i => i.code)).not.toContain('lowDpi');
    });

    it('uses the lower of the two axes', () => {
      const finding = withLogo([metadata({ dpiX: 600, dpiY: 96 })]).find(i => i.code === 'lowDpi');
      expect(finding?.message).toContain('96');
    });
  });
});
