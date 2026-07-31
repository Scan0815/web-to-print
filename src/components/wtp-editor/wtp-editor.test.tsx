import { render, h, describe, it, expect, afterEach } from '@stencil/vitest';
import type { ArticleEditorState, ArticleView } from '../../types/editor';
import type { LogoData, LogoMetadata } from '../../types/logo';

/** 4x4 transparent PNG. */
const LOGO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';

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
  getObjects: () => Promise<{ id: string; type: string }[]>;
  views: ArticleView[];
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
