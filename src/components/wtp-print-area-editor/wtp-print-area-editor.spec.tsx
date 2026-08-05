import { render, h, describe, it, expect } from '@stencil/vitest';

type PrintAreaEditorElement = HTMLElement & {
  width: number;
  height: number;
};

describe('wtp-print-area-editor', () => {
  it('renders a canvas element', async () => {
    const { root } = await render(<wtp-print-area-editor></wtp-print-area-editor>);
    expect(root.querySelector('canvas')).not.toBeNull();
  });

  it('renders with default dimensions', async () => {
    const { root } = await render(<wtp-print-area-editor></wtp-print-area-editor>);
    expect((root as PrintAreaEditorElement).width).toBe(800);
    expect((root as PrintAreaEditorElement).height).toBe(600);
  });

  it('accepts custom width and height props', async () => {
    const { root } = await render(<wtp-print-area-editor width={640} height={480}></wtp-print-area-editor>);
    expect((root as PrintAreaEditorElement).width).toBe(640);
    expect((root as PrintAreaEditorElement).height).toBe(480);
  });

  it('wraps canvas in wtp-print-area-editor div', async () => {
    const { root } = await render(<wtp-print-area-editor></wtp-print-area-editor>);
    const wrapper = root.querySelector('.wtp-print-area-editor');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('canvas')).not.toBeNull();
  });
});
