import type { jsPDF as JsPDFType } from 'jspdf';
import { LogoData, Article, PrintArea, ArticleEditorState, DecorationState, ArticleView } from '../types';
import { printAreaToPixelCorners, upscaleSvgDataUrl } from './canvas-helpers';

export interface PdfExportConfig {
  pageFormat: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  showPrintAreaGuides: boolean;
  title: string;
  /** Restricts the export to these decoration ids — e.g. the ones actually ordered. */
  viewIds?: string[];
  /** Printed on every page: this document is a proof, not print data. */
  proofNotice: string;
}

const DEFAULT_PDF_CONFIG: PdfExportConfig = {
  pageFormat: 'a4',
  orientation: 'portrait',
  marginMm: 15,
  showPrintAreaGuides: true,
  title: 'Logo Print Specification',
  proofNotice: 'Proof / placement reference — not print data (RGB, no bleed or crop marks).',
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

  // Article details table
  const view = article.views[viewIndex];
  const detailRows: [string, string][] = [['Article ID', article.id]];

  if (view?.impMethod) detailRows.push(['Print Method', view.impMethod]);
  if (view?.impLocation) detailRows.push(['Print Location', view.impLocation]);

  if (view?.impDiameterMm && view.impDiameterMm > 0) {
    detailRows.push(['Print Area', `\u00D8 ${view.impDiameterMm} mm`]);
  } else if (view?.impWidthMm && view?.impHeightMm) {
    detailRows.push(['Print Area', `${view.impWidthMm} \u00D7 ${view.impHeightMm} mm`]);
  }

  if (view?.maxColours) detailRows.push(['Max Colors', `${view.maxColours}`]);

  const detailRowH = 6;
  const detailCol1W = 30;
  const detailTableY = margin + 16;

  doc.setFontSize(9);
  detailRows.forEach((row, i) => {
    const y = detailTableY + i * detailRowH;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], margin + detailCol1W, y);
  });

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, detailTableY + detailRows.length * detailRowH + 2, margin + contentW, detailTableY + detailRows.length * detailRowH + 2);

  const mockupFormat = dataUrlToImageFormat(mockupDataUrl);
  const mockupY = detailTableY + detailRows.length * detailRowH + 6;
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

// --- Multi-decoration export -------------------------------------------------

/** Rendered mockup of one decoration, produced by the editor. */
export interface DecorationMockup {
  dataUrl: string;
  width: number;
  height: number;
}

/** A distinct logo file, plus the decorations it is used on. */
export interface LogoSourcePage {
  /** Deduplication key — the source data URL. */
  key: string;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Labels of the decorations using this logo. */
  usedBy: string[];
}

/**
 * Collects every distinct logo across the designed decorations. The print shop pulls
 * the logo out of the PDF, so identical logos are emitted once but different ones must
 * all be present.
 */
export function collectLogoSources(decorations: DecorationState[]): LogoSourcePage[] {
  const pages = new Map<string, LogoSourcePage>();

  for (const decoration of decorations) {
    for (const logo of decoration.state.logos) {
      const key = logo.source?.dataUrl ?? logo.dataUrl;
      const existing = pages.get(key);
      if (existing !== undefined) {
        if (!existing.usedBy.includes(decoration.label)) existing.usedBy.push(decoration.label);
        continue;
      }

      pages.set(key, {
        key,
        dataUrl: key,
        ...(logo.source?.fileName !== undefined ? { fileName: logo.source.fileName } : {}),
        ...(logo.source?.mimeType !== undefined ? { mimeType: logo.source.mimeType } : {}),
        ...(logo.source?.fileSize !== undefined ? { fileSize: logo.source.fileSize } : {}),
        usedBy: [decoration.label],
      });
    }
  }

  return [...pages.values()];
}

/** Decorations that carry a design, optionally narrowed to the ordered ones. */
export function selectPrintableDecorations(state: ArticleEditorState, viewIds?: string[]): DecorationState[] {
  return state.decorations.filter(d => d.status === 'designed' && (viewIds === undefined || viewIds.includes(d.viewId)));
}

function renderProofNotice(doc: JsPDFType, config: PdfExportConfig): void {
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(config.proofNotice, config.marginMm, pageH - 6);
  doc.setTextColor(0, 0, 0);
}

/** One page per distinct logo: the source file at full quality, plus where it is used. */
function renderLogoSourcePage(doc: JsPDFType, source: LogoSourcePage, rasterDataUrl: string, index: number, config: PdfExportConfig): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = config.marginMm;
  const contentW = pageW - 2 * margin;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Logo source ${index + 1}`, pageW / 2, margin + 8, { align: 'center' });

  const imgY = margin + 16;
  const maxImgH = pageH * 0.5;
  let imgW = contentW;
  let imgH = maxImgH;

  doc.addImage(rasterDataUrl, dataUrlToImageFormat(rasterDataUrl), (pageW - imgW) / 2, imgY, imgW, imgH, undefined, 'FAST');

  const rows: [string, string][] = [['Used on', source.usedBy.join(', ')]];
  if (source.fileName !== undefined) rows.push(['File name', source.fileName]);
  if (source.mimeType !== undefined) rows.push(['File type', source.mimeType]);
  if (source.fileSize !== undefined) rows.push(['File size', formatFileSize(source.fileSize)]);
  if (isSvgDataUrl(source.dataUrl)) {
    rows.push(['Note', 'Source is SVG; rasterized here. Request the vector file from the customer.']);
  }

  const tableY = imgY + imgH + 10;
  doc.setFontSize(10);
  rows.forEach((row, i) => {
    const y = tableY + i * 7;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], margin + 30, y, { maxWidth: contentW - 30 });
  });

  renderProofNotice(doc, config);
}

/** One page per decoration: mockup, print-area guide, decoration data and warnings. */
function renderDecorationPage(
  doc: JsPDFType,
  article: Article,
  decoration: DecorationState,
  view: ArticleView | undefined,
  mockup: DecorationMockup,
  logoPageNumbers: number[],
  config: PdfExportConfig,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = config.marginMm;
  const contentW = pageW - 2 * margin;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`${article.name} — ${decoration.label}`, pageW / 2, margin + 8, { align: 'center' });

  const rows: [string, string][] = [
    ['Article ID', article.id],
    ['Decoration ID', decoration.viewId],
  ];
  if (decoration.impMethod !== undefined) rows.push(['Print method', decoration.impMethod]);
  if (decoration.impLocation !== undefined) rows.push(['Print location', decoration.impLocation]);
  if (decoration.impWidthMm !== undefined && decoration.impHeightMm !== undefined) {
    rows.push(['Print area', `${decoration.impWidthMm} × ${decoration.impHeightMm} mm`]);
  }
  if (decoration.maxColours !== undefined) rows.push(['Max colours', `${decoration.maxColours}`]);
  if (logoPageNumbers.length > 0) {
    rows.push(['Logo source', logoPageNumbers.map(n => `page ${n}`).join(', ')]);
  }
  for (const issue of decoration.issues) {
    rows.push(['Warning', issue.message]);
  }

  const rowH = 6;
  const tableY = margin + 16;
  doc.setFontSize(9);
  rows.forEach((row, i) => {
    const y = tableY + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], margin + 30, y, { maxWidth: contentW - 30 });
  });

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  const tableBottom = tableY + rows.length * rowH + 2;
  doc.line(margin, tableBottom, margin + contentW, tableBottom);

  const mockupY = tableBottom + 6;
  const maxMockupH = pageH - mockupY - margin - 6;
  const aspectRatio = mockup.width / Math.max(mockup.height, 1);
  let imgW = contentW;
  let imgH = imgW / aspectRatio;

  if (imgH > maxMockupH) {
    imgH = maxMockupH;
    imgW = imgH * aspectRatio;
  }

  const imgX = (pageW - imgW) / 2;
  doc.addImage(mockup.dataUrl, dataUrlToImageFormat(mockup.dataUrl), imgX, mockupY, imgW, imgH);

  if (config.showPrintAreaGuides && view?.printArea != null) {
    drawPrintAreaGuide(doc, view.printArea, imgX, mockupY, imgW, imgH, mockup.width, mockup.height);
  }

  renderProofNotice(doc, config);
}

/**
 * Generate a proof PDF covering every designed decoration of an article.
 *
 * Distinct logo sources come first (deduplicated), then one page per decoration with
 * its mockup, print-area guide, decoration data and validation warnings.
 *
 * This document is a proof, not print data — see PdfExportConfig.proofNotice.
 * Requires jsPDF to be loaded globally via script tag before calling this function.
 */
export async function exportArticlePdf(
  state: ArticleEditorState,
  article: Article,
  mockups: Record<string, DecorationMockup>,
  config?: Partial<PdfExportConfig>,
): Promise<void> {
  const cfg = buildPdfConfig(config);
  const JsPDF = getJsPDF();

  const decorations = selectPrintableDecorations(state, cfg.viewIds);
  if (decorations.length === 0) {
    throw new Error('No designed decorations to export.');
  }

  const sources = collectLogoSources(decorations);
  const rasterSources = await Promise.all(sources.map(s => rasterizeDataUrl(s.dataUrl)));

  const doc = new JsPDF({ orientation: cfg.orientation, unit: 'mm', format: cfg.pageFormat });

  sources.forEach((source, i) => {
    if (i > 0) doc.addPage();
    renderLogoSourcePage(doc, source, rasterSources[i], i, cfg);
  });

  const pageOfSource = new Map(sources.map((source, i) => [source.key, i + 1]));

  for (const decoration of decorations) {
    const mockup = mockups[decoration.viewId];
    if (mockup === undefined) continue;

    if (doc.getNumberOfPages() > 0) doc.addPage();

    const logoPages = decoration.state.logos
      .map(logo => pageOfSource.get(logo.source?.dataUrl ?? logo.dataUrl))
      .filter((n): n is number => n !== undefined);

    renderDecorationPage(doc, article, decoration, article.views.find(v => v.id === decoration.viewId), mockup, [...new Set(logoPages)], cfg);
  }

  doc.save(`${article.id}.pdf`);
}
