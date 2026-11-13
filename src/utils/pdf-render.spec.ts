import { ensurePdfWorker, isPdfRenderingAvailable, loadPdfJs, renderPdfFirstPage } from './pdf-render';

describe('pdf-render', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['pdfjsLib'];
  });

  it('reports PDF rendering as available without any host setup', () => {
    expect(isPdfRenderingAvailable()).toBe(true);
  });

  it('prefers a pdf.js build the host put on the window', async () => {
    const hostLib = { getDocument: () => ({ promise: Promise.resolve({}) }) };
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = hostLib;
    expect(await loadPdfJs()).toBe(hostLib);
  });

  it('explains AI files saved without PDF compatibility', async () => {
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = {
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }),
    };

    const file = new File([new Uint8Array([0x00])], 'legacy.ai', { type: 'application/illustrator' });
    await expect(renderPdfFirstPage(file)).rejects.toThrow(/PDF compatibility/);
  });

  it('passes through the reason for an unreadable PDF', async () => {
    (window as unknown as Record<string, unknown>)['pdfjsLib'] = {
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }),
    };

    const file = new File([new Uint8Array([0x00])], 'broken.pdf', { type: 'application/pdf' });
    await expect(renderPdfFirstPage(file)).rejects.toThrow(/Invalid PDF structure/);
  });

  describe('ensurePdfWorker', () => {
    const getDocument = () => ({ promise: Promise.reject(new Error('unused')) });

    it('defaults the worker to the build matching the loaded pdf.js version', () => {
      const lib = { getDocument, version: '5.7.284', GlobalWorkerOptions: { workerSrc: '' } };
      ensurePdfWorker(lib);
      expect(lib.GlobalWorkerOptions.workerSrc).toBe('https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs');
    });

    it('keeps a worker the host configured', () => {
      const lib = { getDocument, version: '5.7.284', GlobalWorkerOptions: { workerSrc: '/assets/pdf.worker.min.mjs' } };
      ensurePdfWorker(lib);
      expect(lib.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min.mjs');
    });

    it('does nothing when the version is unknown', () => {
      const lib = { getDocument, GlobalWorkerOptions: { workerSrc: '' } };
      ensurePdfWorker(lib);
      expect(lib.GlobalWorkerOptions.workerSrc).toBe('');
    });

    it('tolerates a pdf.js build without worker options', () => {
      expect(() => ensurePdfWorker({ getDocument, version: '5.7.284' })).not.toThrow();
    });
  });
});
