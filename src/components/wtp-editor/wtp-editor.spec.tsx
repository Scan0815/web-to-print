import { render, h, describe, it, expect } from '@stencil/vitest';
import type { ArticleView, PrintArea } from '../../types/editor';

type EditorElement = HTMLElement & {
  width: number;
  height: number;
  fonts: string[];
  printArea: PrintArea;
  labels: Record<string, string>;
};

describe('wtp-editor', () => {
  it('renders the editor container', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    expect(root.querySelector('.wtp-editor')).toBeTruthy();
  });

  it('renders the toolbar', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    expect(root.querySelector('.toolbar')).toBeTruthy();
  });

  it('renders a canvas element', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    expect(root.querySelector('canvas')).toBeTruthy();
  });

  it('renders Add Text button', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    const buttons = root.querySelectorAll('.toolbar-btn');
    const addTextBtn = Array.from(buttons).find(b => b.textContent?.includes('Add Text'));
    expect(addTextBtn).toBeTruthy();
  });

  it('renders font select with default fonts', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    const select = root.querySelector('.font-select');
    expect(select).toBeTruthy();
    expect(select?.querySelectorAll('option').length).toBe(5); // 5 default fonts
  });

  it('renders Delete button with trash icon', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    const deleteBtn = root.querySelector('.toolbar-btn.danger');
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn?.querySelector('svg')).toBeTruthy();
  });

  it('does not render Export button in toolbar', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    const buttons = root.querySelectorAll('.toolbar-btn');
    const exportBtn = Array.from(buttons).find(b => b.textContent?.includes('Export'));
    expect(exportBtn).toBeUndefined();
  });

  it('accepts width and height props', async () => {
    const { root } = await render(<wtp-editor width={1000} height={800}></wtp-editor>);
    expect((root as EditorElement).width).toBe(1000);
    expect((root as EditorElement).height).toBe(800);
  });

  it('accepts custom fonts prop', async () => {
    const { root, waitForChanges } = await render(<wtp-editor></wtp-editor>);

    (root as EditorElement).fonts = ['Roboto', 'Open Sans'];
    await waitForChanges();

    expect(root.querySelectorAll('.font-select option').length).toBe(2);
  });

  it('has default dimensions', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    expect((root as EditorElement).width).toBe(800);
    expect((root as EditorElement).height).toBe(600);
  });

  it('accepts printArea prop', async () => {
    const { root, waitForChanges } = await render(<wtp-editor></wtp-editor>);

    const printArea: PrintArea = {
      topLeft: { x: 0.2, y: 0.3 },
      topRight: { x: 0.8, y: 0.3 },
      bottomRight: { x: 0.8, y: 0.7 },
      bottomLeft: { x: 0.2, y: 0.7 },
    };

    (root as EditorElement).printArea = printArea;
    await waitForChanges();

    expect((root as EditorElement).printArea).toEqual(printArea);
  });

  // --- View validation ---

  it('rejects views without a stable id', async () => {
    const views = [{ image: '', label: 'Front', printArea: null }] as ArticleView[];
    await expect(render(<wtp-editor views={views}></wtp-editor>)).rejects.toThrow(/stable `id`/);
  });

  it('rejects duplicate view ids', async () => {
    const views: ArticleView[] = [
      { id: 'front', image: '', label: 'Front', printArea: null },
      { id: 'front', image: '', label: 'Front again', printArea: null },
    ];
    await expect(render(<wtp-editor views={views}></wtp-editor>)).rejects.toThrow(/duplicate ids/);
  });

  // --- Labels prop tests ---

  it('uses default labels when no override is provided', async () => {
    const { root } = await render(<wtp-editor></wtp-editor>);
    const buttons = root.querySelectorAll('.toolbar-btn');
    const addTextBtn = Array.from(buttons).find(b => b.querySelector('span')?.textContent === 'Add Text');
    expect(addTextBtn).toBeTruthy();
    expect(addTextBtn?.getAttribute('title')).toBe('Add text');
  });

  it('overrides toolbar labels via the labels prop', async () => {
    const { root, waitForChanges } = await render(<wtp-editor></wtp-editor>);

    (root as EditorElement).labels = {
      addTextButton: 'Text hinzufügen',
      addTextTooltip: 'Text hinzufügen',
      deleteButtonTooltip: 'Auswahl löschen',
    };
    await waitForChanges();

    const buttons = root.querySelectorAll('.toolbar-btn');
    const addTextBtn = Array.from(buttons).find(b => b.querySelector('span')?.textContent === 'Text hinzufügen');
    expect(addTextBtn).toBeTruthy();
    expect(root.querySelector('.toolbar-btn.danger')?.getAttribute('title')).toBe('Auswahl löschen');
  });

  it('falls back to defaults for unspecified label keys', async () => {
    const { root, waitForChanges } = await render(<wtp-editor></wtp-editor>);

    (root as EditorElement).labels = { addTextButton: 'Custom' };
    await waitForChanges();

    expect(root.querySelector('.font-select')?.getAttribute('title')).toBe('Font family');
  });
});
