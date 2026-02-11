import { newSpecPage } from '@stencil/core/testing';
import { WtpEditor } from './wtp-editor';

describe('wtp-editor', () => {
  it('renders the editor container', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const editor = page.root?.querySelector('.wtp-editor');
    expect(editor).toBeTruthy();
  });

  it('renders the toolbar', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const toolbar = page.root?.querySelector('.toolbar');
    expect(toolbar).toBeTruthy();
  });

  it('renders a canvas element', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const canvas = page.root?.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });

  it('renders Add Text button', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const buttons = page.root?.querySelectorAll('.toolbar-btn');
    const addTextBtn = Array.from(buttons ?? []).find(b => b.textContent?.includes('Add Text'));
    expect(addTextBtn).toBeTruthy();
  });

  it('renders font select with default fonts', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const select = page.root?.querySelector('.font-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = select?.querySelectorAll('option');
    expect(options?.length).toBe(5); // 5 default fonts
  });

  it('renders Delete button', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const buttons = page.root?.querySelectorAll('.toolbar-btn');
    const deleteBtn = Array.from(buttons ?? []).find(b => b.textContent?.includes('Delete'));
    expect(deleteBtn).toBeTruthy();
  });

  it('renders Export button', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const buttons = page.root?.querySelectorAll('.toolbar-btn');
    const exportBtn = Array.from(buttons ?? []).find(b => b.textContent?.includes('Export'));
    expect(exportBtn).toBeTruthy();
  });

  it('accepts width and height props', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor width="1000" height="800"></wtp-editor>',
    });

    expect(page.rootInstance.width).toBe(1000);
    expect(page.rootInstance.height).toBe(800);
  });

  it('accepts custom fonts prop', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    (page.root as unknown as { fonts: string[] }).fonts = ['Roboto', 'Open Sans'];
    await page.waitForChanges();

    const options = page.root?.querySelectorAll('.font-select option');
    expect(options?.length).toBe(2);
  });

  it('has default dimensions', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    expect(page.rootInstance.width).toBe(800);
    expect(page.rootInstance.height).toBe(600);
  });

  it('accepts printArea prop', async () => {
    const page = await newSpecPage({
      components: [WtpEditor],
      html: '<wtp-editor></wtp-editor>',
    });

    const printArea = {
      topLeft: { x: 0.2, y: 0.3 },
      topRight: { x: 0.8, y: 0.3 },
      bottomRight: { x: 0.8, y: 0.7 },
      bottomLeft: { x: 0.2, y: 0.7 },
    };

    (page.root as unknown as { printArea: typeof printArea }).printArea = printArea;
    await page.waitForChanges();

    expect(page.rootInstance.printArea).toEqual(printArea);
  });
});
