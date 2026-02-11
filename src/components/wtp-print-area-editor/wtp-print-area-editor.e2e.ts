import { newE2EPage } from '@stencil/core/testing';

describe('wtp-print-area-editor', () => {
  it('renders the component', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-print-area-editor></wtp-print-area-editor>');
    const el = await page.find('wtp-print-area-editor');
    expect(el).not.toBeNull();
  });

  it('getPrintArea returns default area when no printArea is set', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-print-area-editor></wtp-print-area-editor>');
    const el = await page.find('wtp-print-area-editor');

    const area = await el.callMethod('getPrintArea');
    expect(area).toBeDefined();
    expect(area.topLeft).toBeDefined();
    expect(area.topRight).toBeDefined();
    expect(area.bottomRight).toBeDefined();
    expect(area.bottomLeft).toBeDefined();
    // Default centered area
    expect(area.topLeft.x).toBeCloseTo(0.35, 1);
    expect(area.topLeft.y).toBeCloseTo(0.325, 1);
  });

  it('setPrintArea and getPrintArea round-trip with rectangular quad', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-print-area-editor></wtp-print-area-editor>');
    const el = await page.find('wtp-print-area-editor');

    const input = {
      topLeft: { x: 0.2, y: 0.2 },
      topRight: { x: 0.8, y: 0.2 },
      bottomRight: { x: 0.8, y: 0.8 },
      bottomLeft: { x: 0.2, y: 0.8 },
      bulge: 0.3,
    };
    await el.callMethod('setPrintArea', input);

    const result = await el.callMethod('getPrintArea');
    expect(result.topLeft.x).toBeCloseTo(input.topLeft.x, 2);
    expect(result.topLeft.y).toBeCloseTo(input.topLeft.y, 2);
    expect(result.topRight.x).toBeCloseTo(input.topRight.x, 2);
    expect(result.topRight.y).toBeCloseTo(input.topRight.y, 2);
    expect(result.bottomRight.x).toBeCloseTo(input.bottomRight.x, 2);
    expect(result.bottomRight.y).toBeCloseTo(input.bottomRight.y, 2);
    expect(result.bottomLeft.x).toBeCloseTo(input.bottomLeft.x, 2);
    expect(result.bottomLeft.y).toBeCloseTo(input.bottomLeft.y, 2);
    expect(result.bulge).toBeCloseTo(input.bulge, 2);
  });

  it('setPrintArea and getPrintArea round-trip with non-rectangular quad', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-print-area-editor></wtp-print-area-editor>');
    const el = await page.find('wtp-print-area-editor');

    const input = {
      topLeft: { x: 0.3, y: 0.15 },
      topRight: { x: 0.7, y: 0.25 },
      bottomRight: { x: 0.65, y: 0.85 },
      bottomLeft: { x: 0.25, y: 0.75 },
      bulge: -0.2,
    };
    await el.callMethod('setPrintArea', input);

    const result = await el.callMethod('getPrintArea');
    expect(result.topLeft.x).toBeCloseTo(input.topLeft.x, 2);
    expect(result.topLeft.y).toBeCloseTo(input.topLeft.y, 2);
    expect(result.topRight.x).toBeCloseTo(input.topRight.x, 2);
    expect(result.topRight.y).toBeCloseTo(input.topRight.y, 2);
    expect(result.bottomRight.x).toBeCloseTo(input.bottomRight.x, 2);
    expect(result.bottomRight.y).toBeCloseTo(input.bottomRight.y, 2);
    expect(result.bottomLeft.x).toBeCloseTo(input.bottomLeft.x, 2);
    expect(result.bottomLeft.y).toBeCloseTo(input.bottomLeft.y, 2);
    expect(result.bulge).toBeCloseTo(input.bulge, 2);
  });
});
