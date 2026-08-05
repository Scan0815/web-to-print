// Mock jspdf since it requires browser globals (atob/btoa) unavailable in JSDOM
vi.mock('jspdf', () => ({ jsPDF: class {} }));

import { dataUrlToImageFormat, isSvgDataUrl, buildPdfConfig, PdfExportConfig, rasterizeDataUrl, exportProductPdf, exportArticlePdf, collectLogoSources, selectPrintableDecorations } from './pdf-export';
import { LogoData, Article, ArticleEditorState, DecorationState, EditorState, PlacedLogo } from '../types';

function editorState(logos: PlacedLogo[] = [], texts: EditorState['texts'] = []): EditorState {
  return { fabricJson: '', logos, texts, productImage: null, width: 800, height: 600 };
}

function decoration(viewId: string, label: string, status: 'empty' | 'designed', logos: PlacedLogo[] = []): DecorationState {
  return { viewId, label, status, state: editorState(logos), issues: [] };
}

describe('pdf-export', () => {
  describe('dataUrlToImageFormat', () => {
    it('detects PNG from data URL', () => {
      expect(dataUrlToImageFormat('data:image/png;base64,abc')).toBe('PNG');
    });

    it('detects JPEG from data URL', () => {
      expect(dataUrlToImageFormat('data:image/jpeg;base64,abc')).toBe('JPEG');
    });

    it('detects JPEG from jpg variant', () => {
      expect(dataUrlToImageFormat('data:image/jpg;base64,abc')).toBe('JPEG');
    });

    it('defaults to PNG for unknown formats', () => {
      expect(dataUrlToImageFormat('data:image/webp;base64,abc')).toBe('PNG');
    });

    it('defaults to PNG for SVG data URLs', () => {
      expect(dataUrlToImageFormat('data:image/svg+xml;base64,abc')).toBe('PNG');
    });
  });

  describe('isSvgDataUrl', () => {
    it('returns true for SVG base64 data URLs', () => {
      expect(isSvgDataUrl('data:image/svg+xml;base64,abc')).toBe(true);
    });

    it('returns true for SVG URI-encoded data URLs', () => {
      expect(isSvgDataUrl('data:image/svg+xml,%3Csvg%3E')).toBe(true);
    });

    it('returns false for PNG data URLs', () => {
      expect(isSvgDataUrl('data:image/png;base64,abc')).toBe(false);
    });

    it('returns false for JPEG data URLs', () => {
      expect(isSvgDataUrl('data:image/jpeg;base64,abc')).toBe(false);
    });
  });

  describe('buildPdfConfig', () => {
    it('returns all defaults when no partial is given', () => {
      const cfg = buildPdfConfig();
      expect(cfg).toEqual({
        pageFormat: 'a4',
        orientation: 'portrait',
        marginMm: 15,
        showPrintAreaGuides: true,
        title: 'Logo Print Specification',
        proofNotice: 'Proof / placement reference — not print data (RGB, no bleed or crop marks).',
      } satisfies PdfExportConfig);
    });

    it('merges partial overrides with defaults', () => {
      const cfg = buildPdfConfig({ pageFormat: 'letter', marginMm: 20 });
      expect(cfg.pageFormat).toBe('letter');
      expect(cfg.marginMm).toBe(20);
      expect(cfg.orientation).toBe('portrait');
      expect(cfg.showPrintAreaGuides).toBe(true);
      expect(cfg.title).toBe('Logo Print Specification');
    });

    it('allows overriding all fields', () => {
      const custom: PdfExportConfig = {
        pageFormat: 'letter',
        orientation: 'landscape',
        marginMm: 10,
        showPrintAreaGuides: false,
        title: 'Custom Title',
        proofNotice: 'Internal proof',
      };
      const cfg = buildPdfConfig(custom);
      expect(cfg).toEqual(custom);
    });

    it('handles empty partial object', () => {
      const cfg = buildPdfConfig({});
      expect(cfg.pageFormat).toBe('a4');
      expect(cfg.title).toBe('Logo Print Specification');
    });
  });

  describe('rasterizeDataUrl', () => {
    it('returns PNG data URLs unchanged', async () => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const result = await rasterizeDataUrl(png);
      expect(result).toBe(png);
    });

    it('returns JPEG data URLs unchanged', async () => {
      const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAr=';
      const result = await rasterizeDataUrl(jpeg);
      expect(result).toBe(jpeg);
    });

    it('rejects when SVG cannot be rasterized', async () => {
      // SVG without intrinsic dimensions skips the upscale branch (which would
      // need XMLSerializer in production) and goes straight to new Image(),
      // which throws in the spec env — exercising the SVG → image branch of
      // rasterizeDataUrl in a way that's reliable under JSDOM/mock-doc.
      const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
      await expect(rasterizeDataUrl(svg)).rejects.toThrow();
    });
  });

  describe('selectPrintableDecorations', () => {
    const state: ArticleEditorState = {
      version: 2,
      articleId: 'A-1',
      decorations: [decoration('front', 'Front', 'designed'), decoration('back', 'Back', 'empty'), decoration('wrap', 'Wrap', 'designed')],
    };

    it('keeps only designed decorations', () => {
      expect(selectPrintableDecorations(state).map(d => d.viewId)).toEqual(['front', 'wrap']);
    });

    it('narrows to the requested decoration ids', () => {
      expect(selectPrintableDecorations(state, ['wrap']).map(d => d.viewId)).toEqual(['wrap']);
    });

    it('ignores requested ids that are not designed', () => {
      expect(selectPrintableDecorations(state, ['back'])).toEqual([]);
    });
  });

  describe('collectLogoSources', () => {
    const logoA: PlacedLogo = { id: 'l1', dataUrl: 'data:image/png;base64,AAA' };
    const logoB: PlacedLogo = { id: 'l2', dataUrl: 'data:image/png;base64,BBB' };

    it('emits one page per distinct logo', () => {
      const sources = collectLogoSources([decoration('front', 'Front', 'designed', [logoA]), decoration('back', 'Back', 'designed', [logoB])]);
      expect(sources.length).toBe(2);
    });

    it('deduplicates the same logo used on several decorations', () => {
      const sources = collectLogoSources([decoration('front', 'Front', 'designed', [logoA]), decoration('back', 'Back', 'designed', [logoA])]);
      expect(sources.length).toBe(1);
      expect(sources[0].usedBy).toEqual(['Front', 'Back']);
    });

    it('counts a decoration once even when two share a display label', () => {
      // Two print methods on the same spot: the shop shows both as "Front", but they are
      // different purchasable decorations. Deduplicating on the label would hide one.
      const sources = collectLogoSources([decoration('184932', 'Front', 'designed', [logoA]), decoration('184933', 'Front', 'designed', [logoA])]);
      expect(sources.length).toBe(1);
      expect(sources[0].usedBy).toEqual(['Front', 'Front (184933)']);
    });

    it('lists a decoration once when it uses the same logo twice', () => {
      const twice = decoration('front', 'Front', 'designed', [logoA, { ...logoA, id: 'l1b' }]);
      expect(collectLogoSources([twice])[0].usedBy).toEqual(['Front']);
    });

    it('prefers the uploaded original over the canvas representation', () => {
      const withSource: PlacedLogo = {
        id: 'l3',
        dataUrl: 'data:image/png;base64,RASTERIZED',
        source: { dataUrl: 'data:image/svg+xml;base64,ORIGINAL', mimeType: 'image/svg+xml', fileName: 'logo.svg', fileSize: 2048 },
      };
      const sources = collectLogoSources([decoration('front', 'Front', 'designed', [withSource])]);
      expect(sources[0].dataUrl).toBe('data:image/svg+xml;base64,ORIGINAL');
      expect(sources[0].fileName).toBe('logo.svg');
      expect(sources[0].fileSize).toBe(2048);
    });

    it('returns nothing when no logos are placed', () => {
      expect(collectLogoSources([decoration('front', 'Front', 'designed')])).toEqual([]);
    });
  });

  const PNG = 'data:image/png;base64,AAA';

  /** Minimal jsPDF stand-in that records the page structure. */
  function installFakeJsPDF(): { pages: string[][]; saved: string[]; lines: number[][]; images: { dataUrl: string; format: string }[] } {
    const record = { pages: [[]] as string[][], saved: [] as string[], lines: [] as number[][], images: [] as { dataUrl: string; format: string }[] };
    let current = 0;

    class FakeDoc {
      internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
      addPage() {
        record.pages.push([]);
        current = record.pages.length - 1;
      }
      getNumberOfPages() {
        return record.pages.length;
      }
      text(value: string) {
        record.pages[current].push(value);
      }
      // Faithful to jsPDF: it decodes the bytes and rejects a data URL whose content does
      // not match the declared format (e.g. a raw PDF passed as 'PNG').
      addImage(dataUrl: string, format: string) {
        record.images.push({ dataUrl, format });
        const ok =
          (format === 'PNG' && dataUrl.startsWith('data:image/png')) ||
          (format === 'JPEG' && (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')));
        if (!ok) throw new Error(`Unsupported image type for ${format}: ${dataUrl.slice(0, 24)}`);
      }
      setFontSize() {}
      setFont() {}
      setDrawColor() {}
      setTextColor() {}
      setLineWidth() {}
      setLineDashPattern() {}
      line(x1: number, y1: number, x2: number, y2: number) {
        record.lines.push([x1, y1, x2, y2]);
      }
      save(name: string) {
        record.saved.push(name);
      }
    }

    (window as unknown as Record<string, unknown>)['jspdf'] = { jsPDF: FakeDoc };
    return record;
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['jspdf'];
  });

  describe('exportArticlePdf', () => {
    const article: Article = {
      id: 'A-1',
      name: 'Test Article',
      description: '',
      views: [
        { id: 'front', image: '', label: 'Front', printArea: null },
        { id: 'back', image: '', label: 'Back', printArea: null },
      ],
    };

    const mockups = {
      front: { dataUrl: PNG, width: 800, height: 600 },
      back: { dataUrl: PNG, width: 800, height: 600 },
    };

    function state(decorations: DecorationState[]): ArticleEditorState {
      return { version: 2, articleId: 'A-1', decorations };
    }

    it('emits one logo page and one page per designed decoration', async () => {
      const record = installFakeJsPDF();
      const logo: PlacedLogo = { id: 'l1', dataUrl: PNG };

      await exportArticlePdf(
        state([decoration('front', 'Front', 'designed', [logo]), decoration('back', 'Back', 'designed', [logo])]),
        article,
        mockups,
      );

      expect(record.pages.length).toBe(3);
      expect(record.saved).toEqual(['A-1.pdf']);
    });

    it('does not leave a blank first page when no logo was placed', async () => {
      const record = installFakeJsPDF();

      await exportArticlePdf(state([decoration('front', 'Front', 'designed')]), article, mockups);

      expect(record.pages.length).toBe(1);
      expect(record.pages[0].some(text => text.includes('Front'))).toBe(true);
    });

    it('normalizes a pixel print area before drawing the guide', async () => {
      // The catalog delivers pixel coordinates against a 2000px source image. Drawing
      // those as if they were 0-1 fractions puts the guide kilometres off the page.
      const pixelArticle: Article = {
        ...article,
        views: [
          {
            id: 'front',
            image: '',
            label: 'Front',
            printArea: { topLeft: { x: 500, y: 500 }, topRight: { x: 1500, y: 500 }, bottomRight: { x: 1500, y: 1500 }, bottomLeft: { x: 500, y: 1500 } },
            coordinateImageSize: { width: 2000, height: 2000, longestSide: 'width' },
          },
        ],
      };

      const record = installFakeJsPDF();
      await exportArticlePdf(state([decoration('front', 'Front', 'designed')]), pixelArticle, mockups);

      // The page draws the table separator first, then the four guide edges.
      expect(record.lines.length).toBe(5);
      for (const [x1, y1, x2, y2] of record.lines.slice(-4)) {
        expect(x1).toBeGreaterThanOrEqual(0);
        expect(x2).toBeLessThanOrEqual(210);
        expect(y1).toBeGreaterThanOrEqual(0);
        expect(y2).toBeLessThanOrEqual(297);
      }
    });

    it('embeds the canvas raster for a PDF/AI source, not the raw original', async () => {
      // A PDF/AI upload keeps the raw file as source.dataUrl and a rasterized page-1 PNG
      // as logo.dataUrl. The logo source page must embed the PNG — passing the raw PDF to
      // jsPDF.addImage(...,'PNG') throws and fails the whole export.
      const record = installFakeJsPDF();
      const pngRaster = 'data:image/png;base64,UkFTVEVS';
      const rawPdf = 'data:application/pdf;base64,JVBERi0xLjc';
      const logo: PlacedLogo = {
        id: 'l1',
        dataUrl: pngRaster,
        source: { dataUrl: rawPdf, mimeType: 'application/pdf', fileName: 'logo.pdf', fileSize: 2048 },
      };

      await exportArticlePdf(state([decoration('front', 'Front', 'designed', [logo])]), article, mockups);

      const embedded = record.images.map(i => i.dataUrl);
      expect(embedded).toContain(pngRaster);
      expect(embedded).not.toContain(rawPdf);
      expect(record.saved).toEqual(['A-1.pdf']);
      // The source page tells the shop the original travels with the order.
      expect(record.pages.flat().some(t => t.includes('rasterized preview'))).toBe(true);
    });

    it('throws when a designed decoration has no mockup', async () => {
      installFakeJsPDF();

      await expect(
        exportArticlePdf(state([decoration('front', 'Front', 'designed'), decoration('back', 'Back', 'designed')]), article, { front: mockups.front }),
      ).rejects.toThrow(/back/);
    });

    it('throws when nothing was designed', async () => {
      installFakeJsPDF();

      await expect(exportArticlePdf(state([decoration('front', 'Front', 'empty')]), article, mockups)).rejects.toThrow(/No designed decorations/);
    });
  });

  describe('exportProductPdf', () => {
    it('delegates to exportArticlePdf: one logo page plus one decoration page', async () => {
      const record = installFakeJsPDF();
      const logo: LogoData = {
        dataUrl: 'data:image/png;base64,AAA',
        metadata: { format: 'png', width: 100, height: 100, dpiX: 300, dpiY: 300, fileSize: 1024, hasTransparency: true, fileName: 'logo.png', mimeType: 'image/png' },
      };
      const article: Article = {
        id: 'A-1',
        name: 'Test Article',
        description: '',
        views: [{ id: 'front', image: '', label: 'Front', printArea: null }],
      };

      await exportProductPdf(logo, article, 0, logo.dataUrl, 800, 600);

      expect(record.pages.length).toBe(2);
      expect(record.saved).toEqual(['A-1.pdf']);
      // The upload metadata the single-view page used to show survives the delegation
      expect(record.pages[0].some(text => text === '300 x 300')).toBe(true);
    });

    it('rejects a view index the article does not have', async () => {
      installFakeJsPDF();
      const logo: LogoData = {
        dataUrl: 'data:image/png;base64,AAA',
        metadata: { format: 'png', width: 100, height: 100, dpiX: null, dpiY: null, fileSize: 1, hasTransparency: false, fileName: 'l.png', mimeType: 'image/png' },
      };
      const article: Article = { id: 'A-1', name: 'T', description: '', views: [] };

      await expect(exportProductPdf(logo, article, 0, logo.dataUrl, 800, 600)).rejects.toThrow(/no view at index/);
    });

    it('throws a helpful error when jsPDF is not loaded globally', async () => {
      const logo: LogoData = {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        metadata: {
          format: 'png',
          width: 100,
          height: 100,
          dpiX: 300,
          dpiY: 300,
          fileSize: 1024,
          hasTransparency: true,
          fileName: 'logo.png',
          mimeType: 'image/png',
        },
      };
      const article: Article = {
        id: 'A-1',
        name: 'Test Article',
        description: '',
        views: [{ id: 'front', image: '', label: 'Front', printArea: null }],
      };

      // Window.jspdf is not set — getJsPDF() should throw
      await expect(
        exportProductPdf(logo, article, 0, logo.dataUrl, 800, 600),
      ).rejects.toThrow(/jsPDF is required/);
    });
  });
});
