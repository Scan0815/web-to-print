/**
 * Puts an uploaded vector original — PDF/AI or SVG — into the proof PDF as vector data.
 *
 * jsPDF lays the proof out but can embed neither, so the finished proof is post-processed
 * with pdf-lib, which draws the logo into the box the layout left empty for it:
 *
 * - PDF/AI: the first page of the original becomes a form XObject, clipped to the
 *   artwork. Its drawing operators and colour spaces are copied as they are.
 * - SVG: the shapes are redrawn as PDF paths. That is a conversion, and it only covers
 *   flat artwork; anything it could get wrong is refused (see prepareSvgLogo).
 *
 * pdf-lib is bundled as a lazily loaded chunk and only requested when a proof actually
 * contains such a logo.
 */

import type { PDFPage } from '@cantoo/pdf-lib';
import { renderPdfFirstPage } from './pdf-render';

const MM_TO_PT = 72 / 25.4;

/** The first page of an uploaded PDF/AI original, ready to be embedded. */
export interface PdfVectorLogo {
  kind: 'pdf';
  page: PDFPage;
  /** The artwork in the page's own user space (points, origin bottom-left). */
  box: { left: number; bottom: number; right: number; top: number };
  /** Width / height of the artwork. */
  aspectRatio: number;
}

/** An SVG original reduced to plain shapes with explicit colours, ready to be drawn. */
export interface SvgVectorLogo {
  kind: 'svg';
  svg: string;
  /** Width / height of the SVG viewport. */
  aspectRatio: number;
}

export type VectorLogo = PdfVectorLogo | SvgVectorLogo;

/** Where on the proof a vector logo goes: millimetres, measured from the top-left corner. */
export interface VectorLogoPlacement {
  logo: VectorLogo;
  pageIndex: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

const loadPdfLib = () => import('@cantoo/pdf-lib');

/**
 * Reads a PDF/AI original and locates its artwork. Resolves to null whenever the file
 * cannot be embedded safely — unreadable, encrypted, a rotated page — so the caller can
 * fall back to the raster.
 */
export async function preparePdfLogo(source: { dataUrl: string; fileName?: string }): Promise<PdfVectorLogo | null> {
  try {
    const bytes = await (await fetch(source.dataUrl)).arrayBuffer();

    // Same measurement as the upload, so the vector shows what the canvas raster shows.
    const { trimBox } = await renderPdfFirstPage(new File([bytes], source.fileName ?? 'logo.pdf'));

    const { PDFDocument } = await loadPdfLib();
    const page = (await PDFDocument.load(bytes)).getPage(0);

    // The trim box is measured on the page as displayed; an embedded page ignores /Rotate,
    // so the two only line up for an unrotated page.
    if (page.getRotation().angle % 360 !== 0) throw new Error('the page is rotated');

    // pdf.js displays the crop box clipped to the media box.
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    const viewLeft = Math.max(media.x, crop.x);
    const viewBottom = Math.max(media.y, crop.y);
    const viewWidth = Math.min(media.x + media.width, crop.x + crop.width) - viewLeft;
    const viewHeight = Math.min(media.y + media.height, crop.y + crop.height) - viewBottom;
    if (!(viewWidth > 0) || !(viewHeight > 0)) throw new Error('the page has no visible area');

    // The trim box counts from the top-left corner, PDF user space from the bottom-left.
    const left = viewLeft + trimBox.x * viewWidth;
    const top = viewBottom + viewHeight - trimBox.y * viewHeight;
    const right = left + trimBox.width * viewWidth;
    const bottom = top - trimBox.height * viewHeight;
    if (!(right > left) || !(top > bottom)) throw new Error('the artwork has no size');

    return { kind: 'pdf', page, box: { left, bottom, right, top }, aspectRatio: (right - left) / (top - bottom) };
  } catch (e) {
    console.warn(`web-to-print: "${source.fileName ?? 'logo'}" cannot be embedded as vector, the proof shows a raster instead.`, e);
    return null;
  }
}

const SVG_SHAPES = 'path, rect, circle, ellipse, line, polygon, polyline';

/**
 * Everything the SVG-to-PDF conversion cannot reproduce. A logo using any of it would
 * come out visibly wrong (a gradient as a black shape, text in another font), so it is
 * refused rather than converted.
 */
const SVG_UNSUPPORTED = 'linearGradient, radialGradient, pattern, mask, clipPath, filter, text, image, foreignObject, use, symbol, marker, switch';

/** Presentation attributes the conversion reads; they are rewritten from computed styles. */
const SVG_PAINT_ATTRIBUTES = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'style', 'class'];

/**
 * Reads an SVG original and reduces it to shapes with explicit colours. Resolves to null
 * when the file uses a feature that cannot be converted faithfully, so the caller can
 * fall back to the raster.
 *
 * Colours are taken from the browser's computed styles, which resolves `<style>` sheets,
 * classes and inheritance the way the SVG is actually displayed — pdf-lib itself only
 * understands attributes.
 */
export async function prepareSvgLogo(source: { dataUrl: string; fileName?: string }): Promise<SvgVectorLogo | null> {
  // The shadow root keeps the host page's stylesheets away from the logo.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';

  try {
    const text = await (await fetch(source.dataUrl)).text();
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.tagName !== 'svg' || parsed.querySelector('parsererror') !== null) throw new Error('the file is not valid SVG');

    const unsupported = root.querySelector(SVG_UNSUPPORTED);
    if (unsupported !== null) throw new Error(`it uses <${unsupported.tagName}>`);

    const svg = document.importNode(root, true) as unknown as SVGSVGElement;
    host.attachShadow({ mode: 'open' }).appendChild(svg);
    document.body.appendChild(host);

    const viewBox = svg.viewBox.baseVal;
    const width = viewBox.width > 0 ? viewBox.width : svg.width.baseVal.value;
    const height = viewBox.height > 0 ? viewBox.height : svg.height.baseVal.value;
    if (!(width > 0) || !(height > 0)) throw new Error('it has no size');
    if (svg.getAttribute('viewBox') === null) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Read every computed style before changing anything — the rewrite below removes
    // the stylesheets and attributes those styles come from.
    const paints = new Map<Element, Record<string, string> | null>();
    for (const shape of Array.from(svg.querySelectorAll(SVG_SHAPES))) {
      const style = getComputedStyle(shape);
      if (style.fill.startsWith('url') || style.stroke.startsWith('url')) throw new Error('it paints with a gradient or pattern');
      if (style.transform !== 'none' && shape.getAttribute('transform') === null) throw new Error('it uses CSS transforms');
      if (style.strokeDasharray !== 'none') throw new Error('it uses dashed strokes');

      // A shape's own opacity becomes its fill and stroke opacity. A group's opacity
      // blends the group as a whole, which separate paths cannot reproduce where its
      // shapes overlap.
      const opacity = parseFloat(style.opacity);
      let hidden = style.visibility !== 'visible' || style.display === 'none';
      for (let node = shape.parentElement; node !== null; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        if (nodeStyle.display === 'none') hidden = true;
        if (parseFloat(nodeStyle.opacity) !== 1) throw new Error('it uses group opacity');
        if (nodeStyle.transform !== 'none' && node.getAttribute('transform') === null) throw new Error('it uses CSS transforms');
      }

      paints.set(
        shape,
        hidden
          ? null
          : {
              'fill': style.fill,
              'stroke': style.stroke,
              'stroke-width': `${parseFloat(style.strokeWidth)}`,
              'fill-rule': style.fillRule,
              'stroke-linecap': style.strokeLinecap,
              'stroke-linejoin': style.strokeLinejoin,
              'fill-opacity': `${parseFloat(style.fillOpacity) * opacity}`,
              'stroke-opacity': `${parseFloat(style.strokeOpacity) * opacity}`,
            },
      );
    }

    for (const element of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
      for (const attribute of SVG_PAINT_ATTRIBUTES) element.removeAttribute(attribute);
    }
    for (const element of Array.from(svg.querySelectorAll('style, defs, title, desc, metadata'))) element.remove();

    for (const [shape, paint] of paints) {
      if (paint === null) shape.remove();
      else for (const [name, value] of Object.entries(paint)) shape.setAttribute(name, value);
    }

    return { kind: 'svg', svg: new XMLSerializer().serializeToString(svg), aspectRatio: width / height };
  } catch (e) {
    console.warn(`web-to-print: "${source.fileName ?? 'logo'}" cannot be converted to vector, the proof shows a raster instead.`, e);
    return null;
  } finally {
    host.remove();
  }
}

/** Draws the vector logos into a finished proof and returns the new PDF. */
export async function drawVectorLogos(proof: ArrayBuffer, placements: VectorLogoPlacement[]): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(proof);

  for (const placement of placements) {
    const target = doc.getPage(placement.pageIndex);
    const x = placement.xMm * MM_TO_PT;
    const top = target.getHeight() - placement.yMm * MM_TO_PT;
    const width = placement.widthMm * MM_TO_PT;
    const height = placement.heightMm * MM_TO_PT;

    if (placement.logo.kind === 'svg') {
      // An SVG is positioned by its top-left corner.
      target.drawSvg(placement.logo.svg, { x, y: top, width, height });
      continue;
    }

    const embedded = await doc.embedPage(placement.logo.page, placement.logo.box);
    target.drawPage(embedded, { x, y: top - height, width, height });
  }

  return doc.save();
}
