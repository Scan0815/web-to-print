import { validateDecoration } from './decoration-validation';
import type { ArticleView, EditorState, PlacedText, PrintArea } from '../types/editor';

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
});
