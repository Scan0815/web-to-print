import { render, h, describe, it, expect } from '@stencil/vitest';
import type { PlacedLogo, PrintArea } from '../../types/editor';

type RendererElement = HTMLElement & {
  backgroundColor: string;
  printArea: PrintArea;
  logos: PlacedLogo[];
  exportImage: (format: string) => Promise<string>;
};

/** 10x10 solid-colour PNG data URL. */
function makeLogoDataUrl(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 10, 10);
  return canvas.toDataURL('image/png');
}

describe('wtp-logo-renderer browser', () => {
  it('renders', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect(root).not.toBeNull();
  });

  it('renders container div', async () => {
    const { root } = await render(<wtp-logo-renderer></wtp-logo-renderer>);
    expect(root.querySelector('.wtp-logo-renderer')).not.toBeNull();
  });

  it('applies specified dimensions', async () => {
    const { root } = await render(<wtp-logo-renderer width={500} height={300}></wtp-logo-renderer>);
    const container = root.querySelector('.wtp-logo-renderer') as HTMLElement;
    expect(container.style.width).toBe('500px');
    expect(container.style.height).toBe('300px');
  });

  it('provides exportImage method', async () => {
    const { root } = await render(<wtp-logo-renderer width={100} height={100}></wtp-logo-renderer>);
    const dataUrl = await (root as RendererElement).exportImage('png');
    expect(dataUrl).toContain('data:image/png');
  });

  it('component is functional after property change', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-renderer></wtp-logo-renderer>);

    (root as RendererElement).backgroundColor = '#ff0000';
    await waitForChanges();

    expect(root).not.toBeNull();
  });

  it('renders a logo within printArea bounds', async () => {
    const { root } = await render(<wtp-logo-renderer width={400} height={400}></wtp-logo-renderer>);
    const el = root as RendererElement;

    el.printArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    el.logos = [{ id: 'test-logo', dataUrl: makeLogoDataUrl('#ff0000') }];

    await new Promise(r => setTimeout(r, 500));
    const rendered = await el.exportImage('png');

    expect(rendered).toContain('data:image/png');
    expect(rendered.length).toBeGreaterThan(100);
  });

  it('renders logo with explicit transform when printArea is also set', async () => {
    const { root } = await render(<wtp-logo-renderer width={400} height={400}></wtp-logo-renderer>);
    const el = root as RendererElement;

    el.printArea = {
      topLeft: { x: 0.45, y: 0.45 },
      topRight: { x: 0.55, y: 0.45 },
      bottomRight: { x: 0.55, y: 0.55 },
      bottomLeft: { x: 0.45, y: 0.55 },
    };
    // Explicit transform should be used instead of printArea
    el.logos = [
      {
        id: 'test-logo',
        dataUrl: makeLogoDataUrl('#0000ff'),
        transform: { x: 200, y: 200, scaleX: 5, scaleY: 5, angle: 0 },
      },
    ];

    await new Promise(r => setTimeout(r, 500));
    const rendered = await el.exportImage('png');

    expect(rendered).toContain('data:image/png');
    expect(rendered.length).toBeGreaterThan(100);
  });

  it('renders logo-layer img elements for auto-fit logos', async () => {
    const { root } = await render(<wtp-logo-renderer width={400} height={400}></wtp-logo-renderer>);
    const el = root as RendererElement;

    el.printArea = {
      topLeft: { x: 0.25, y: 0.25 },
      topRight: { x: 0.75, y: 0.25 },
      bottomRight: { x: 0.75, y: 0.75 },
      bottomLeft: { x: 0.25, y: 0.75 },
    };
    el.logos = [{ id: 'test-logo', dataUrl: makeLogoDataUrl('#00ff00') }];

    await new Promise(r => setTimeout(r, 500));

    expect(root.querySelector('.logo-layer')).not.toBeNull();
  });
});
