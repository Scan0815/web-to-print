import { Component, h, Prop, Method, Event, EventEmitter, Watch, Element } from '@stencil/core';
import { Canvas, FabricObject, Control, Point } from 'fabric';
import { PrintArea, RelativePoint } from '../../types';
import { setCanvasBackground, printAreaToPixelCorners, pixelCornersToPrintArea, defaultPrintArea } from '../../utils/canvas-helpers';

const CORNER_RADIUS = 7;

/**
 * Custom Fabric.js object that renders a quadrilateral defined by 4 corner
 * offsets from the bounding-box center. Top/bottom edges can be curved
 * via `bulge` (-1 to 1) using quadratic Bezier curves.
 */
class PrintAreaQuad extends FabricObject {
  declare cornerOffsets: [Point, Point, Point, Point]; // TL, TR, BR, BL
  declare bulge: number;

  constructor(options?: Record<string, unknown>) {
    super(options);
    this.cornerOffsets = (options?.cornerOffsets as [Point, Point, Point, Point]) ?? [
      new Point(-50, -50), new Point(50, -50),
      new Point(50, 50), new Point(-50, 50),
    ];
    this.bulge = (options?.bulge as number) ?? 0;
    this.objectCaching = false;
  }

  _render(ctx: CanvasRenderingContext2D) {
    const [tl, tr, br, bl] = this.cornerOffsets;

    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);

    if (this.bulge !== 0) {
      // Curved top edge: control point at midpoint shifted by bulge
      const topMidX = (tl.x + tr.x) / 2;
      const topMidY = (tl.y + tr.y) / 2;
      const bulgePixels = this.bulge * (this.height ?? 1);
      ctx.quadraticCurveTo(topMidX, topMidY - bulgePixels, tr.x, tr.y);
    } else {
      ctx.lineTo(tr.x, tr.y);
    }

    ctx.lineTo(br.x, br.y);

    if (this.bulge !== 0) {
      // Curved bottom edge: same direction as top for cylindrical appearance
      const botMidX = (br.x + bl.x) / 2;
      const botMidY = (br.y + bl.y) / 2;
      const bulgePixels = this.bulge * (this.height ?? 1);
      ctx.quadraticCurveTo(botMidX, botMidY - bulgePixels, bl.x, bl.y);
    } else {
      ctx.lineTo(bl.x, bl.y);
    }

    ctx.closePath();
    this._renderPaintInOrder(ctx);
  }

  /** Recompute left/top/width/height from absolute corner positions. */
  recalcBounds() {
    const center = this.getCenterPoint();
    const abs = this.cornerOffsets.map(o => new Point(center.x + o.x, center.y + o.y));

    const xs = abs.map(p => p.x);
    const ys = abs.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const newCenterX = (minX + maxX) / 2;
    const newCenterY = (minY + maxY) / 2;

    this.cornerOffsets = abs.map(p => new Point(p.x - newCenterX, p.y - newCenterY)) as [Point, Point, Point, Point];

    this.set({
      left: newCenterX,
      top: newCenterY,
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    });
    this.setCoords();
  }
}

function buildCornerControl(index: number): Control {
  return new Control({
    x: 0,
    y: 0,
    sizeX: CORNER_RADIUS * 2,
    sizeY: CORNER_RADIUS * 2,
    touchSizeX: CORNER_RADIUS * 4,
    touchSizeY: CORNER_RADIUS * 4,
    cursorStyleHandler: () => 'move',

    positionHandler: (_dim, finalMatrix, fabricObject) => {
      const quad = fabricObject as PrintAreaQuad;
      return new Point(
        quad.cornerOffsets[index].x,
        quad.cornerOffsets[index].y,
      ).transform(finalMatrix);
    },

    actionHandler: (_eventData, transformData, x, y) => {
      const quad = transformData.target as PrintAreaQuad;
      const center = quad.getCenterPoint();
      quad.cornerOffsets[index] = new Point(x - center.x, y - center.y);
      quad.recalcBounds();
      return true;
    },

    render: (ctx, left, top) => {
      ctx.save();
      ctx.fillStyle = '#2563eb';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(left, top, CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  });
}

function buildBulgeControl(): Control {
  const HANDLE_OFFSET_X = 24;
  const TRACK_GAP = 4;

  return new Control({
    x: 0.5,
    y: 0,
    offsetX: HANDLE_OFFSET_X,
    sizeX: CORNER_RADIUS * 2,
    sizeY: CORNER_RADIUS * 2,
    touchSizeX: CORNER_RADIUS * 4,
    touchSizeY: CORNER_RADIUS * 4,
    cursorStyleHandler: () => 'ns-resize',

    positionHandler: (dim, finalMatrix, fabricObject) => {
      const quad = fabricObject as PrintAreaQuad;
      return new Point(
        0.5 * dim.x + HANDLE_OFFSET_X,
        -quad.bulge * dim.y / 2,
      ).transform(finalMatrix);
    },

    actionHandler: (_eventData, transformData, _x, y) => {
      const quad = transformData.target as PrintAreaQuad;
      const center = quad.getCenterPoint();
      const halfH = (quad.height ?? 0) * (quad.scaleY ?? 1) / 2;
      const bulge = Math.max(-1, Math.min(1, (center.y - y) / Math.max(halfH, 1)));
      quad.bulge = bulge;
      return true;
    },

    render: (ctx, left, top, _styleOverride, fabricObject) => {
      const quad = fabricObject as PrintAreaQuad;
      const halfH = ((quad.height ?? 0) * (quad.scaleY ?? 1)) / 2;
      const angleRad = ((quad.angle ?? 0) * Math.PI) / 180;
      const trackTopX = left + Math.sin(angleRad) * halfH;
      const trackTopY = top - Math.cos(angleRad) * halfH;
      const trackBotX = left - Math.sin(angleRad) * halfH;
      const trackBotY = top + Math.cos(angleRad) * halfH;

      ctx.save();

      // Track line
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(trackTopX, trackTopY - TRACK_GAP);
      ctx.lineTo(trackBotX, trackBotY + TRACK_GAP);
      ctx.stroke();
      ctx.setLineDash([]);

      // Handle circle
      ctx.fillStyle = '#2563eb';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(left, top, CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Arrow up + "+" label
      ctx.fillStyle = 'rgba(37, 99, 235, 0.5)';
      ctx.beginPath();
      ctx.moveTo(trackTopX, trackTopY - TRACK_GAP);
      ctx.lineTo(trackTopX - 4, trackTopY - TRACK_GAP + 6);
      ctx.lineTo(trackTopX + 4, trackTopY - TRACK_GAP + 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+', trackTopX, trackTopY - TRACK_GAP - 4);

      // Arrow down + "\u2212" label
      ctx.beginPath();
      ctx.moveTo(trackBotX, trackBotY + TRACK_GAP);
      ctx.lineTo(trackBotX - 4, trackBotY + TRACK_GAP - 6);
      ctx.lineTo(trackBotX + 4, trackBotY + TRACK_GAP - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillText('\u2212', trackBotX, trackBotY + TRACK_GAP + 12);

      ctx.restore();
    },
  });
}

@Component({
  tag: 'wtp-print-area-editor',
  styleUrl: 'wtp-print-area-editor.scss',
  scoped: true,
})
export class WtpPrintAreaEditor {
  @Element() el: HTMLElement;

  /** Product background image URL. */
  @Prop() productImage: string | undefined;
  /** Canvas width in pixels. */
  @Prop() width: number = 800;
  /** Canvas height in pixels. */
  @Prop() height: number = 600;
  /** Current print area (relative 0-1 coordinates). */
  @Prop({ mutable: true }) printArea: PrintArea | undefined;

  /** Fires when the print area rectangle is modified. */
  @Event() wtpPrintAreaChange: EventEmitter<PrintArea>;

  private canvas: Canvas | undefined;
  private canvasEl: HTMLCanvasElement | undefined;
  private areaQuad: PrintAreaQuad | undefined;
  /** Generation counter to discard stale background loads. */
  private bgLoadGen = 0;

  componentDidLoad() {
    this.initCanvas();
  }

  disconnectedCallback() {
    ++this.bgLoadGen;
    this.canvas?.dispose();
  }

  @Watch('productImage')
  async onProductImageChange() {
    if (this.canvas === undefined || this.productImage === undefined) return;
    await this.reloadCanvas();
  }

  @Watch('width')
  @Watch('height')
  async onSizeChange() {
    if (this.canvas === undefined) return;
    await this.reloadCanvas();
  }

  @Watch('printArea')
  onPrintAreaChange() {
    this.syncQuadFromPrintArea();
  }

  /** Get the current print area as relative 0-1 coordinates. */
  @Method()
  async getPrintArea(): Promise<PrintArea> {
    return this.readQuadAsPrintArea();
  }

  /** Set the print area and update the quad on canvas. */
  @Method()
  async setPrintArea(printArea: PrintArea): Promise<void> {
    this.printArea = printArea;
    this.syncQuadFromPrintArea();
  }

  /** Create the Fabric Canvas once and perform the initial load. */
  private async initCanvas() {
    if (this.canvasEl === undefined) return;

    this.canvas = new Canvas(this.canvasEl, {
      width: this.width,
      height: this.height,
      backgroundColor: '#ffffff',
      selection: false,
    });

    this.canvas.on('object:modified', (e) => {
      if (e.target === this.areaQuad) {
        this.emitPrintArea();
      }
    });

    this.canvas.on('object:moving', (e) => {
      if (e.target === this.areaQuad) {
        this.clampQuadToBounds();
      }
    });

    await this.reloadCanvas();
  }

  /**
   * Clear the canvas and reload background + quad.
   * Keeps the Fabric Canvas instance alive (no dispose/recreate) to avoid
   * stale DOM state from async dispose in Fabric v7.
   */
  private async reloadCanvas() {
    if (this.canvas === undefined) return;

    const gen = ++this.bgLoadGen;

    // Remove all objects (background image + quad)
    this.areaQuad = undefined;
    this.canvas.discardActiveObject();
    for (const obj of this.canvas.getObjects().slice()) {
      this.canvas.remove(obj);
    }

    // Reset internal state to bounding-box dimensions
    this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    this.canvas.setDimensions({ width: this.width, height: this.height });
    this.canvas.backgroundColor = '#ffffff';
    this.canvas.requestRenderAll();

    // Load product image (may auto-resize canvas in contain mode)
    if (this.productImage !== undefined && this.productImage !== '') {
      await setCanvasBackground(this.canvas, this.productImage);
    }
    if (gen !== this.bgLoadGen) return;

    this.createAreaQuad();
    this.canvas.renderAll();
  }

  private createAreaQuad() {
    if (this.canvas === undefined) return;

    const pa = this.printArea ?? defaultPrintArea();
    // Convert relative coords directly to canvas pixels (image-relative coordinates)
    const cw = this.canvas!.getWidth();
    const ch = this.canvas!.getHeight();
    const [tl, tr, br, bl] = printAreaToPixelCorners(pa, cw, ch);

    // Compute centroid and bounding box
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;
    const xs = [tl.x, tr.x, br.x, bl.x];
    const ys = [tl.y, tr.y, br.y, bl.y];
    const bbW = Math.max(Math.max(...xs) - Math.min(...xs), 1);
    const bbH = Math.max(Math.max(...ys) - Math.min(...ys), 1);

    this.areaQuad = new PrintAreaQuad({
      left: cx,
      top: cy,
      width: bbW,
      height: bbH,
      cornerOffsets: [
        new Point(tl.x - cx, tl.y - cy),
        new Point(tr.x - cx, tr.y - cy),
        new Point(br.x - cx, br.y - cy),
        new Point(bl.x - cx, bl.y - cy),
      ],
      bulge: pa.bulge ?? 0,
      originX: 'center',
      originY: 'center',
      fill: 'rgba(37, 99, 235, 0.15)',
      stroke: '#2563eb',
      strokeWidth: 2,
      strokeDashArray: [6, 4],
      // Disable standard resize/rotate controls
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hasRotatingPoint: false,
      borderColor: '#2563eb',
    });

    // Replace all controls with corner handles + bulge
    this.areaQuad.controls = {
      corner0: buildCornerControl(0),
      corner1: buildCornerControl(1),
      corner2: buildCornerControl(2),
      corner3: buildCornerControl(3),
      bulgeHandle: buildBulgeControl(),
    };

    this.canvas.add(this.areaQuad);
    this.canvas.renderAll();
  }

  private syncQuadFromPrintArea() {
    if (this.areaQuad === undefined || this.canvas === undefined) return;

    const pa = this.printArea ?? defaultPrintArea();
    // Convert relative coords directly to canvas pixels (image-relative coordinates)
    const cw = this.canvas!.getWidth();
    const ch = this.canvas!.getHeight();
    const [tl, tr, br, bl] = printAreaToPixelCorners(pa, cw, ch);

    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;
    const xs = [tl.x, tr.x, br.x, bl.x];
    const ys = [tl.y, tr.y, br.y, bl.y];

    this.areaQuad.cornerOffsets = [
      new Point(tl.x - cx, tl.y - cy),
      new Point(tr.x - cx, tr.y - cy),
      new Point(br.x - cx, br.y - cy),
      new Point(bl.x - cx, bl.y - cy),
    ];
    this.areaQuad.bulge = pa.bulge ?? 0;

    this.areaQuad.set({
      left: cx,
      top: cy,
      width: Math.max(Math.max(...xs) - Math.min(...xs), 1),
      height: Math.max(Math.max(...ys) - Math.min(...ys), 1),
      scaleX: 1,
      scaleY: 1,
    });

    this.areaQuad.setCoords();
    this.canvas.renderAll();
  }

  private clampQuadToBounds() {
    if (this.areaQuad === undefined) return;

    const center = this.areaQuad.getCenterPoint();
    const abs = this.areaQuad.cornerOffsets.map(o => ({
      x: center.x + o.x,
      y: center.y + o.y,
    }));

    // Find how much the quad exceeds canvas bounds
    let dx = 0;
    let dy = 0;
    for (const p of abs) {
      if (p.x < 0) dx = Math.max(dx, -p.x);
      if (p.x > this.canvas!.getWidth()) dx = Math.min(dx, this.canvas!.getWidth() - p.x);
      if (p.y < 0) dy = Math.max(dy, -p.y);
      if (p.y > this.canvas!.getHeight()) dy = Math.min(dy, this.canvas!.getHeight() - p.y);
    }

    if (dx !== 0 || dy !== 0) {
      this.areaQuad.set({
        left: (this.areaQuad.left ?? 0) + dx,
        top: (this.areaQuad.top ?? 0) + dy,
      });
    }
  }

  private readQuadAsPrintArea(): PrintArea {
    if (this.areaQuad === undefined) {
      return this.printArea ?? defaultPrintArea();
    }
    const center = this.areaQuad.getCenterPoint();
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: center.x + this.areaQuad.cornerOffsets[0].x, y: center.y + this.areaQuad.cornerOffsets[0].y },
      { x: center.x + this.areaQuad.cornerOffsets[1].x, y: center.y + this.areaQuad.cornerOffsets[1].y },
      { x: center.x + this.areaQuad.cornerOffsets[2].x, y: center.y + this.areaQuad.cornerOffsets[2].y },
      { x: center.x + this.areaQuad.cornerOffsets[3].x, y: center.y + this.areaQuad.cornerOffsets[3].y },
    ];
    // Convert canvas pixels directly to 0-1 image-relative coordinates
    const cw = this.canvas!.getWidth();
    const ch = this.canvas!.getHeight();
    return pixelCornersToPrintArea(corners as [RelativePoint, RelativePoint, RelativePoint, RelativePoint], cw, ch, this.areaQuad.bulge);
  }

  private emitPrintArea() {
    const area = this.readQuadAsPrintArea();
    this.printArea = area;
    this.wtpPrintAreaChange.emit(area);
  }

  render() {
    return (
      <div class="wtp-print-area-editor">
        <canvas ref={el => (this.canvasEl = el as HTMLCanvasElement | undefined)} />
      </div>
    );
  }
}
