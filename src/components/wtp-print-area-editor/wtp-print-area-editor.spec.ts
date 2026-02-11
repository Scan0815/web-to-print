import { newSpecPage } from '@stencil/core/testing';
import { WtpPrintAreaEditor } from './wtp-print-area-editor';

// Fabric.js Rect with strokeDashArray calls setLineDash which JSDOM doesn't provide.
// Patch the mock canvas 2D context to include the missing method.
beforeAll(() => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
    const ctx = origGetContext.call(this, type, ...args);
    if (ctx && !('setLineDash' in ctx)) {
      (ctx as CanvasRenderingContext2D).setLineDash = () => {};
      (ctx as CanvasRenderingContext2D).getLineDash = () => [];
    }
    return ctx;
  } as typeof origGetContext;
});

describe('wtp-print-area-editor', () => {
  it('renders a canvas element', async () => {
    const page = await newSpecPage({
      components: [WtpPrintAreaEditor],
      html: '<wtp-print-area-editor></wtp-print-area-editor>',
    });
    const canvas = page.root.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('renders with default dimensions', async () => {
    const page = await newSpecPage({
      components: [WtpPrintAreaEditor],
      html: '<wtp-print-area-editor></wtp-print-area-editor>',
    });
    const component = page.rootInstance as WtpPrintAreaEditor;
    expect(component.width).toBe(800);
    expect(component.height).toBe(600);
  });

  it('accepts custom width and height props', async () => {
    const page = await newSpecPage({
      components: [WtpPrintAreaEditor],
      html: '<wtp-print-area-editor width="640" height="480"></wtp-print-area-editor>',
    });
    const component = page.rootInstance as WtpPrintAreaEditor;
    expect(component.width).toBe(640);
    expect(component.height).toBe(480);
  });

  it('wraps canvas in wtp-print-area-editor div', async () => {
    const page = await newSpecPage({
      components: [WtpPrintAreaEditor],
      html: '<wtp-print-area-editor></wtp-print-area-editor>',
    });
    const wrapper = page.root.querySelector('.wtp-print-area-editor');
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector('canvas')).not.toBeNull();
  });
});
