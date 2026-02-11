import { newSpecPage } from '@stencil/core/testing';
import { WtpLogoRenderer } from './wtp-logo-renderer';

describe('wtp-logo-renderer', () => {
  it('renders the container div', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer></wtp-logo-renderer>',
    });

    const container = page.root?.querySelector('.wtp-logo-renderer');
    expect(container).toBeTruthy();
  });

  it('renders a product-bg img when productImage is set', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer product-image="https://example.com/shirt.jpg"></wtp-logo-renderer>',
    });

    const bg = page.root?.querySelector('.product-bg');
    expect(bg).toBeTruthy();
  });

  it('does not render product-bg img when productImage is not set', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer></wtp-logo-renderer>',
    });

    const bg = page.root?.querySelector('.product-bg');
    expect(bg).toBeNull();
  });

  it('accepts width and height props', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer width="800" height="600"></wtp-logo-renderer>',
    });

    expect(page.rootInstance.width).toBe(800);
    expect(page.rootInstance.height).toBe(600);
  });

  it('accepts background-color prop', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer background-color="#ff0000"></wtp-logo-renderer>',
    });

    expect(page.rootInstance.backgroundColor).toBe('#ff0000');
  });

  it('has default dimensions', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer></wtp-logo-renderer>',
    });

    expect(page.rootInstance.width).toBe(600);
    expect(page.rootInstance.height).toBe(400);
  });

  it('accepts printArea prop', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer></wtp-logo-renderer>',
    });

    const printArea = {
      topLeft: { x: 0.275, y: 0.225 },
      topRight: { x: 0.725, y: 0.225 },
      bottomRight: { x: 0.725, y: 0.575 },
      bottomLeft: { x: 0.275, y: 0.575 },
    };
    page.rootInstance.printArea = printArea;
    await page.waitForChanges();

    expect(page.rootInstance.printArea).toEqual(printArea);
  });

  it('printArea is undefined by default', async () => {
    const page = await newSpecPage({
      components: [WtpLogoRenderer],
      html: '<wtp-logo-renderer></wtp-logo-renderer>',
    });

    expect(page.rootInstance.printArea).toBeUndefined();
  });
});
