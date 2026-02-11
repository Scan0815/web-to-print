import { newE2EPage } from '@stencil/core/testing';

type EditorElement = HTMLElement & {
  addText: (text: string) => Promise<string>;
  removeObject: (id: string) => Promise<void>;
  exportState: () => Promise<{ width: number; height: number; texts: { text: string }[]; fabricJson: string }>;
  exportImage: (format: string) => Promise<string>;
  getObjects: () => Promise<{ id: string; type: string }[]>;
};

describe('wtp-editor e2e', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const el = await page.find('wtp-editor');
    expect(el).not.toBeNull();
  });

  it('is ready and functional after load', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');
    await page.waitForChanges();

    // Verify the canvas is initialized and methods work
    const canAdd = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      const id = await editor.addText('Ready test');
      return typeof id === 'string' && id.length > 0;
    });

    expect(canAdd).toBe(true);
  });

  it('renders toolbar with buttons', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const toolbar = await page.find('wtp-editor .toolbar');
    expect(toolbar).not.toBeNull();

    const buttons = await page.findAll('wtp-editor .toolbar-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('renders canvas', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const canvas = await page.find('wtp-editor canvas');
    expect(canvas).not.toBeNull();
  });

  it('addText method adds text to canvas', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const id = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      return editor.addText('Hello World');
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('getObjects returns added objects', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const objects = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      await editor.addText('Test');
      return editor.getObjects();
    });

    expect(objects.length).toBe(1);
    expect(objects[0].type).toBe('text');
  });

  it('removeObject removes an object', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const count = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      const id = await editor.addText('To Remove');
      await editor.removeObject(id);
      const objects = await editor.getObjects();
      return objects.length;
    });

    expect(count).toBe(0);
  });

  it('exportState returns valid state', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor width="400" height="300"></wtp-editor>');

    const state = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      await editor.addText('State Test');
      return editor.exportState();
    });

    expect(state).toBeTruthy();
    expect(state.width).toBe(400);
    expect(state.height).toBe(300);
    expect(state.texts.length).toBe(1);
    expect(state.texts[0].text).toBe('State Test');
    expect(state.fabricJson).toBeTruthy();
  });

  it('exportImage returns a data URL', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor width="100" height="100"></wtp-editor>');

    const dataUrl = await page.evaluate(async () => {
      const editor = document.querySelector('wtp-editor') as EditorElement;
      return editor.exportImage('png');
    });

    expect(dataUrl).toContain('data:image/png');
  });

  it('Add Text button adds text via toolbar', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-editor></wtp-editor>');

    const el = await page.find('wtp-editor');
    const stateChangedSpy = await el.spyOnEvent('wtpEditorStateChanged');

    // Click Add Text button
    const addTextBtn = await page.find('wtp-editor .toolbar-btn');
    await addTextBtn.click();
    await page.waitForChanges();
    await new Promise(r => setTimeout(r, 200));

    expect(stateChangedSpy).toHaveReceivedEvent();
  });
});
