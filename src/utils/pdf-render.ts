/**
 * Rasterizes the first page of a PDF (or a PDF-compatible Illustrator file) so it can be
 * shown on the canvas. The uploaded original is kept separately and travels to the print
 * shop untouched — this raster is only what the browser can draw.
 *
 * pdf.js is bundled as lazily loaded chunks (see loadPdfJs), so it costs nothing until
 * the first PDF/AI upload.
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
  version?: string;
}

export interface RenderedPdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Longest side of the rasterized page, in pixels. */
const DEFAULT_MAX_SIZE = 2000;

/**
 * Always true since pdf.js ships with the library.
 * @deprecated Kept so existing integrations keep compiling.
 */
export function isPdfRenderingAvailable(): boolean {
  return true;
}

/** A pdf.js build the host put on the window; takes precedence over the bundled one. */
function getHostPdfJs(): PdfJsLib | undefined {
  const global = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
  const lib = global?.['pdfjsLib'] as PdfJsLib | undefined;
  return lib?.getDocument != null ? lib : undefined;
}

/**
 * pdf.js refuses to parse anything without a worker script, and the worker must be the
 * exact same release as the API. A host that brings its own pdf.js but no worker gets
 * the matching unpkg build; a worker the host configured itself is never overwritten.
 */
export function ensurePdfWorker(lib: PdfJsLib): void {
  const options = lib.GlobalWorkerOptions;
  if (options === undefined || lib.version === undefined) return;
  if (options.workerSrc !== '' && options.workerSrc != null) return;

  options.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
}

/**
 * Resolves pdf.js. The library ships its own copy as lazily loaded chunks, so hosts need
 * no script tag and nothing is fetched from a CDN; the chunks are only requested on the
 * first PDF/AI upload. The worker code is loaded as a module too and runs on the main
 * thread — pdf.js picks it up from `globalThis.pdfjsWorker` — because a real Worker needs
 * a standalone script URL the bundle cannot provide. Rasterizing one logo page is cheap
 * enough for that.
 *
 * A host that wants a real worker (or another pdf.js release) sets `window.pdfjsLib`.
 */
export async function loadPdfJs(): Promise<PdfJsLib> {
  const hostLib = getHostPdfJs();
  if (hostLib !== undefined) {
    ensurePdfWorker(hostLib);
    return hostLib;
  }

  const [lib] = await Promise.all([import('pdfjs-dist/build/pdf.min.mjs'), import('pdfjs-dist/build/pdf.worker.min.mjs')]);
  return lib as unknown as PdfJsLib;
}

export async function renderPdfFirstPage(file: File, maxSize: number = DEFAULT_MAX_SIZE): Promise<RenderedPdfPage> {
  const pdfjs = await loadPdfJs();
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
