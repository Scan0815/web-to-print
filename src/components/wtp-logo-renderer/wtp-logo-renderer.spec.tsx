import { render, h, describe, it, expect } from '@stencil/vitest';
import type { PrintArea } from '../../types/editor';

type RendererElement = HTMLElement & {
  width: number;
  height: number;
  backgroundColor: string;
  printArea?: PrintArea;
};

describe('wtp-logo-renderer', () => {
  it('renders the container div', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect(root.querySelector('.wtp-logo-renderer')).toBeTruthy();
  });

  it('renders a product-bg img when productImage is set', async () => {
    const { root } = await render(<wtp-logo-renderer product-image="https://example.com/shirt.jpg"></wtp-logo-renderer>);
    expect(root.querySelector('.product-bg')).toBeTruthy();
  });

  it('does not render product-bg img when productImage is not set', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect(root.querySelector('.product-bg')).toBeNull();
  });

  it('accepts width and height props', async () => {
    const { root } = await render(<wtp-logo-renderer width={800} height={600}></wtp-logo-renderer>);
    expect((root as RendererElement).width).toBe(800);
    expect((root as RendererElement).height).toBe(600);
  });

  it('accepts background-color prop', async () => {
    const { root } = await render(<wtp-logo-renderer background-color="#ff0000"></wtp-logo-renderer>);
    expect((root as RendererElement).backgroundColor).toBe('#ff0000');
  });

  it('has default dimensions', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect((root as RendererElement).width).toBe(600);
    expect((root as RendererElement).height).toBe(400);
  });

  it('accepts printArea prop', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-renderer></wtp-logo-renderer>);

    const printArea: PrintArea = {
      topLeft: { x: 0.275, y: 0.225 },
      topRight: { x: 0.725, y: 0.225 },
      bottomRight: { x: 0.725, y: 0.575 },
      bottomLeft: { x: 0.275, y: 0.575 },
    };
    (root as RendererElement).printArea = printArea;
    await waitForChanges();

    expect((root as RendererElement).printArea).toEqual(printArea);
  });

  it('printArea is undefined by default', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect((root as RendererElement).printArea).toBeUndefined();
  });
});
