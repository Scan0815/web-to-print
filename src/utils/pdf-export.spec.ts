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
  function installFakeJsPDF(): { pages: string[][]; saved: string[] } {
    const record = { pages: [[]] as string[][], saved: [] as string[] };
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
      addImage() {}
      setFontSize() {}
      setFont() {}
      setDrawColor() {}
      setTextColor() {}
      setLineWidth() {}
      setLineDashPattern() {}
      line() {}
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
