import { Component, h, Prop, State, Method, Event, EventEmitter, Watch, Element } from '@stencil/core';
import { Canvas, FabricObject, FabricImage, IText } from 'fabric';
import { PlacedLogo, PlacedText, EditorState, LogoData, CanvasTransform, PrintArea } from '../../types';
import { setCanvasBackground, generateObjectId, upscaleSvgDataUrl, fitLogoToPrintArea, printAreaToPixelCorners } from '../../utils/canvas-helpers';

@Component({
  tag: 'wtp-editor',
  styleUrl: 'wtp-editor.scss',
  scoped: true,
})
export class WtpEditor {
  @Element() el: HTMLElement;

  /** Canvas width in pixels. */
  @Prop() width: number = 800;
  /** Canvas height in pixels. */
  @Prop() height: number = 600;
  /** Product background image URL. */
  @Prop() productImage: string | undefined;
  /** JSON-serialized initial editor state. */
  @Prop() initialState: string | undefined;
  /** Available font families for the text tool. */
  @Prop() fonts: string[] = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana'];
  /** Print area definition (0-1 relative coordinates) to constrain objects. */
  @Prop() printArea: PrintArea | undefined;

  @State() selectedObjectId: string | null = null;
  @State() selectedObjectType: string | null = null;
  @State() selectedFont: string = 'Arial';
  @State() selectedTextColor: string = '#000000';

  /** Fires when the canvas is initialized and ready. */
  @Event() wtpEditorReady: EventEmitter<void>;
  /** Fires when the editor state changes (object add/move/remove). */
  @Event() wtpEditorStateChanged: EventEmitter<EditorState>;
  /** Fires when an object is selected on the canvas. */
  @Event() wtpEditorObjectSelected: EventEmitter<{ id: string; type: string }>;
  /** Fires when the current selection is cleared. */
  @Event() wtpEditorObjectDeselected: EventEmitter<void>;

  private canvas: Canvas | undefined;
  private canvasEl: HTMLCanvasElement | undefined;
  private objectMap: Map<string, FabricObject> = new Map();
  private previewUrlMap: Map<string, string> = new Map();
  /** Resolves when the current background image has been loaded and the canvas resized. */
  private backgroundReady: Promise<void> = Promise.resolve();

  componentDidLoad() {
    this.initCanvas();
  }

  disconnectedCallback() {
    this.canvas?.dispose();
  }

  @Watch('productImage')
  onProductImageChange() {
    if (this.canvas !== undefined && this.productImage !== undefined) {
      // Reset to bounding box before setCanvasBackground auto-sizes
      this.canvas.setDimensions({ width: this.width, height: this.height });
      this.backgroundReady = setCanvasBackground(this.canvas, this.productImage);
    }
  }

  @Watch('width')
  @Watch('height')
  onSizeChange() {
    if (this.canvas !== undefined) {
      this.canvas.setDimensions({ width: this.width, height: this.height });
      if (this.productImage !== undefined && this.productImage !== '') {
        this.backgroundReady = setCanvasBackground(this.canvas, this.productImage);
      }
      this.canvas.renderAll();
    }
  }

  @Watch('printArea')
  async onPrintAreaChange() {
    // Wait for background to finish loading so canvas dimensions are final
    await this.backgroundReady;
    // Re-constrain existing user objects to the new bounds
    if (this.canvas !== undefined) {
      for (const obj of this.objectMap.values()) {
        this.clampObjectToPrintArea(obj);
      }
      this.canvas.renderAll();
    }
  }

  /** Add a logo image to the canvas and return its object ID. */
  @Method()
  async addLogo(logoData: LogoData): Promise<string> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    // Wait for background image to load so canvas dimensions are final
    await this.backgroundReady;

    const id = generateObjectId();
    const { dataUrl } = upscaleSvgDataUrl(logoData.dataUrl);
    const img = await FabricImage.fromURL(dataUrl);
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();

    if (this.printArea !== undefined) {
      // Fit logo into the print area (matching renderer behavior):
      // 0-1 coords map to bounding box, then offset to actual canvas coords
      const offset = this.getContainOffset();
      const transform = fitLogoToPrintArea(img.width ?? 100, img.height ?? 100, this.printArea, this.width, this.height);
      img.set({
        left: transform.x - offset.x,
        top: transform.y - offset.y,
        originX: 'center',
        originY: 'center',
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        angle: transform.angle,
      });
    } else {
      // Scale logo to fit within 30% of canvas
      const maxScale = Math.min(
        (canvasWidth * 0.3) / (img.width ?? 100),
        (canvasHeight * 0.3) / (img.height ?? 100),
      );
      const scale = Math.min(maxScale, 1);
      img.set({
        left: canvasWidth / 2,
        top: canvasHeight / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
      });
    }

    (img as FabricObject & { _objectId?: string })._objectId = id;
    this.objectMap.set(id, img);
    if (logoData.previewDataUrl !== undefined) {
      this.previewUrlMap.set(id, logoData.previewDataUrl);
    }

    this.canvas.add(img);
    this.canvas.setActiveObject(img);
    this.canvas.renderAll();
    this.emitStateChanged();

    return id;
  }

  /** Add a text object to the canvas and return its object ID. */
  @Method()
  async addText(text: string, options?: { fontFamily?: string; fontSize?: number; fill?: string }): Promise<string> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    // Wait for background image to load so canvas dimensions are final
    await this.backgroundReady;

    const id = generateObjectId();
    let centerX = this.canvas.getWidth() / 2;
    let centerY = this.canvas.getHeight() / 2;

    if (this.printArea !== undefined) {
      const offset = this.getContainOffset();
      const corners = printAreaToPixelCorners(this.printArea, this.width, this.height);
      centerX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4 - offset.x;
      centerY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4 - offset.y;
    }

    const iText = new IText(text, {
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      fontFamily: options?.fontFamily ?? this.selectedFont,
      fontSize: options?.fontSize ?? 24,
      fill: options?.fill ?? '#000000',
    });

    (iText as FabricObject & { _objectId?: string })._objectId = id;
    this.objectMap.set(id, iText);

    this.canvas.add(iText);
    this.canvas.setActiveObject(iText);
    this.canvas.renderAll();
    this.emitStateChanged();

    return id;
  }

  /** Remove an object from the canvas by its ID. */
  @Method()
  async removeObject(id: string): Promise<void> {
    if (this.canvas === undefined) return;
    const obj = this.objectMap.get(id);
    if (obj !== undefined) {
      this.canvas.remove(obj);
      this.objectMap.delete(id);
      this.canvas.renderAll();
      this.emitStateChanged();
    }
  }

  /** Export the current editor state as a serializable object. */
  @Method()
  async exportState(): Promise<EditorState> {
    return this.buildEditorState();
  }

  /** Load a previously exported editor state. */
  @Method()
  async loadState(state: EditorState): Promise<void> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    // Clear canvas
    this.canvas.clear();
    this.objectMap.clear();
    this.previewUrlMap.clear();

    // Rebuild preview URL map from state
    for (const logo of state.logos) {
      if (logo.previewDataUrl !== undefined) {
        this.previewUrlMap.set(logo.id, logo.previewDataUrl);
      }
    }

    this.canvas.setDimensions({ width: state.width, height: state.height });

    // Restore from fabricJson first (loadFromJSON clears the canvas)
    if (state.fabricJson !== undefined && state.fabricJson !== '') {
      await this.canvas.loadFromJSON(state.fabricJson);
      // Rebuild object map from loaded objects
      for (const obj of this.canvas.getObjects()) {
        const id = (obj as FabricObject & { _objectId?: string })._objectId;
        if (id !== undefined && id !== '') {
          this.objectMap.set(id, obj);
        }
      }
    }

    // Restore product image after JSON load so it inserts at index 0
    if (state.productImage !== null && state.productImage !== undefined && state.productImage !== '') {
      this.backgroundReady = setCanvasBackground(this.canvas, state.productImage);
      await this.backgroundReady;
    }

    this.canvas.renderAll();
  }

  /** Clear all user objects from the canvas, keeping the instance alive. */
  @Method()
  async resetCanvas(): Promise<void> {
    if (this.canvas === undefined) return;
    this.canvas.discardActiveObject();
    for (const obj of this.canvas.getObjects().slice()) {
      this.canvas.remove(obj);
    }
    this.objectMap.clear();
    this.previewUrlMap.clear();
    this.selectedObjectId = null;
    this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    this.canvas.setDimensions({ width: this.width, height: this.height });
    this.canvas.backgroundColor = '#ffffff';
    this.canvas.requestRenderAll();
  }

  /** Export the canvas as a data URL image. */
  @Method()
  async exportImage(format: 'png' | 'jpeg' = 'png', quality: number = 1): Promise<string> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');
    return this.canvas.toDataURL({ multiplier: 1, format, quality });
  }

  /** Get a list of all objects on the canvas with their IDs and types. */
  @Method()
  async getObjects(): Promise<{ id: string; type: string }[]> {
    const result: { id: string; type: string }[] = [];
    for (const [id, obj] of this.objectMap) {
      result.push({ id, type: obj.type ?? 'unknown' });
    }
    return result;
  }

  /** Update the text content of a text object by its ID. */
  @Method()
  async updateText(id: string, text: string): Promise<void> {
    if (this.canvas === undefined) return;
    const obj = this.objectMap.get(id);
    if (obj !== undefined && obj.type === 'i-text') {
      (obj as IText).set('text', text);
      this.canvas.renderAll();
      this.emitStateChanged();
    }
  }

  private initCanvas() {
    if (this.canvasEl === undefined) return;

    this.canvas = new Canvas(this.canvasEl, {
      width: this.width,
      height: this.height,
      backgroundColor: '#ffffff',
    });

    this.canvas.on('selection:created', e => {
      this.handleSelection(e.selected?.[0]);
    });

    this.canvas.on('selection:updated', e => {
      this.handleSelection(e.selected?.[0]);
    });

    this.canvas.on('selection:cleared', () => {
      this.selectedObjectId = null;
      this.selectedObjectType = null;
      this.wtpEditorObjectDeselected.emit();
    });

    this.canvas.on('object:modified', () => {
      this.emitStateChanged();
    });

    this.canvas.on('text:changed', () => {
      this.emitStateChanged();
    });

    this.canvas.on('object:moving', e => {
      if (e.target !== undefined) this.clampObjectToPrintArea(e.target);
    });

    this.canvas.on('object:scaling', e => {
      if (e.target !== undefined) this.clampObjectToPrintArea(e.target);
    });

    // Load initial state if provided
    if (this.initialState !== undefined && this.initialState !== '') {
      try {
        const state = JSON.parse(this.initialState) as EditorState;
        this.loadState(state);
      } catch {
        // Invalid JSON, ignore
      }
    } else if (this.productImage !== undefined && this.productImage !== '') {
      this.backgroundReady = setCanvasBackground(this.canvas, this.productImage);
    }

    this.wtpEditorReady.emit();
  }

  /**
   * Compute the centering offset between the bounding box (this.width/height)
   * and the actual canvas dimensions after contain-fit.
   * Print area 0-1 coords are defined relative to the bounding box, so we need
   * this offset to translate them to canvas pixel coordinates.
   */
  private getContainOffset(): { x: number; y: number } {
    if (this.canvas === undefined) return { x: 0, y: 0 };
    return {
      x: (this.width - this.canvas.getWidth()) / 2,
      y: (this.height - this.canvas.getHeight()) / 2,
    };
  }

  private getPrintAreaBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (this.printArea === undefined || this.canvas === undefined) return null;
    // Map 0-1 coords to bounding box pixels, then offset to canvas pixels
    const offset = this.getContainOffset();
    const corners = printAreaToPixelCorners(this.printArea, this.width, this.height);
    const xs = corners.map(c => c.x - offset.x);
    const ys = corners.map(c => c.y - offset.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  private clampObjectToPrintArea(obj: FabricObject) {
    const bounds = this.getPrintAreaBounds();
    if (bounds === null) return;

    // Skip background objects
    if ((obj as FabricObject & { _isBackground?: boolean })._isBackground === true) return;

    // Ensure coordinates reflect the current transform state
    obj.setCoords();
    let rect = obj.getBoundingRect();

    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;

    // Cap scale if the object's bounding rect exceeds the print area
    if (rect.width > boundsWidth || rect.height > boundsHeight) {
      const scaleRatio = Math.min(boundsWidth / rect.width, boundsHeight / rect.height);
      obj.set({
        scaleX: (obj.scaleX ?? 1) * scaleRatio,
        scaleY: (obj.scaleY ?? 1) * scaleRatio,
      });
      obj.setCoords();
      rect = obj.getBoundingRect();
    }

    // Clamp position so the bounding rect stays within bounds
    let dx = 0;
    let dy = 0;

    if (rect.left < bounds.minX) dx = bounds.minX - rect.left;
    else if (rect.left + rect.width > bounds.maxX) dx = bounds.maxX - (rect.left + rect.width);

    if (rect.top < bounds.minY) dy = bounds.minY - rect.top;
    else if (rect.top + rect.height > bounds.maxY) dy = bounds.maxY - (rect.top + rect.height);

    if (dx !== 0 || dy !== 0) {
      obj.set({
        left: (obj.left ?? 0) + dx,
        top: (obj.top ?? 0) + dy,
      });
      obj.setCoords();
    }
  }

  private handleSelection(obj: FabricObject | undefined) {
    if (obj === undefined) return;
    const id = (obj as FabricObject & { _objectId?: string })._objectId;
    if (id !== undefined && id !== '') {
      this.selectedObjectId = id;
      this.selectedObjectType = obj.type ?? null;
      if (obj.type === 'i-text') {
        const textObj = obj as IText;
        this.selectedFont = textObj.fontFamily ?? 'Arial';
        this.selectedTextColor = (textObj.fill as string) ?? '#000000';
      }
      this.wtpEditorObjectSelected.emit({ id, type: obj.type ?? 'unknown' });
    }
  }

  private getObjectTransform(obj: FabricObject): CanvasTransform {
    return {
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
      angle: obj.angle ?? 0,
    };
  }

  private buildEditorState(): EditorState {
    const logos: PlacedLogo[] = [];
    const texts: PlacedText[] = [];

    for (const [id, obj] of this.objectMap) {
      if (obj.type === 'image') {
        const previewDataUrl = this.previewUrlMap.get(id);
        logos.push({
          id,
          dataUrl: (obj as FabricImage).getSrc(),
          ...(previewDataUrl !== undefined ? { previewDataUrl } : {}),
          transform: this.getObjectTransform(obj),
        });
      } else if (obj.type === 'i-text') {
        const textObj = obj as IText;
        texts.push({
          id,
          text: textObj.text ?? '',
          fontFamily: textObj.fontFamily ?? 'Arial',
          fontSize: textObj.fontSize ?? 24,
          fill: (textObj.fill as string) ?? '#000000',
          transform: this.getObjectTransform(obj),
        });
      }
    }

    return {
      fabricJson: this.canvas !== undefined ? JSON.stringify(this.canvas.toJSON()) : '',
      logos,
      texts,
      productImage: this.productImage ?? null,
      width: this.width,
      height: this.height,
    };
  }

  private emitStateChanged() {
    this.wtpEditorStateChanged.emit(this.buildEditorState());
  }

  private handleAddText = () => {
    this.addText('New Text', { fontFamily: this.selectedFont });
  };

  private handleFontChange = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    this.selectedFont = select.value;

    // Update selected text object's font
    if (this.canvas !== undefined && this.selectedObjectId !== null) {
      const obj = this.objectMap.get(this.selectedObjectId);
      if (obj !== undefined && obj.type === 'i-text') {
        (obj as IText).set('fontFamily', this.selectedFont);
        this.canvas.renderAll();
        this.emitStateChanged();
      }
    }
  };

  private handleColorChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.selectedTextColor = input.value;

    if (this.canvas !== undefined && this.selectedObjectId !== null) {
      const obj = this.objectMap.get(this.selectedObjectId);
      if (obj !== undefined && obj.type === 'i-text') {
        (obj as IText).set('fill', this.selectedTextColor);
        this.canvas.renderAll();
        this.emitStateChanged();
      }
    }
  };

  private handleDeleteSelected = () => {
    if (this.selectedObjectId !== null) {
      this.removeObject(this.selectedObjectId);
      this.selectedObjectId = null;
    }
  };

  private handleExport = async () => {
    const dataUrl = await this.exportImage();
    const link = document.createElement('a');
    link.download = 'export.png';
    link.href = dataUrl;
    link.click();
  };

  render() {
    return (
      <div class="wtp-editor">
        <div class="toolbar">
          <button class="toolbar-btn" onClick={this.handleAddText} title="Add text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            <span>Add Text</span>
          </button>

          <div class="toolbar-separator" />

          <select class="font-select" onChange={this.handleFontChange} title="Font family">
            {this.fonts.map(font => (
              <option value={font} style={{ fontFamily: font }}>{font}</option>
            ))}
          </select>

          {this.selectedObjectType === 'i-text' && (
            <input class="color-input" type="color" value={this.selectedTextColor} onInput={this.handleColorChange} title="Text color" />
          )}

          <div class="toolbar-separator" />

          <button
            class="toolbar-btn danger"
            onClick={this.handleDeleteSelected}
            disabled={this.selectedObjectId === null}
            title="Delete selected"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Delete</span>
          </button>

          <div class="toolbar-spacer" />

          <button class="toolbar-btn" onClick={this.handleExport} title="Export image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export</span>
          </button>
        </div>

        <div class="canvas-container">
          <canvas ref={el => (this.canvasEl = el)} />
        </div>
      </div>
    );
  }
}
