// Mock jspdf since it requires browser globals (atob/btoa) unavailable in JSDOM
jest.mock('jspdf', () => ({ jsPDF: class {} }));

import { dataUrlToImageFormat, isSvgDataUrl, buildPdfConfig, PdfExportConfig } from './pdf-export';

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
});
