import { describe, it, expect, afterEach } from '@stencil/vitest';
import { jsPDF } from 'jspdf';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { exportArticlePdf } from './pdf-export';
import { loadPdfJs } from './pdf-render';
import type { Article, ArticleEditorState, PlacedLogo } from '../types';

/** The parts of pdf.js this test needs beyond what the library itself uses. */
interface InspectablePage {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
  getOperatorList(): Promise<{ fnArray: number[] }>;
}

interface InspectablePdfJs {
  OPS: Record<string, number>;
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<InspectablePage> }> };
}

const PX_PER_MM = 4;

const article: Article = {
  id: 'A-1',
  name: 'Test Article',
  description: '',
  views: [{ id: 'front', image: '', label: 'Front', printArea: null }],
};

function pngOfSize(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#888888';
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/**
 * A small L-shaped logo in the top-left corner of an otherwise empty A4 page: a red bar
 * with a blue square under its left end. Off-centre and asymmetric on both axes, so a
 * flipped or shifted embed cannot pass.
 */
function logoPdf(): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFillColor(255, 0, 0);
  doc.rect(20, 30, 40, 10, 'F');
  doc.setFillColor(0, 0, 255);
  doc.rect(20, 40, 10, 10, 'F');
  return doc.output('datauristring').replace(/^data:application\/pdf;[^,]*,/, 'data:application/pdf;base64,');
}

const MM = 72 / 25.4;

/** The same logo, with the page changed in a way jsPDF itself cannot produce. */
async function logoPdfVariant(variant: 'cropped' | 'rotated'): Promise<string> {
  const doc = await PDFDocument.load(logoPdf());
  const page = doc.getPage(0);
  // A crop box that starts 10 mm in from the left and top and is much smaller than the
  // media box: every coordinate of the artwork shifts against the visible page.
  if (variant === 'cropped') page.setCropBox(10 * MM, (297 - 70) * MM, 100 * MM, 60 * MM);
  if (variant === 'rotated') page.setRotation(degrees(90));
  return doc.saveAsBase64({ dataUri: true });
}

function pdfLogo(source: string): PlacedLogo {
  return { id: 'l1', dataUrl: pngOfSize(400, 200), source: { dataUrl: source, mimeType: 'application/pdf', fileName: 'logo.pdf', fileSize: source.length } };
}

function stateWith(logo: PlacedLogo): ArticleEditorState {
  return {
    version: 2,
    articleId: 'A-1',
    decorations: [
      {
        viewId: 'front',
        label: 'Front',
        status: 'designed',
        state: { fabricJson: '', logos: [logo], texts: [], productImage: null, width: 800, height: 600 },
        issues: [],
      },
    ],
  };
}

/** Runs the export and returns the PDF it would have downloaded. */
async function exportAndCapture(logo: PlacedLogo): Promise<ArrayBuffer> {
  const created: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return originalCreate.call(URL, blob);
  };

  try {
    await exportArticlePdf(stateWith(logo), article, { front: { dataUrl: pngOfSize(800, 600), width: 800, height: 600 } });
  } finally {
    URL.createObjectURL = originalCreate;
  }

  const pdf = created.find(blob => blob.type === 'application/pdf');
  if (pdf === undefined) throw new Error('The export did not produce a PDF blob.');
  return pdf.arrayBuffer();
}

async function openFirstPage(data: ArrayBuffer): Promise<{ page: InspectablePage; ops: Record<string, number>; numPages: number }> {
  const pdfjs = (await loadPdfJs()) as unknown as InspectablePdfJs;
  const document_ = await pdfjs.getDocument({ data }).promise;
  return { page: await document_.getPage(1), ops: pdfjs.OPS, numPages: document_.numPages };
}

/** Renders a proof page and returns a lookup of its colour at a position in millimetres. */
async function renderedColours(page: InspectablePage): Promise<(xMm: number, yMm: number) => number[]> {
  const viewport = page.getViewport({ scale: PX_PER_MM / MM });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  await page.render({ canvasContext: context, viewport }).promise;

  return (xMm, yMm) => [...context.getImageData(Math.round(xMm * PX_PER_MM), Math.round(yMm * PX_PER_MM), 1, 1).data.slice(0, 3)];
}

describe('vector logo in the proof PDF', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['jspdf'];
  });

  it('embeds the artwork of a PDF original as vector, cropped and the right way up', async () => {
    (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

    const proof = await exportAndCapture(pdfLogo(logoPdf()));

    const { page, ops, numPages } = await openFirstPage(proof);
    expect(numPages).toBe(2);

    // Vector: the logo page draws paths and carries no image at all.
    const { fnArray } = await page.getOperatorList();
    expect(fnArray).toContain(ops['paintFormXObjectBegin']);
    expect(fnArray).toContain(ops['constructPath']);
    expect(fnArray).not.toContain(ops['paintImageXObject']);

    // Position: the 40x20 mm artwork fills the 180 mm content width below the title —
    // red bar across the top half, blue square at the bottom left, nothing bottom right.
    const colourAt = await renderedColours(page);

    expect(colourAt(105, 50)).toEqual([255, 0, 0]);
    expect(colourAt(180, 50)).toEqual([255, 0, 0]);
    expect(colourAt(35, 95)).toEqual([0, 0, 255]);
    expect(colourAt(150, 95)).toEqual([255, 255, 255]);
    // Cropped: the rest of the source page did not come along.
    expect(colourAt(105, 150)).toEqual([255, 255, 255]);
  });

  it('maps the artwork correctly when the crop box differs from the media box', async () => {
    (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

    const proof = await exportAndCapture(pdfLogo(await logoPdfVariant('cropped')));
    const { page, ops } = await openFirstPage(proof);
    expect((await page.getOperatorList()).fnArray).toContain(ops['paintFormXObjectBegin']);

    const colourAt = await renderedColours(page);
    expect(colourAt(105, 50)).toEqual([255, 0, 0]);
    expect(colourAt(180, 50)).toEqual([255, 0, 0]);
    expect(colourAt(35, 95)).toEqual([0, 0, 255]);
    expect(colourAt(150, 95)).toEqual([255, 255, 255]);
  });

  it('falls back to the raster for a rotated page', async () => {
    (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

    const proof = await exportAndCapture(pdfLogo(await logoPdfVariant('rotated')));
    const { page, ops } = await openFirstPage(proof);

    const { fnArray } = await page.getOperatorList();
    expect(fnArray).toContain(ops['paintImageXObject']);
    expect(fnArray).not.toContain(ops['paintFormXObjectBegin']);
  });

  it('falls back to the raster when the original cannot be read', async () => {
    (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

    const proof = await exportAndCapture({
      id: 'l1',
      dataUrl: pngOfSize(400, 200),
      source: { dataUrl: 'data:application/pdf;base64,JVBERi0xLjc=', mimeType: 'application/pdf', fileName: 'broken.pdf', fileSize: 8 },
    });

    const { page, ops, numPages } = await openFirstPage(proof);
    expect(numPages).toBe(2);

    const { fnArray } = await page.getOperatorList();
    expect(fnArray).toContain(ops['paintImageXObject']);
    expect(fnArray).not.toContain(ops['paintFormXObjectBegin']);
  });

  describe('SVG originals', () => {
    const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
    const svgLogo = (svg: string): PlacedLogo => ({ id: 'l1', dataUrl: svgUrl(svg) });

    /**
     * The same L-shaped logo, written the way design tools export it: colours come from a
     * stylesheet, a class, an inherited group fill and a transform — none of them plain
     * attributes on the shape.
     */
    const STYLED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
      <defs><style>.bar{fill:#ff0000}</style></defs>
      <rect class="bar" width="400" height="100"/>
      <g fill="#0000ff" transform="translate(0 100)"><path d="M0 0h100v100h-100z"/></g>
      <rect x="300" y="100" width="100" height="100" style="display:none"/>
    </svg>`;

    it('redraws a flat SVG as vector paths with the colours the browser shows', async () => {
      (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

      const { page, ops } = await openFirstPage(await exportAndCapture(svgLogo(STYLED_SVG)));

      const { fnArray } = await page.getOperatorList();
      expect(fnArray).toContain(ops['constructPath']);
      expect(fnArray).not.toContain(ops['paintImageXObject']);

      const colourAt = await renderedColours(page);
      expect(colourAt(105, 50)).toEqual([255, 0, 0]);
      expect(colourAt(180, 50)).toEqual([255, 0, 0]);
      expect(colourAt(35, 95)).toEqual([0, 0, 255]);
      // Neither the hidden rect nor a default black fill shows up bottom right.
      expect(colourAt(150, 95)).toEqual([255, 255, 255]);
      expect(colourAt(180, 110)).toEqual([255, 255, 255]);
    });

    it('matches the browser rendering for curves, arcs, strokes and nested transforms', async () => {
      (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

      const complex = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
        <style>.o{fill:none;stroke:#00a000;stroke-width:12;stroke-linejoin:round;stroke-linecap:round}</style>
        <path d="M20 180C20 40 120 20 180 60S260 180 380 20" class="o"/>
        <path fill="#ff8000" fill-rule="evenodd" d="M40 40h80v80h-80zM60 60v40h40v-40z"/>
        <g transform="translate(300 120) rotate(30) scale(1.5 1)">
          <ellipse rx="40" ry="25" fill="#8000ff" opacity="0.5"/>
          <path d="M-30 0A30 30 0 0 1 30 0" fill="none" stroke="#000" stroke-width="4"/>
        </g>
        <g transform="matrix(0.8 0.2 -0.2 0.8 150 100)">
          <circle r="30" fill="#0080ff"/><polygon points="0,-20 20,20 -20,20" fill="#ffff00"/>
          <line x1="-40" y1="40" x2="40" y2="40" stroke="#ff0080" stroke-width="6"/>
          <polyline points="-40,50 0,60 40,50" fill="none" stroke="#000" stroke-width="2"/>
        </g>
      </svg>`;

      const { page } = await openFirstPage(await exportAndCapture(svgLogo(complex)));
      const colourAt = await renderedColours(page);

      // The browser's own rendering of the SVG, at the size it has on the proof page:
      // 180 x 90 mm at 15 / 31 mm.
      const image = new Image();
      image.src = svgUrl(complex);
      await image.decode();
      const reference = document.createElement('canvas');
      reference.width = 180 * PX_PER_MM;
      reference.height = 90 * PX_PER_MM;
      const context = reference.getContext('2d') as CanvasRenderingContext2D;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, reference.width, reference.height);
      context.drawImage(image, 0, 0, reference.width, reference.height);

      let differing = 0;
      let samples = 0;
      for (let y = 1; y < 90; y += 0.5) {
        for (let x = 1; x < 180; x += 0.5) {
          const expected = context.getImageData(Math.round(x * PX_PER_MM), Math.round(y * PX_PER_MM), 1, 1).data;
          const actual = colourAt(15 + x, 31 + y);
          samples++;
          if (Math.abs(expected[0] - actual[0]) + Math.abs(expected[1] - actual[1]) + Math.abs(expected[2] - actual[2]) > 60) differing++;
        }
      }

      // Only anti-aliased edges may differ.
      expect(differing / samples).toBeLessThan(0.005);
    });

    it('falls back to the raster for a translucent group', async () => {
      (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

      const group = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
        <g opacity="0.5"><rect width="300" height="200" fill="#f00"/><rect x="100" width="300" height="200" fill="#00f"/></g>
      </svg>`;
      const { page, ops } = await openFirstPage(await exportAndCapture(svgLogo(group)));

      expect((await page.getOperatorList()).fnArray).toContain(ops['paintImageXObject']);
    });

    it('falls back to the raster for an SVG with a gradient', async () => {
      (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF };

      const gradient = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
        <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#g)"/>
      </svg>`;
      const { page, ops } = await openFirstPage(await exportAndCapture(svgLogo(gradient)));

      expect((await page.getOperatorList()).fnArray).toContain(ops['paintImageXObject']);
    });
  });
});
