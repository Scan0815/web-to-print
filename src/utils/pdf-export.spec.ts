// Mock jspdf since it requires browser globals (atob/btoa) unavailable in JSDOM
jest.mock('jspdf', () => ({ jsPDF: class {} }));

import { dataUrlToImageFormat, isSvgDataUrl, buildPdfConfig, PdfExportConfig, rasterizeDataUrl, exportProductPdf } from './pdf-export';
import { LogoData, Article } from '../types';

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

  describe('exportProductPdf', () => {
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
        views: [{ image: '', label: 'Front', printArea: null }],
      };

      // Window.jspdf is not set — getJsPDF() should throw
      await expect(
        exportProductPdf(logo, article, 0, logo.dataUrl, 800, 600),
      ).rejects.toThrow(/jsPDF is required/);
    });
  });
});
