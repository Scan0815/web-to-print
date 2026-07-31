/**
 * Rasterizes the first page of a PDF (or a PDF-compatible Illustrator file) so it can be
 * shown on the canvas. The uploaded original is kept separately and travels to the print
 * shop untouched — this raster is only what the browser can draw.
 *
 * pdf.js is expected as a global, the same way jsPDF is, which keeps it out of the
 * Stencil bundle (Rollup/CommonJS conflicts) and out of the library's dependencies.
 */

interface PdfPageViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(params: { scale: number }): PdfPageViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfPageViewport }): { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfJsLib {
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
  GlobalWorkerOptions?: { workerSrc: string };
}

export interface RenderedPdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Longest side of the rasterized page, in pixels. */
const DEFAULT_MAX_SIZE = 2000;

export function getPdfJs(): PdfJsLib {
  const global = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
  const lib = global?.['pdfjsLib'] as PdfJsLib | undefined;
  if (lib?.getDocument != null) return lib;

  throw new Error(
    'pdf.js is required for PDF/AI uploads. Load it via: <script src="https://unpkg.com/pdfjs-dist@5/build/pdf.min.mjs" type="module"></script>',
  );
}

/** True when pdf.js is available — lets callers reject PDF uploads with a clear message. */
export function isPdfRenderingAvailable(): boolean {
  try {
    getPdfJs();
    return true;
  } catch {
    return false;
  }
}

export async function renderPdfFirstPage(file: File, maxSize: number = DEFAULT_MAX_SIZE): Promise<RenderedPdfPage> {
  const pdfjs = getPdfJs();
  const data = await file.arrayBuffer();

  let document_: PdfDocument;
  try {
    document_ = await pdfjs.getDocument({ data }).promise;
  } catch (e) {
    const isAi = file.name.toLowerCase().endsWith('.ai');
    throw new Error(
      isAi
        ? 'This AI file was saved without PDF compatibility. Please re-save it with PDF compatibility enabled, or upload a PDF.'
        : `Could not read the PDF: ${e instanceof Error ? e.message : 'unknown error'}`,
    );
  }

  const page = await document_.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = maxSize / Math.max(baseViewport.width, baseViewport.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not create a 2D context to rasterize the PDF.');

  await page.render({ canvasContext: context, viewport }).promise;

  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
