import { render, h, describe, it, expect, afterEach } from '@stencil/vitest';
import type { ArticleEditorState, ArticleView } from '../../types/editor';
import type { LogoData, LogoMetadata } from '../../types/logo';

/** 4x4 transparent PNG. */
const LOGO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';

/** 40x40 blue PNG and an 80x20 red one — different aspect ratios, so a background swap is observable. */
const SQUARE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAALElEQVR4nO3NsQkAAAjAsP7/tD4huASyp5onYrFYLBaLxWKxWCwWi8Vi8ZkFNsE6Gz5864YAAAAASUVORK5CYII=';
const WIDE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAUCAIAAACVui2AAAAANElEQVR4nO3PQQ0AMBDDsPInvbG4PmopAOK8ZKr+ATAwMDAwMPBM/QNgYGBgYGDgmfoHx31lvzobljYGDgAAAABJRU5ErkJggg==';

const LOGO_METADATA: LogoMetadata = {
  format: 'png',
  width: 4,
  height: 4,
  dpiX: 300,
  dpiY: 300,
  fileSize: 128,
  fileName: 'logo.png',
  mimeType: 'image/png',
  hasTransparency: true,
};

// Fabric.js rewraps the <canvas> element, so a leftover editor breaks Stencil's
// vdom patching for the next test. Unmount after every test.
let mounted: { unmount: () => void } | null = null;

async function mount(template: unknown) {
  const result = await render(template as Parameters<typeof render>[0]);
  mounted = result;
  return result;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

type EditorElement = HTMLElement & {
  addText: (text: string) => Promise<string>;
  addLogo: (logo: LogoData) => Promise<string>;
  applyLogoToAllViews: (logoId: string) => Promise<string[]>;
  removeObject: (id: string) => Promise<void>;
  exportState: () => Promise<ArticleEditorState>;
  loadState: (state: ArticleEditorState) => Promise<void>;
  setActiveView: (viewId: string) => Promise<void>;
  activeViewId: string;
  exportImage: (format: string) => Promise<string>;
  exportViewImage: (viewId: string, format?: string, quality?: number) => Promise<string>;
  exportImageHighRes: (format?: string, quality?: number, multiplier?: number) => Promise<{ dataUrl: string; width: number; height: number }>;
  getObjects: () => Promise<{ id: string; type: string }[]>;
  views: ArticleView[];
  articleId: string;
};

const VIEWS: ArticleView[] = [
  { id: 'front', image: '', label: 'Front', printArea: null, impMethod: 'Tampondruck', maxColours: 4 },
  { id: 'back', image: '', label: 'Back', printArea: null, impMethod: 'Siebdruck', maxColours: 1 },
  { id: 'wrap', image: '', label: 'Wrap', printArea: null, maxColours: 'full color' },
];

describe('wtp-editor browser', () => {
  it('renders', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    expect(root).not.toBeNull();
  });

  it('is ready and functional after load', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    const id = await (root as EditorElement).addText('Ready test');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('renders toolbar with buttons', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    expect(root.querySelector('.toolbar')).not.toBeNull();
    expect(root.querySelectorAll('.toolbar-btn').length).toBeGreaterThanOrEqual(2);
  });

  it('renders canvas', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    expect(root.querySelector('canvas')).not.toBeNull();
  });

  it('addText method adds text to canvas', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    const id = await (root as EditorElement).addText('Hello World');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('getObjects returns added objects', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Test');
    const objects = await el.getObjects();

    expect(objects.length).toBe(1);
    expect(objects[0].type).toBe('i-text');
  });

  it('removeObject removes an object', async () => {
    const { root } = await mount(<wtp-editor></wtp-editor>);
    const el = root as EditorElement;

    const id = await el.addText('To Remove');
    await el.removeObject(id);

    expect((await el.getObjects()).length).toBe(0);
  });

  it('exportState returns a v2 envelope for the implicit view', async () => {
    const { root } = await mount(<wtp-editor width={400} height={300} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('State Test');
    const envelope = await el.exportState();

    expect(envelope.version).toBe(2);
    expect(envelope.articleId).toBe('A-1');
    expect(envelope.decorations.length).toBe(1);

    const decoration = envelope.decorations[0];
    expect(decoration.status).toBe('designed');
    expect(decoration.state.width).toBe(400);
    expect(decoration.state.height).toBe(300);
    expect(decoration.state.texts.length).toBe(1);
    expect(decoration.state.texts[0].text).toBe('State Test');
    expect(decoration.state.fabricJson).toBeTruthy();
  });

  it('exportImage returns a data URL', async () => {
    const { root } = await mount(<wtp-editor width={100} height={100}></wtp-editor>);
    const dataUrl = await (root as EditorElement).exportImage('png');
    expect(dataUrl).toContain('data:image/png');
  });

  // --- Multi-decoration behaviour ---

  it('exportState reports every view with its status', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Front only');
    const envelope = await el.exportState();

    expect(envelope.decorations.map(d => d.viewId)).toEqual(['front', 'back', 'wrap']);
    expect(envelope.decorations.map(d => d.status)).toEqual(['designed', 'empty', 'empty']);
  });

  it('exportState flushes the active view without a prior switch', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.setActiveView('back');
    await el.addText('Back only');

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('designed');
    expect(envelope.decorations.find(d => d.viewId === 'front')?.status).toBe('empty');
  });

  it('keeps each view own objects when switching back and forth', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Front text');
    await el.setActiveView('back');
    expect((await el.getObjects()).length).toBe(0);

    await el.addText('Back text');
    await el.setActiveView('front');

    const objects = await el.getObjects();
    expect(objects.length).toBe(1);

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'front')?.state.texts[0].text).toBe('Front text');
    expect(envelope.decorations.find(d => d.viewId === 'back')?.state.texts[0].text).toBe('Back text');
  });

  it('carries decoration metadata into the envelope', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const envelope = await (root as EditorElement).exportState();

    const wrap = envelope.decorations.find(d => d.viewId === 'wrap');
    expect(wrap?.label).toBe('Wrap');
    expect(wrap?.maxColours).toBe('full color');
    expect(envelope.decorations.find(d => d.viewId === 'front')?.impMethod).toBe('Tampondruck');
  });

  it('starts on the isDefault view instead of the first one', async () => {
    const views: ArticleView[] = [
      { id: 'front', image: '', label: 'Front', printArea: null },
      { id: 'back', image: '', label: 'Back', printArea: null, isDefault: true },
    ];
    const { root } = await mount(<wtp-editor views={views}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Goes to back');
    const envelope = await el.exportState();

    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('designed');
    expect(envelope.decorations.find(d => d.viewId === 'front')?.status).toBe('empty');
  });

  it('emits wtpEditorViewChanged on switch', async () => {
    const { root, spyOnEvent } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const spy = spyOnEvent('wtpEditorViewChanged');

    await (root as EditorElement).setActiveView('wrap');

    expect(spy).toHaveReceivedEventDetail({ viewId: 'wrap', index: 2 });
  });

  it('rejects an unknown view id', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    await expect((root as EditorElement).setActiveView('nope')).rejects.toThrow(/unknown view id/);
  });

  it('restores a v2 envelope into the matching views', async () => {
    const first = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = first.root as EditorElement;

    await el.setActiveView('back');
    await el.addText('Persisted');
    const saved = await el.exportState();
    first.unmount();

    const second = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const restored = second.root as EditorElement;
    await restored.loadState(saved);

    const envelope = await restored.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'back')?.state.texts[0].text).toBe('Persisted');
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('designed');
  });

  it('loads a legacy v1 state into the default view', async () => {
    // Produce a realistic v1 state: the flat EditorState the editor wrote before 0.2.0.
    const source = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    await (source.root as EditorElement).addText('Legacy');
    const legacy = (await (source.root as EditorElement).exportState()).decorations[0].state;
    source.unmount();

    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.loadState(legacy as unknown as ArticleEditorState);

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'front')?.state.texts[0].text).toBe('Legacy');
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('empty');
  });

  it('adopts views handed over after mount', async () => {
    // How a host actually uses it: the element exists, the article arrives later.
    const { root, setProps, waitForChanges } = await mount(<wtp-editor></wtp-editor>);
    const el = root as EditorElement;

    await setProps({ views: VIEWS });
    await waitForChanges();

    const logoId = await el.addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });
    await el.applyLogoToAllViews(logoId);

    const envelope = await el.exportState();
    expect(envelope.decorations.map(d => d.viewId)).toEqual(['front', 'back', 'wrap']);
    expect(envelope.decorations.every(d => d.status === 'designed')).toBe(true);
  });

  it('keeps the change event cheap: no canvas serialization per edit', async () => {
    const { root, spyOnEvent } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;
    const spy = spyOnEvent('wtpEditorStateChanged');

    await el.addText('Live');

    const emitted = spy.lastEvent?.detail as ArticleEditorState;
    const active = emitted.decorations.find(d => d.viewId === 'front');
    expect(active?.status).toBe('designed');
    expect(active?.state.texts[0].text).toBe('Live');
    // The heavy part is left out — exportState() is the persistable envelope
    expect(active?.state.fabricJson).toBe('');

    const exported = await el.exportState();
    expect(exported.decorations.find(d => d.viewId === 'front')?.state.fabricJson).not.toBe('');
  });

  it('does not re-render a thumbnail on every keystroke', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    let toDataUrlCalls = 0;
    const original = canvas.toDataURL.bind(canvas);
    canvas.toDataURL = (...args: Parameters<HTMLCanvasElement['toDataURL']>) => {
      toDataUrlCalls++;
      return original(...args);
    };

    // Every state change (addText fires one) must not cost a full canvas encode
    await el.addText('a');
    await el.addText('b');
    await el.addText('c');

    expect(toDataUrlCalls).toBe(0);
  });

  it('survives views, activeViewId and loadState arriving in the same tick', async () => {
    // The demo's "reopen an edited article" path: three canvas-touching calls at once.
    const first = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const source = first.root as EditorElement;
    await source.setActiveView('back');
    await source.addText('Saved text');
    const saved = await source.exportState();
    first.unmount();

    const { root } = await mount(<wtp-editor></wtp-editor>);
    const el = root as EditorElement;

    el.views = VIEWS;
    el.activeViewId = 'back';
    await el.loadState(saved);

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'back')?.state.texts[0]?.text).toBe('Saved text');
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('designed');
  });

  it('does not inherit state from a previous article that reuses view ids', async () => {
    const { root, setProps, waitForChanges } = await mount(<wtp-editor views={VIEWS} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Belongs to A-1');

    // Same view ids, different article — the old design must not leak in
    await setProps({ articleId: 'A-2' });
    await waitForChanges();

    const envelope = await el.exportState();
    expect(envelope.articleId).toBe('A-2');
    expect(envelope.decorations.every(d => d.status === 'empty')).toBe(true);
  });

  it('restores logos, previews and warnings from a loaded envelope', async () => {
    const first = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const source = first.root as EditorElement;

    await source.setActiveView('back'); // maxColours: 1 -> produces a warning
    const logoId = await source.addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });
    await source.setActiveView('front');
    const saved = await source.exportState();
    first.unmount();

    expect(saved.decorations.find(d => d.viewId === 'back')?.issues.length).toBeGreaterThan(0);

    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;
    await el.loadState(saved);

    const restored = await el.exportState();
    const back = restored.decorations.find(d => d.viewId === 'back');
    expect(back?.status).toBe('designed');
    expect(back?.issues.length).toBeGreaterThan(0);
    expect(back?.previewDataUrl).toContain('data:image/png');

    // The restored logo must still be usable, not just serialized
    const restoredLogoId = back?.state.logos[0]?.id ?? logoId;
    const applied = await el.applyLogoToAllViews(restoredLogoId);
    expect(applied).toContain('wrap');
  });

  // --- Apply to all decorations ---

  it('places a logo on every empty decoration', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    const logoId = await el.addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });
    const applied = await el.applyLogoToAllViews(logoId);

    expect(applied.sort()).toEqual(['back', 'wrap']);

    const envelope = await el.exportState();
    expect(envelope.decorations.map(d => d.status)).toEqual(['designed', 'designed', 'designed']);
  });

  it('leaves decorations that already carry a design untouched', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.setActiveView('back');
    await el.addText('Back text');
    await el.setActiveView('front');

    const logoId = await el.addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });
    const applied = await el.applyLogoToAllViews(logoId);

    expect(applied).toEqual(['wrap']);

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'back')?.state.logos.length).toBe(0);
  });

  it('rejects an unknown logo id', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    await expect((root as EditorElement).applyLogoToAllViews('nope')).rejects.toThrow(/unknown logo id/);
  });

  // --- Per-decoration validation ---

  it('reports a single-colour decoration carrying a logo', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.setActiveView('back'); // maxColours: 1
    await el.addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });

    const envelope = await el.exportState();
    const codes = envelope.decorations.find(d => d.viewId === 'back')?.issues.map(i => i.code);
    expect(codes).toContain('singleColourPrint');
  });

  it('keeps all findings non-blocking', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Front');
    const envelope = await el.exportState();

    for (const decoration of envelope.decorations) {
      expect(decoration.issues.every(i => i.severity === 'warning')).toBe(true);
    }
  });

  // --- Decoration strip ---

  it('renders one thumbnail per decoration', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    expect(root.querySelectorAll('.view-thumb').length).toBe(3);
    expect(root.querySelector('.view-thumb.active')?.textContent).toContain('Front');
  });

  it('hides the strip for a single decoration', async () => {
    const { root } = await mount(<wtp-editor views={[VIEWS[0]]}></wtp-editor>);
    expect(root.querySelector('.view-strip')).toBeNull();
  });

  it('gives each thumbnail a tooltip with the print method and area', async () => {
    const views: ArticleView[] = [
      { id: 'front', image: '', label: 'Front', printArea: null, impMethod: 'Siebdruck', impWidthMm: 100, impHeightMm: 80 },
      { id: 'back', image: '', label: 'Back', printArea: null, impMethod: 'Stick', impDiameterMm: 40 },
      { id: 'plain', image: '', label: 'Plain', printArea: null },
    ];
    const { root } = await mount(<wtp-editor views={views}></wtp-editor>);
    const thumbs = Array.from(root.querySelectorAll('.view-thumb'));

    const front = thumbs[0].querySelector('.view-thumb-tooltip');
    expect(front?.textContent).toContain('Siebdruck');
    expect(front?.textContent).toContain('100 × 80 mm');
    // Round areas read as a diameter.
    expect(thumbs[1].querySelector('.view-thumb-tooltip')?.textContent).toContain('⌀ 40 mm');
    expect(thumbs[0].getAttribute('aria-label')).toBe('Front — Siebdruck · 100 × 80 mm');
    // No method or size → no tooltip box, and the aria-label falls back to the label.
    expect(thumbs[2].querySelector('.view-thumb-tooltip')).toBeNull();
    expect(thumbs[2].getAttribute('aria-label')).toBe('Plain');
  });

  it('hides the strip when showViewStrip is off', async () => {
    const { root, setProps, waitForChanges } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);

    await setProps({ showViewStrip: false });
    await waitForChanges();

    expect(root.querySelector('.view-strip')).toBeNull();
  });

  it('switches the decoration when a thumbnail is clicked', async () => {
    const { root, waitForChanges } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);

    const thumbs = root.querySelectorAll('.view-thumb');
    (thumbs[1] as HTMLButtonElement).click();
    await waitForChanges();
    await new Promise(r => setTimeout(r, 50));

    expect(root.querySelector('.view-thumb.active')?.textContent).toContain('Back');
  });

  it('marks designed decorations in the strip and stores a preview', async () => {
    const { root, waitForChanges } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Front text');
    await el.setActiveView('back');
    await waitForChanges();

    const frontThumb = root.querySelectorAll('.view-thumb')[0];
    expect(frontThumb.classList.contains('designed')).toBe(true);
    expect(root.querySelectorAll('.view-thumb')[2].classList.contains('designed')).toBe(false);

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'front')?.previewDataUrl).toContain('data:image/png');
  });

  it('places initialLogo in the decoration it opens on and nowhere else', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS} initialLogo={{ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA }}></wtp-editor>);
    const el = root as EditorElement;

    // The placement runs off the ready event, so give the image decode a turn.
    await new Promise(r => setTimeout(r, 200));

    const envelope = await el.exportState();
    const byId = Object.fromEntries(envelope.decorations.map(d => [d.viewId, d]));
    expect(byId['front'].status).toBe('designed');
    expect(byId['front'].state.logos.length).toBe(1);
    expect(byId['back'].status).toBe('empty');
    expect(byId['wrap'].status).toBe('empty');
  });

  it('honours isDefault when placing initialLogo', async () => {
    const views: ArticleView[] = [
      { id: 'front', image: '', label: 'Front', printArea: null },
      { id: 'back', image: '', label: 'Back', printArea: null, isDefault: true },
    ];
    const { root } = await mount(<wtp-editor views={views} initialLogo={{ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA }}></wtp-editor>);
    await new Promise(r => setTimeout(r, 200));

    const envelope = await (root as EditorElement).exportState();
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('designed');
    expect(envelope.decorations.find(d => d.viewId === 'front')?.status).toBe('empty');
  });

  it('keeps initialLogo when views are assigned after mount', async () => {
    // How hosts actually wire this up (see src/index.html): the element is created first
    // and the article is assigned as a property once it has been fetched.
    const { root, waitForChanges } = await mount(<wtp-editor initialLogo={{ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA }}></wtp-editor>);
    const el = root as EditorElement;

    el.views = VIEWS;
    el.articleId = 'A-1';
    await waitForChanges();
    await new Promise(r => setTimeout(r, 300));

    const envelope = await el.exportState();
    expect(envelope.decorations.find(d => d.viewId === 'front')?.status).toBe('designed');
    expect(envelope.decorations.find(d => d.viewId === 'back')?.status).toBe('empty');
  });

  it('places initialLogo exactly once when articleId is assigned before views', async () => {
    // The order src/index.html uses: activeViewId, then articleId, then views. Both
    // assignments change the article key, so the placement runs twice — the canvas must
    // still end up with one logo, on one decoration.
    const { root, waitForChanges } = await mount(<wtp-editor initialLogo={{ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA }}></wtp-editor>);
    const el = root as EditorElement;

    el.activeViewId = 'back';
    el.articleId = 'A-1';
    el.views = VIEWS;
    await waitForChanges();
    await new Promise(r => setTimeout(r, 400));

    const envelope = await el.exportState();
    const designed = envelope.decorations.filter(d => d.status === 'designed');
    expect(designed.map(d => d.viewId)).toEqual(['back']);
    expect(designed[0].state.logos.length).toBe(1);
  });

  it('exportViewImage renders an inactive decoration and restores the active one', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('Front text');
    await el.setActiveView('back');
    await el.addText('Back text');

    const frontImage = await el.exportViewImage('front');
    expect(frontImage).toContain('data:image/png');

    // The customer was working on "back" — that must still be what is on screen.
    expect(el.activeViewId).toBe('back');
    const objects = await el.getObjects();
    expect(objects.length).toBe(1);
  });

  it('does not warn about a logo the editor itself fitted into a tilted print area', async () => {
    // Every other view in this file has printArea: null, so the geometry checks never
    // ran against a real canvas. A 45° area is the case where a world-space bounding box
    // reports 141% of the real size and warns on a perfect fit.
    const tilted: ArticleView[] = [
      {
        id: 'front',
        image: '',
        label: 'Front',
        printArea: { topLeft: { x: 0.5, y: 0.25 }, topRight: { x: 0.75, y: 0.5 }, bottomRight: { x: 0.5, y: 0.75 }, bottomLeft: { x: 0.25, y: 0.5 } },
        impWidthMm: 100,
        impHeightMm: 100,
      },
    ];

    const { root } = await mount(<wtp-editor views={tilted}></wtp-editor>);
    await (root as EditorElement).addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });

    const envelope = await (root as EditorElement).exportState();
    const codes = envelope.decorations[0].issues.map(i => i.code);
    expect(codes).not.toContain('sizeOverflow');
    expect(codes).not.toContain('printAreaOverflow');
  });

  it('reports a perfectly fitted logo in an axis-aligned print area as clean', async () => {
    // Guards the tolerances: the logo is fitted to exactly 100% of the area, so anything
    // getBoundingRect adds for strokes or controls would tip both checks into a warning.
    const sized: ArticleView[] = [
      {
        id: 'front',
        image: '',
        label: 'Front',
        printArea: { topLeft: { x: 0.25, y: 0.25 }, topRight: { x: 0.75, y: 0.25 }, bottomRight: { x: 0.75, y: 0.75 }, bottomLeft: { x: 0.25, y: 0.75 } },
        impWidthMm: 100,
        impHeightMm: 100,
      },
    ];

    const { root } = await mount(<wtp-editor views={sized}></wtp-editor>);
    await (root as EditorElement).addLogo({ dataUrl: LOGO_DATA_URL, metadata: LOGO_METADATA });

    const envelope = await (root as EditorElement).exportState();
    expect(envelope.decorations[0].issues.map(i => i.code)).toEqual([]);
  });

  // The implicit view built from productImage/printArea is cached (it is rebuilt on every
  // render and on every mousemove of a drag). These pin that the cache cannot go stale.
  describe('deprecated single-decoration props', () => {
    it('picks up a changed productImage', async () => {
      const { root, setProps } = await mount(<wtp-editor></wtp-editor>);
      const el = root as EditorElement;
      await el.addText('Hello');

      await setProps({ productImage: LOGO_DATA_URL });
      await new Promise(r => setTimeout(r, 100));

      const envelope = await el.exportState();
      expect(envelope.decorations[0].state.productImage).toBe(LOGO_DATA_URL);
    });

    it('picks up a changed printArea', async () => {
      const { root, setProps } = await mount(<wtp-editor></wtp-editor>);
      const el = root as EditorElement;
      await el.addText('Hello');

      const before = await el.exportState();
      expect(before.decorations[0].issues.map(i => i.code)).toContain('missingPrintArea');

      await setProps({
        printArea: { topLeft: { x: 0.25, y: 0.25 }, topRight: { x: 0.75, y: 0.25 }, bottomRight: { x: 0.75, y: 0.75 }, bottomLeft: { x: 0.25, y: 0.75 } },
      });
      await new Promise(r => setTimeout(r, 100));

      const after = await el.exportState();
      expect(after.decorations[0].issues.map(i => i.code)).not.toContain('missingPrintArea');
    });
  });

  it('swaps the canvas background when a view image changes under the same article', async () => {
    // A colour variant swaps the product photo but keeps the decoration ids, so the
    // article key is unchanged and no view reset happens. The two images have different
    // aspect ratios, and `contain` sizes the canvas to the image — so the canvas
    // proportions say which one is actually on it.
    const { root, setProps } = await mount(<wtp-editor views={[{ id: 'front', image: SQUARE_PNG, label: 'Front', printArea: null }]} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;
    await new Promise(r => setTimeout(r, 250));
    await el.addText('Keep me');

    await setProps({ views: [{ id: 'front', image: WIDE_PNG, label: 'Front', printArea: null }] });
    await new Promise(r => setTimeout(r, 300));

    const canvas = await el.exportImageHighRes('png', 1, 1);
    expect(canvas.width / canvas.height).toBeCloseTo(4, 1);
    // The customer's work survives the swap — only the background is replaced.
    expect((await el.getObjects()).length).toBe(1);
  });

  it('stays usable when the product image cannot be loaded', async () => {
    const { root } = await mount(<wtp-editor views={[{ id: 'front', image: 'http://127.0.0.1:9/never.png', label: 'Front', printArea: null }]} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;
    await new Promise(r => setTimeout(r, 400));

    // A product image the file server will not serve must not take the toolbar with it.
    await el.addText('Still works');
    expect((await el.getObjects()).length).toBe(1);

    // But it must not be silent either — the envelope names an image that is not on the
    // canvas, so the host has to be able to find that out.
    const envelope = await el.exportState();
    expect(envelope.decorations[0].issues.map(i => i.code)).toContain('productImageUnavailable');
  });

  it('reports no image problem once a product image loads', async () => {
    const { root } = await mount(<wtp-editor views={[{ id: 'front', image: SQUARE_PNG, label: 'Front', printArea: null }]} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;
    await new Promise(r => setTimeout(r, 250));

    const envelope = await el.exportState();
    expect(envelope.decorations[0].issues.map(i => i.code)).not.toContain('productImageUnavailable');
  });

  // A pixel print area that can never be normalized — no `coordinateImageSize` to fall
  // back on and an image that will not load. `resolveViewPrintArea` settles on "there is
  // none", and that has to stay a reported finding: telling "not resolved yet" apart from
  // "none" must not end up silencing the second.
  it('still reports a print area that resolves to nothing', async () => {
    const unresolvable: ArticleView[] = [
      {
        id: 'front',
        image: 'http://127.0.0.1:9/never.png',
        label: 'Front',
        printArea: { topLeft: { x: 500, y: 500 }, topRight: { x: 1500, y: 500 }, bottomRight: { x: 1500, y: 1500 }, bottomLeft: { x: 500, y: 1500 } },
      },
    ];

    const { root } = await mount(<wtp-editor views={unresolvable} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;
    await el.addText('Hello');

    const envelope = await el.exportState();
    expect(envelope.decorations[0].issues.map(i => i.code)).toContain('missingPrintArea');
  });

  it('gives the strip small thumbnails instead of the full product image', async () => {
    // The catalog serves one size (~2400px). Before the preload, a never-visited
    // decoration's strip entry was <img src={view.image}> — the full product photo
    // downloaded to be shown at 72px, competing with the image the customer waits for.
    const views: ArticleView[] = [
      { id: 'front', image: SQUARE_PNG, label: 'Front', printArea: null },
      { id: 'back', image: WIDE_PNG, label: 'Back', printArea: null },
    ];
    const { root, waitForChanges } = await mount(<wtp-editor views={views} article-id="A-1"></wtp-editor>);
    await new Promise(r => setTimeout(r, 600));
    await waitForChanges();

    const thumbs = Array.from(root.querySelectorAll('.view-thumb img')) as HTMLImageElement[];
    expect(thumbs.length).toBe(2);
    // The never-visited decoration shows a re-encoded thumbnail, not the raw catalog image.
    expect(thumbs[1].src.startsWith('data:image/png')).toBe(true);
    expect(thumbs[1].src).not.toBe(WIDE_PNG);
  });

  it('does not replace a design preview with the bare product shot', async () => {
    const views: ArticleView[] = [
      { id: 'front', image: SQUARE_PNG, label: 'Front', printArea: null },
      { id: 'back', image: WIDE_PNG, label: 'Back', printArea: null },
    ];
    const { root, waitForChanges } = await mount(<wtp-editor views={views} article-id="A-1"></wtp-editor>);
    const el = root as EditorElement;
    await new Promise(r => setTimeout(r, 400));

    // Design the back view and leave it: the exit preview shows the design.
    await el.setActiveView('back');
    await el.addText('Design');
    await el.setActiveView('front');
    await waitForChanges();
    const withDesign = (root.querySelectorAll('.view-thumb img')[1] as HTMLImageElement).src;

    // Whatever late preload resolves must not overwrite it.
    await new Promise(r => setTimeout(r, 400));
    await waitForChanges();
    expect((root.querySelectorAll('.view-thumb img')[1] as HTMLImageElement).src).toBe(withDesign);
  });

  it('exportViewImage rejects an unknown decoration', async () => {
    const { root } = await mount(<wtp-editor views={VIEWS}></wtp-editor>);
    await expect((root as EditorElement).exportViewImage('nope')).rejects.toThrow(/unknown view id/);
  });

  it('Add Text button adds text via toolbar', async () => {
    const { root, spyOnEvent, waitForChanges } = await mount(<wtp-editor></wtp-editor>);
    const stateChangedSpy = spyOnEvent('wtpEditorStateChanged');

    const addTextBtn = root.querySelector('.toolbar-btn') as HTMLButtonElement;
    addTextBtn.click();
    await waitForChanges();
    await new Promise(r => setTimeout(r, 200));

    expect(stateChangedSpy).toHaveReceivedEvent();
  });
});
