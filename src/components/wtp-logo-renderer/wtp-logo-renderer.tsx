import { Component, h, Prop, Method, Event, EventEmitter, Watch, Element, State } from '@stencil/core';
import { PlacedLogo, PrintArea } from '../../types';
import { fitLogoToPrintArea, printAreaToPixelCorners, warpImageForBulge, upscaleSvgDataUrl } from '../../utils/canvas-helpers';
import { loadImage, computeContainFit, centerOriginToTopLeft, getSvgIntrinsicSize, renderToCanvas, RenderLayer } from '../../utils/html-render-helpers';

interface RenderedLayer {
  id: string;
  src: string;
  exportImg: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  skewX: number;
  skewY: number;
}

@Component({
  tag: 'wtp-logo-renderer',
  styleUrl: 'wtp-logo-renderer.scss',
  scoped: true,
})
export class WtpLogoRenderer {
  @Element() el: HTMLElement;

  /** Product background image URL. */
  @Prop() productImage: string | undefined;
  /** Container width in pixels. */
  @Prop() width: number = 600;
  /** Container height in pixels. */
  @Prop() height: number = 400;
  /** Array of logos to place on the renderer. */
  @Prop() logos: PlacedLogo[] = [];
  /** Background color. */
  @Prop() backgroundColor: string = '#ffffff';
  /** Print area definition for auto-fitting logos (relative 0-1 coordinates). */
  @Prop({ mutable: true }) printArea: PrintArea | undefined;

  /** Fires when the renderer has finished rendering all logos. */
  @Event() wtpRenderComplete: EventEmitter<{ dataUrl: string }>;
  /** Fires when a rendering error occurs. */
  @Event() wtpRenderError: EventEmitter<{ message: string }>;

  @State() layers: RenderedLayer[] = [];
  @State() containerWidth: number = 0;
  @State() containerHeight: number = 0;

  private productImg: HTMLImageElement | undefined;

  componentWillLoad() {
    this.computeLayout();
  }

  @Watch('productImage')
  onProductImageChange() {
    this.computeLayout();
  }

  @Watch('logos')
  onLogosChange() {
    this.computeLayout();
  }

  @Watch('printArea')
  onPrintAreaChange() {
    this.computeLayout();
  }

  @Watch('width')
  @Watch('height')
  onSizeChange() {
    this.computeLayout();
  }

  @Watch('backgroundColor')
  onBackgroundColorChange() {
    // Background color is applied via inline style in render(), so Stencil
    // re-renders automatically. We still need to re-emit the export data URL.
    this.emitRenderComplete();
  }

  /** Export the rendered scene as a data URL image. */
  @Method()
  async exportImage(format: 'png' | 'jpeg' = 'png', quality: number = 1): Promise<string> {
    const w = this.containerWidth || this.width;
    const h = this.containerHeight || this.height;

    const exportLayers: RenderLayer[] = this.layers.map(l => ({
      img: l.exportImg,
      naturalWidth: l.naturalWidth,
      naturalHeight: l.naturalHeight,
      left: l.left,
      top: l.top,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
      angle: l.angle,
      skewX: l.skewX,
      skewY: l.skewY,
    }));

    return renderToCanvas(w, h, this.backgroundColor, this.productImg, exportLayers, format, quality);
  }

  private async computeLayout() {
    try {
      let cw = this.width;
      let ch = this.height;

      // Load product image and compute contain-fit dimensions
      if (this.productImage !== undefined && this.productImage !== '') {
        const img = await loadImage(this.productImage);
        this.productImg = img;
        const { fittedW, fittedH } = computeContainFit(this.width, this.height, img.naturalWidth, img.naturalHeight);
        cw = fittedW;
        ch = fittedH;
      } else {
        this.productImg = undefined;
      }

      this.containerWidth = cw;
      this.containerHeight = ch;

      const newLayers: RenderedLayer[] = [];

      for (const logo of this.logos) {
        const displayUrl = logo.previewDataUrl ?? logo.dataUrl;

        if (logo.transform !== undefined) {
          // Explicit transform path
          const exportImg = await loadImage(logo.dataUrl);
          const nw = exportImg.naturalWidth;
          const nh = exportImg.naturalHeight;
          const { left, top } = centerOriginToTopLeft(logo.transform, nw, nh);

          newLayers.push({
            id: logo.id,
            src: displayUrl,
            exportImg,
            naturalWidth: nw,
            naturalHeight: nh,
            left,
            top,
            scaleX: logo.transform.scaleX,
            scaleY: logo.transform.scaleY,
            angle: logo.transform.angle,
            skewX: logo.transform.skewX ?? 0,
            skewY: logo.transform.skewY ?? 0,
          });
        } else if (this.printArea !== undefined) {
          // Auto-fit path: determine logo dimensions, fit into print area
          const hasBulge = this.printArea.bulge !== undefined && this.printArea.bulge !== 0;
          let logoW: number;
          let logoH: number;
          let displaySrc = displayUrl;

          if (hasBulge) {
            // Bulge path: upscale SVG first (rasters pass through unchanged), then
            // compute fit from actual pixel dimensions — matches the old Fabric.js flow
            // where FabricImage.fromURL loaded the upscaled image before fitLogoToPrintArea.
            const rendererMaxSize = Math.round(Math.max(cw, ch) * 2);
            const { dataUrl: processedUrl } = upscaleSvgDataUrl(logo.dataUrl, rendererMaxSize);
            const warpSrc = await loadImage(processedUrl);
            logoW = warpSrc.naturalWidth;
            logoH = warpSrc.naturalHeight;

            const transform = fitLogoToPrintArea(logoW, logoH, this.printArea, cw, ch);

            const [tl, tr, br, bl] = printAreaToPixelCorners(this.printArea, cw, ch);
            const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
            const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
            const avgHeight = (leftH + rightH) / 2;

            const warped = warpImageForBulge(warpSrc, this.printArea.bulge!, avgHeight, transform.scaleX);
            displaySrc = warped.toDataURL('image/png');

            // Warped canvas may be taller due to displacement padding
            logoW = warped.width;
            logoH = warped.height;

            const exportImg = await loadImage(displaySrc);
            const { left, top } = centerOriginToTopLeft(transform, logoW, logoH);

            newLayers.push({
              id: logo.id,
              src: displaySrc,
              exportImg,
              naturalWidth: logoW,
              naturalHeight: logoH,
              left,
              top,
              scaleX: transform.scaleX,
              scaleY: transform.scaleY,
              angle: transform.angle,
              skewX: 0,
              skewY: 0,
            });
          } else {
            // No bulge: use intrinsic SVG dimensions (vector quality in <img>)
            // or raster naturalWidth/Height
            const svgSize = getSvgIntrinsicSize(logo.dataUrl);
            if (svgSize !== null) {
              logoW = svgSize.width;
              logoH = svgSize.height;
            } else {
              const tempImg = await loadImage(logo.dataUrl);
              logoW = tempImg.naturalWidth;
              logoH = tempImg.naturalHeight;
            }

            const transform = fitLogoToPrintArea(logoW, logoH, this.printArea, cw, ch);

            const exportImg = await loadImage(displaySrc);
            const { left, top } = centerOriginToTopLeft(transform, logoW, logoH);

            newLayers.push({
              id: logo.id,
              src: displaySrc,
              exportImg,
              naturalWidth: logoW,
              naturalHeight: logoH,
              left,
              top,
              scaleX: transform.scaleX,
              scaleY: transform.scaleY,
              angle: transform.angle,
              skewX: 0,
              skewY: 0,
            });
          }
        }
      }

      this.layers = newLayers;
      this.emitRenderComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown render error';
      this.wtpRenderError.emit({ message });
    }
  }

  private async emitRenderComplete() {
    try {
      const dataUrl = await this.exportImage('png');
      this.wtpRenderComplete.emit({ dataUrl });
    } catch {
      // Export may fail if called before layout is ready; ignore silently
    }
  }

  render() {
    const renderW = this.containerWidth || this.width;
    const renderH = this.containerHeight || this.height;

    return (
      <div
        class="wtp-logo-renderer"
        style={{
          width: `${renderW}px`,
          height: `${renderH}px`,
          backgroundColor: this.backgroundColor,
        }}
      >
        {this.productImage !== undefined && this.productImage !== '' && (
          <img class="product-bg" src={this.productImage} alt="" />
        )}
        {this.layers.map(layer => (
          <img
            key={layer.id}
            class="logo-layer"
            src={layer.src}
            alt=""
            style={{
              position: 'absolute',
              left: `${layer.left}px`,
              top: `${layer.top}px`,
              width: `${layer.naturalWidth}px`,
              height: `${layer.naturalHeight}px`,
              transformOrigin: 'center',
              transform: `rotate(${layer.angle}deg) skewX(${layer.skewX}deg) skewY(${layer.skewY}deg) scale(${layer.scaleX}, ${layer.scaleY})`,
            }}
          />
        ))}
      </div>
    );
  }
}
