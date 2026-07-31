import { render, h, describe, it, expect, afterEach } from '@stencil/vitest';

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
  removeObject: (id: string) => Promise<void>;
  exportState: () => Promise<{ width: number; height: number; texts: { text: string }[]; fabricJson: string }>;
  exportImage: (format: string) => Promise<string>;
  getObjects: () => Promise<{ id: string; type: string }[]>;
};

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

  it('exportState returns valid state', async () => {
    const { root } = await mount(<wtp-editor width={400} height={300}></wtp-editor>);
    const el = root as EditorElement;

    await el.addText('State Test');
    const state = await el.exportState();

    expect(state).toBeTruthy();
    expect(state.width).toBe(400);
    expect(state.height).toBe(300);
    expect(state.texts.length).toBe(1);
    expect(state.texts[0].text).toBe('State Test');
    expect(state.fabricJson).toBeTruthy();
  });

  it('exportImage returns a data URL', async () => {
    const { root } = await mount(<wtp-editor width={100} height={100}></wtp-editor>);
    const dataUrl = await (root as EditorElement).exportImage('png');
    expect(dataUrl).toContain('data:image/png');
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
