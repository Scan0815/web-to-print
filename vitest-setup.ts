// Browser and spec tests run against the built bundle, so `npm run build` must run first.
await import('./dist/web-to-print/web-to-print.esm.js');

// Fabric.js draws dashed print-area outlines, which the mock DOM's 2D context lacks.
// Real browsers already provide these, so the patch only fills gaps.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
  const ctx = originalGetContext.call(this, type, ...args) as CanvasRenderingContext2D | null;
  if (ctx != null && typeof ctx.setLineDash !== 'function') {
    ctx.setLineDash = () => {};
    ctx.getLineDash = () => [];
  }
  if (ctx != null && typeof ctx.strokeRect !== 'function') {
    ctx.strokeRect = () => {};
  }
  return ctx;
} as typeof originalGetContext;

export {};
