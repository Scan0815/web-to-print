/**
 * Rasterizes the first page of a PDF (or a PDF-compatible Illustrator file) so it can be
 * shown on the canvas. The uploaded original is kept separately and travels to the print
 * shop untouched — this raster is only what the browser can draw.
 *
 * pdf.js is bundled as lazily loaded chunks (see loadPdfJs), so it costs nothing until
 * the first PDF/AI upload.
 */

import { colorDistance, findOpaqueBoundingBox } from './background-removal';

interface PdfPageViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(params: { scale: number; offsetX?: number; offsetY?: number }): PdfPageViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfPageViewport; background?: string }): { promise: Promise<void> };
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

/** A region of the page as 0-1 fractions, measured from the top-left corner. */
export interface PdfTrimBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderedPdfPage {
  dataUrl: string;
  width: number;
  height: number;
  /** The part of the page the raster shows; the full page when nothing was trimmed. */
  trimBox: PdfTrimBox;
  /**
   * True when the page is painted edge to edge — typically a file that draws its own
   * white page background. The raster is still trimmed to the artwork, but it is opaque.
   */
  hasPageBackground: boolean;
}

/** Longest side of the rasterized artwork, in pixels. */
const DEFAULT_MAX_SIZE = 2000;

/** Transparent margin kept around the trimmed artwork, in measuring-pass pixels. */
const TRIM_PADDING = 2;

/** Artwork covering at least this share of both page sides is not worth a second render. */
const TRIM_MIN_GAIN = 0.98;

/** Upper bound for the zoom of the trimmed render, so a speck cannot request a huge scale. */
const MAX_TRIM_ZOOM = 8;

/** Page background kept around the artwork of a painted page, in measuring-pass pixels. */
const PAGE_BACKGROUND_PADDING = 12;

/** RGB distance up to which a pixel still counts as the page colour. */
const PAGE_COLOUR_TOLERANCE = 12;

const FULL_PAGE: PdfTrimBox = { x: 0, y: 0, width: 1, height: 1 };

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

  // Pass 1: the whole page, to find where the artwork sits.
  const pageCanvas = await renderRegion(page, scale, 0, 0, Math.round(baseViewport.width * scale), Math.round(baseViewport.height * scale));
  const fullPage: RenderedPdfPage = { dataUrl: pageCanvas.toDataURL('image/png'), width: pageCanvas.width, height: pageCanvas.height, trimBox: FULL_PAGE, hasPageBackground: false };

  const pixels = pageCanvas.getContext('2d')?.getImageData(0, 0, pageCanvas.width, pageCanvas.height);
  let box = pixels !== undefined ? findOpaqueBoundingBox(pixels) : null;
  if (pixels === undefined || box === null) return fullPage;

  const coversPage = (b: [number, number, number, number]) =>
    b[2] - b[0] + 1 >= pageCanvas.width * TRIM_MIN_GAIN && b[3] - b[1] + 1 >= pageCanvas.height * TRIM_MIN_GAIN;

  // A page painted edge to edge has no transparent margin to measure. The artwork is
  // then whatever differs from the page colour; the background itself stays in the
  // raster, so more of it is kept around the artwork for the remover to sample.
  let hasPageBackground = false;
  let padding = TRIM_PADDING;
  if (coversPage(box)) {
    hasPageBackground = true;
    padding = PAGE_BACKGROUND_PADDING;
    const pageColour = uniformCornerColour(pixels);
    const artwork = pageColour !== null ? findBoundingBoxDifferingFrom(pixels, pageColour) : null;
    if (artwork === null || coversPage(artwork)) return { ...fullPage, hasPageBackground };
    box = artwork;
  }

  const left = Math.max(0, box[0] - padding);
  const top = Math.max(0, box[1] - padding);
  const boxW = Math.min(pageCanvas.width, box[2] + 1 + padding) - left;
  const boxH = Math.min(pageCanvas.height, box[3] + 1 + padding) - top;

  // Pass 2: only the artwork, zoomed so it — not the page — gets the full resolution.
  // Cropping pass 1 instead would leave a small logo on a large page badly pixelated.
  const zoom = Math.min(maxSize / Math.max(boxW, boxH), MAX_TRIM_ZOOM);
  const trimmed = await renderRegion(page, scale * zoom, left * zoom, top * zoom, Math.round(boxW * zoom), Math.round(boxH * zoom));

  return {
    dataUrl: trimmed.toDataURL('image/png'),
    width: trimmed.width,
    height: trimmed.height,
    trimBox: { x: left / pageCanvas.width, y: top / pageCanvas.height, width: boxW / pageCanvas.width, height: boxH / pageCanvas.height },
    hasPageBackground,
  };
}

/** The colour shared by all four page corners, or null when they differ. */
function uniformCornerColour(pixels: ImageData): [number, number, number] | null {
  const { data, width, height } = pixels;
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const first = at(0, 0);
  const others = [at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  return others.every(c => colorDistance(c[0], c[1], c[2], first[0], first[1], first[2]) <= PAGE_COLOUR_TOLERANCE) ? first : null;
}

/** Bounding box [minX, minY, maxX, maxY] of all pixels that are not the given colour. */
function findBoundingBoxDifferingFrom(pixels: ImageData, colour: [number, number, number]): [number, number, number, number] | null {
  const { data, width, height } = pixels;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (colorDistance(data[i], data[i + 1], data[i + 2], colour[0], colour[1], colour[2]) > PAGE_COLOUR_TOLERANCE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return maxX === -1 ? null : [minX, minY, maxX, maxY];
}

/**
 * Draws a region of the page — given in pixels at `scale` — onto a canvas of its own.
 * The background stays transparent: pdf.js would otherwise paint the page white, which
 * puts a white sheet around the logo on any coloured product.
 */
async function renderRegion(page: PdfPage, scale: number, x: number, y: number, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not create a 2D context to rasterize the PDF.');

  const viewport = page.getViewport({ scale, offsetX: -x, offsetY: -y });
  await page.render({ canvasContext: context, viewport, background: 'rgba(0,0,0,0)' }).promise;

  return canvas;
}
