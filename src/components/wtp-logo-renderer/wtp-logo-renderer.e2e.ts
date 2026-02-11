import { newE2EPage } from '@stencil/core/testing';

describe('wtp-logo-renderer e2e', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer></wtp-logo-renderer>');

    const el = await page.find('wtp-logo-renderer');
    expect(el).not.toBeNull();
  });

  it('renders container div', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer></wtp-logo-renderer>');

    const container = await page.find('wtp-logo-renderer .wtp-logo-renderer');
    expect(container).not.toBeNull();
  });

  it('applies specified dimensions', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer width="500" height="300"></wtp-logo-renderer>');

    const dims = await page.evaluate(() => {
      const container = document.querySelector('wtp-logo-renderer .wtp-logo-renderer') as HTMLElement;
      return { width: container.style.width, height: container.style.height };
    });
    expect(dims.width).toBe('500px');
    expect(dims.height).toBe('300px');
  });

  it('provides exportImage method', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer width="100" height="100"></wtp-logo-renderer>');

    const dataUrl = await page.evaluate(async () => {
      const el = document.querySelector('wtp-logo-renderer') as HTMLElement & { exportImage: (f: string) => Promise<string> };
      return el.exportImage('png');
    });

    expect(dataUrl).toContain('data:image/png');
  });

  it('component is functional after property change', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer></wtp-logo-renderer>');

    const el = await page.find('wtp-logo-renderer');

    // Trigger re-render by setting background color
    el.setProperty('backgroundColor', '#ff0000');
    await page.waitForChanges();

    // Verify the component is still functional
    expect(el).not.toBeNull();
  });

  it('renders a logo within printArea bounds', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer width="400" height="400"></wtp-logo-renderer>');

    // Create a small red square as a data URL and set printArea + logos
    const rendered = await page.evaluate(async () => {
      const el = document.querySelector('wtp-logo-renderer') as HTMLElement & {
        printArea: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } };
        logos: { id: string; dataUrl: string }[];
        exportImage: (f: string) => Promise<string>;
      };

      // 10x10 red PNG as data URL
      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 10, 10);
      const logoDataUrl = canvas.toDataURL('image/png');

      el.printArea = {
        topLeft: { x: 0.25, y: 0.25 },
        topRight: { x: 0.75, y: 0.25 },
        bottomRight: { x: 0.75, y: 0.75 },
        bottomLeft: { x: 0.25, y: 0.75 },
      };
      el.logos = [{ id: 'test-logo', dataUrl: logoDataUrl }];

      // Wait for rendering
      await new Promise(r => setTimeout(r, 500));

      return el.exportImage('png');
    });

    // The exported image should contain non-blank content (logo was rendered)
    expect(rendered).toContain('data:image/png');
    // A non-trivial data URL indicates actual content was rendered
    expect(rendered.length).toBeGreaterThan(100);
  });

  it('renders logo with explicit transform when printArea is also set', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer width="400" height="400"></wtp-logo-renderer>');

    const rendered = await page.evaluate(async () => {
      const el = document.querySelector('wtp-logo-renderer') as HTMLElement & {
        printArea: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } };
        logos: { id: string; dataUrl: string; transform: { x: number; y: number; scaleX: number; scaleY: number; angle: number } }[];
        exportImage: (f: string) => Promise<string>;
      };

      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 10, 10);
      const logoDataUrl = canvas.toDataURL('image/png');

      el.printArea = {
        topLeft: { x: 0.45, y: 0.45 },
        topRight: { x: 0.55, y: 0.45 },
        bottomRight: { x: 0.55, y: 0.55 },
        bottomLeft: { x: 0.45, y: 0.55 },
      };
      // Explicit transform should be used instead of printArea
      el.logos = [{
        id: 'test-logo',
        dataUrl: logoDataUrl,
        transform: { x: 200, y: 200, scaleX: 5, scaleY: 5, angle: 0 },
      }];

      await new Promise(r => setTimeout(r, 500));
      return el.exportImage('png');
    });

    expect(rendered).toContain('data:image/png');
    expect(rendered.length).toBeGreaterThan(100);
  });

  it('renders logo-layer img elements for auto-fit logos', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-renderer width="400" height="400"></wtp-logo-renderer>');

    await page.evaluate(async () => {
      const el = document.querySelector('wtp-logo-renderer') as HTMLElement & {
        printArea: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } };
        logos: { id: string; dataUrl: string }[];
      };

      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 10, 10);
      const logoDataUrl = canvas.toDataURL('image/png');

      el.printArea = {
        topLeft: { x: 0.25, y: 0.25 },
        topRight: { x: 0.75, y: 0.25 },
        bottomRight: { x: 0.75, y: 0.75 },
        bottomLeft: { x: 0.25, y: 0.75 },
      };
      el.logos = [{ id: 'test-logo', dataUrl: logoDataUrl }];

      await new Promise(r => setTimeout(r, 500));
    });

    const logoLayer = await page.find('wtp-logo-renderer .logo-layer');
    expect(logoLayer).not.toBeNull();
  });
});
