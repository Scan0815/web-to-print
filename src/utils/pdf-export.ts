import type { jsPDF as JsPDFType } from 'jspdf';
import { LogoData, LogoMetadata, Article, PrintArea, ArticleEditorState, DecorationState, ArticleView } from '../types';
import { printAreaToPixelCorners, upscaleSvgDataUrl } from './canvas-helpers';
import { computeContainFit } from './html-render-helpers';

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

/** Draws a two-column label/value table and returns the y below it. */
function renderRows(
  doc: JsPDFType,
  rows: [string, string][],
  x: number,
  y: number,
  options: { rowHeight: number; labelWidth: number; fontSize: number; maxWidth?: number },
): number {
  doc.setFontSize(options.fontSize);

  rows.forEach((row, i) => {
    const rowY = y + i * options.rowHeight;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], x + options.labelWidth, rowY, options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : undefined);
  });

  return y + rows.length * options.rowHeight;
}

/** Scales an image to fill the content width without exceeding the available height. */
function fitImage(contentWidth: number, maxHeight: number, aspectRatio: number): { width: number; height: number } {
  const { fittedW, fittedH } = computeContainFit(contentWidth, maxHeight, aspectRatio, 1);
  return { width: fittedW, height: fittedH };
}

/** Format a file size in bytes as a human-readable string. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/**
 * Generate and download a proof PDF for a single decoration.
 *
 * Thin wrapper around exportArticlePdf so there is only one PDF implementation —
 * kept for integrations written against the pre-0.2.0 single-decoration API.
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
  const view = article.views[viewIndex];
  if (view === undefined) throw new Error(`Article "${article.id}" has no view at index ${viewIndex}.`);

  const decoration: DecorationState = {
    viewId: view.id,
    label: view.label,
    ...(view.impMethod !== undefined ? { impMethod: view.impMethod } : {}),
    ...(view.impLocation !== undefined ? { impLocation: view.impLocation } : {}),
    ...(view.impWidthMm !== undefined ? { impWidthMm: view.impWidthMm } : {}),
    ...(view.impHeightMm !== undefined ? { impHeightMm: view.impHeightMm } : {}),
    ...(view.maxColours !== undefined ? { maxColours: view.maxColours } : {}),
    status: 'designed',
    state: {
      fabricJson: '',
      logos: [{ id: 'logo-1', dataUrl: logo.dataUrl, ...(logo.source !== undefined ? { source: logo.source } : {}) }],
      texts: [],
      productImage: view.image !== '' ? view.image : null,
      width: canvasWidth,
      height: canvasHeight,
    },
    issues: [],
  };

  await exportArticlePdf(
    { version: 2, articleId: article.id, decorations: [decoration] },
    article,
    { [view.id]: { dataUrl: productMockupDataUrl, width: canvasWidth, height: canvasHeight } },
    config,
    { [logo.source?.dataUrl ?? logo.dataUrl]: logo.metadata },
  );
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
  /** Upload metadata (DPI, dimensions), when the caller still has it. */
  metadata?: LogoMetadata;
  /** Labels of the decorations using this logo. */
  usedBy: string[];
}

/**
 * Collects every distinct logo across the designed decorations. The print shop pulls
 * the logo out of the PDF, so identical logos are emitted once but different ones must
 * all be present.
 */
export function collectLogoSources(decorations: DecorationState[], metadataByKey?: Record<string, LogoMetadata>): LogoSourcePage[] {
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
        ...(metadataByKey?.[key] !== undefined ? { metadata: metadataByKey[key] } : {}),
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
  const imgH = pageH * 0.5;
  const imgW = contentW;

  doc.addImage(rasterDataUrl, dataUrlToImageFormat(rasterDataUrl), (pageW - imgW) / 2, imgY, imgW, imgH, undefined, 'FAST');

  const meta = source.metadata;
  const rows: [string, string][] = [['Used on', source.usedBy.join(', ')]];
  if (source.fileName !== undefined) rows.push(['File name', source.fileName]);
  if (source.mimeType !== undefined) rows.push(['File type', source.mimeType]);
  if (source.fileSize !== undefined) rows.push(['File size', formatFileSize(source.fileSize)]);
  if (meta !== undefined) {
    rows.push(['Format', meta.format.toUpperCase()]);
    rows.push(['Dimensions', `${meta.width} x ${meta.height} px`]);
    rows.push(['DPI', meta.dpiX !== null ? `${meta.dpiX} x ${meta.dpiY ?? meta.dpiX}` : 'Not available']);
    rows.push(['Transparency', meta.hasTransparency ? 'Yes' : 'No']);
  }
  if (isSvgDataUrl(source.dataUrl)) {
    rows.push(['Note', 'Source is SVG; rasterized here. Request the vector file from the customer.']);
  }

  renderRows(doc, rows, margin, imgY + imgH + 10, { rowHeight: 7, labelWidth: 30, fontSize: 10, maxWidth: contentW - 30 });

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
  if (view?.impDiameterMm !== undefined && view.impDiameterMm > 0) {
    rows.push(['Print area', `\u00D8 ${view.impDiameterMm} mm`]);
  } else if (decoration.impWidthMm !== undefined && decoration.impHeightMm !== undefined) {
    rows.push(['Print area', `${decoration.impWidthMm} × ${decoration.impHeightMm} mm`]);
  }
  if (decoration.maxColours !== undefined) rows.push(['Max colours', `${decoration.maxColours}`]);
  if (logoPageNumbers.length > 0) {
    rows.push(['Logo source', logoPageNumbers.map(n => `page ${n}`).join(', ')]);
  }
  for (const issue of decoration.issues) {
    rows.push(['Warning', issue.message]);
  }

  const tableEnd = renderRows(doc, rows, margin, margin + 16, { rowHeight: 6, labelWidth: 30, fontSize: 9, maxWidth: contentW - 30 });

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  const tableBottom = tableEnd + 2;
  doc.line(margin, tableBottom, margin + contentW, tableBottom);

  const mockupY = tableBottom + 6;
  const maxMockupH = pageH - mockupY - margin - 6;

  const { width: imgW, height: imgH } = fitImage(contentW, maxMockupH, mockup.width / Math.max(mockup.height, 1));
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
  logoMetadata?: Record<string, LogoMetadata>,
): Promise<void> {
  const cfg = buildPdfConfig(config);
  const JsPDF = getJsPDF();

  const decorations = selectPrintableDecorations(state, cfg.viewIds);
  if (decorations.length === 0) {
    throw new Error('No designed decorations to export.');
  }

  const missingMockups = decorations.filter(d => mockups[d.viewId] === undefined).map(d => d.viewId);
  if (missingMockups.length > 0) {
    throw new Error(`Missing mockups for decoration(s): ${missingMockups.join(', ')}.`);
  }

  const sources = collectLogoSources(decorations, logoMetadata);
  const rasterSources = await Promise.all(sources.map(s => rasterizeDataUrl(s.dataUrl)));

  const doc = new JsPDF({ orientation: cfg.orientation, unit: 'mm', format: cfg.pageFormat });

  // A fresh jsPDF document already has one page, so the first render uses it as is.
  let pagesRendered = 0;
  const startPage = () => {
    if (pagesRendered > 0) doc.addPage();
    pagesRendered++;
  };

  sources.forEach((source, i) => {
    startPage();
    renderLogoSourcePage(doc, source, rasterSources[i], i, cfg);
  });

  const pageOfSource = new Map(sources.map((source, i) => [source.key, i + 1]));

  for (const decoration of decorations) {
    const mockup = mockups[decoration.viewId];
    startPage();

    const logoPages = decoration.state.logos
      .map(logo => pageOfSource.get(logo.source?.dataUrl ?? logo.dataUrl))
      .filter((n): n is number => n !== undefined);

    renderDecorationPage(doc, article, decoration, article.views.find(v => v.id === decoration.viewId), mockup, [...new Set(logoPages)], cfg);
  }

  doc.save(`${article.id}.pdf`);
}
