import type { jsPDF as JsPDFType } from 'jspdf';
import { LogoData, Article, PrintArea } from '../types';
import { printAreaToPixelCorners, upscaleSvgDataUrl } from './canvas-helpers';

export interface PdfExportConfig {
  pageFormat: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  showPrintAreaGuides: boolean;
  title: string;
}

const DEFAULT_PDF_CONFIG: PdfExportConfig = {
  pageFormat: 'a4',
  orientation: 'portrait',
  marginMm: 15,
  showPrintAreaGuides: true,
  title: 'Logo Print Specification',
};

/**
 * Get the jsPDF constructor from the global scope.
 * jsPDF must be loaded via script tag (e.g. from unpkg CDN) before calling exportProductPdf().
 * This avoids bundling jsPDF into the Stencil build (which fails due to Rollup/CommonJS conflicts).
 */
function getJsPDF(): new (opts: { orientation: string; unit: string; format: string }) => JsPDFType {
  const global = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
  const jspdfModule = global?.['jspdf'] as { jsPDF?: new (opts: { orientation: string; unit: string; format: string }) => JsPDFType } | undefined;
  if (jspdfModule?.jsPDF != null) {
    return jspdfModule.jsPDF;
  }
  throw new Error(
    'jsPDF is required for PDF export. Load it via: <script src="https://unpkg.com/jspdf@4.1.0/dist/jspdf.umd.min.js"></script>',
  );
}

/** Detect image format from a data URL for jsPDF's addImage(). */
export function dataUrlToImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  return 'PNG';
}

/** Returns true if the data URL is an SVG (which jsPDF cannot embed directly). */
export function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:image/svg+xml');
}

/**
 * Rasterize a data URL to PNG via an offscreen canvas.
 * SVG data URLs must be rasterized because jsPDF only supports PNG/JPEG.
 * For SVGs, upscaleSvgDataUrl is applied first so the browser rasterizes
 * the vector artwork at high resolution (maxSize px) instead of the often
 * tiny intrinsic SVG dimensions.
 * Non-SVG data URLs are returned unchanged.
 */
export function rasterizeDataUrl(dataUrl: string, maxSize: number = 4000): Promise<string> {
  if (!isSvgDataUrl(dataUrl)) return Promise.resolve(dataUrl);

  // Upscale SVG so the browser rasterizes vectors at high resolution
  const { dataUrl: upscaledUrl } = upscaleSvgDataUrl(dataUrl, maxSize);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || maxSize;
      const h = img.naturalHeight || maxSize;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx == null) {
        reject(new Error('Failed to get 2D context for SVG rasterization'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for rasterization'));
    img.src = upscaledUrl;
  });
}

/** Merge partial config with defaults. */
export function buildPdfConfig(partial?: Partial<PdfExportConfig>): PdfExportConfig {
  return { ...DEFAULT_PDF_CONFIG, ...partial };
}

/** Format a file size in bytes as a human-readable string. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Render page 1: logo at full quality with metadata table. */
function renderLogoPage(doc: JsPDFType, logo: LogoData, rasterLogoDataUrl: string, config: PdfExportConfig): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = config.marginMm;
  const contentW = pageW - 2 * margin;

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(config.title, pageW / 2, margin + 8, { align: 'center' });

  // Logo image — centered, filling available width while maintaining aspect ratio
  const logoFormat = dataUrlToImageFormat(rasterLogoDataUrl);
  const logoY = margin + 16;
  const maxLogoH = pageH * 0.5;

  const aspectRatio = logo.metadata.width / Math.max(logo.metadata.height, 1);
  let imgW = contentW;
  let imgH = imgW / aspectRatio;

  if (imgH > maxLogoH) {
    imgH = maxLogoH;
    imgW = imgH * aspectRatio;
  }

  const imgX = (pageW - imgW) / 2;
  doc.addImage(rasterLogoDataUrl, logoFormat, imgX, logoY, imgW, imgH);

  // Metadata table below the logo
  const tableY = logoY + imgH + 10;
  const meta = logo.metadata;
  const rows: [string, string][] = [
    ['Format', meta.format.toUpperCase()],
    ['Dimensions', `${meta.width} x ${meta.height} px`],
    ['DPI', meta.dpiX !== null ? `${meta.dpiX} x ${meta.dpiY ?? meta.dpiX}` : 'Not available'],
    ['File Size', formatFileSize(meta.fileSize)],
    ['Transparency', meta.hasTransparency ? 'Yes' : 'No'],
    ['File Name', meta.fileName],
  ];

  doc.setFontSize(10);
  const rowH = 7;
  const col1W = 30;

  rows.forEach((row, i) => {
    const y = tableY + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], margin + col1W, y);
  });

  // Separator line above the table
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, tableY - 4, margin + contentW, tableY - 4);
}

/** Draw dashed print area guide overlay on the product mockup. */
function drawPrintAreaGuide(
  doc: JsPDFType,
  printArea: PrintArea,
  imgX: number,
  imgY: number,
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
): void {
  const corners = printAreaToPixelCorners(printArea, canvasW, canvasH);

  const scaleX = imgW / canvasW;
  const scaleY = imgH / canvasH;

  const pdfCorners = corners.map(c => ({
    x: imgX + c.x * scaleX,
    y: imgY + c.y * scaleY,
  }));

  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([2, 1.5], 0);

  for (let i = 0; i < 4; i++) {
    const from = pdfCorners[i];
    const to = pdfCorners[(i + 1) % 4];
    doc.line(from.x, from.y, to.x, to.y);
  }

  doc.setLineDashPattern([], 0);
}

/** Render page 2: product mockup with header and print area guides. */
function renderProductPage(
  doc: JsPDFType,
  article: Article,
  viewIndex: number,
  mockupDataUrl: string,
  canvasW: number,
  canvasH: number,
  config: PdfExportConfig,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = config.marginMm;
  const contentW = pageW - 2 * margin;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(article.name, pageW / 2, margin + 8, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(article.description, pageW / 2, margin + 14, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  const mockupFormat = dataUrlToImageFormat(mockupDataUrl);
  const mockupY = margin + 22;
  const maxMockupH = pageH - mockupY - margin;

  const aspectRatio = canvasW / Math.max(canvasH, 1);
  let imgW = contentW;
  let imgH = imgW / aspectRatio;

  if (imgH > maxMockupH) {
    imgH = maxMockupH;
    imgW = imgH * aspectRatio;
  }

  const imgX = (pageW - imgW) / 2;
  doc.addImage(mockupDataUrl, mockupFormat, imgX, mockupY, imgW, imgH);

  const view = article.views[viewIndex];
  if (config.showPrintAreaGuides && view?.printArea != null) {
    drawPrintAreaGuide(doc, view.printArea, imgX, mockupY, imgW, imgH, canvasW, canvasH);
  }
}

/**
 * Generate and download a print-shop-ready PDF for a product.
 *
 * Page 1: Logo at full quality with metadata table.
 * Page 2: High-resolution product mockup with print area guides.
 *
 * Requires jsPDF to be loaded globally via script tag before calling this function.
 */
export async function exportProductPdf(
  logo: LogoData,
  article: Article,
  viewIndex: number,
  productMockupDataUrl: string,
  canvasWidth: number,
  canvasHeight: number,
  config?: Partial<PdfExportConfig>,
): Promise<void> {
  const cfg = buildPdfConfig(config);
  const JsPDF = getJsPDF();

  // Rasterize SVG data URLs — jsPDF only accepts PNG/JPEG
  const rasterLogoDataUrl = await rasterizeDataUrl(logo.dataUrl);

  const doc = new JsPDF({
    orientation: cfg.orientation,
    unit: 'mm',
    format: cfg.pageFormat,
  });

  // Page 1: Logo source
  renderLogoPage(doc, logo, rasterLogoDataUrl, cfg);

  // Page 2: Product mockup
  doc.addPage();
  renderProductPage(doc, article, viewIndex, productMockupDataUrl, canvasWidth, canvasHeight, cfg);

  doc.save(`${article.id}.pdf`);
}
