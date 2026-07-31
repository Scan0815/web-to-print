import { Component, h, Prop, State, Method, Event, EventEmitter, Watch, Element } from '@stencil/core';
import { Canvas, FabricObject, FabricImage, IText } from 'fabric';
import {
  PlacedLogo,
  PlacedText,
  EditorState,
  LogoData,
  CanvasTransform,
  PrintArea,
  EditorLabels,
  DEFAULT_EDITOR_LABELS,
  ArticleView,
  ArticleEditorState,
  DecorationState,
  LogoValidationIssue,
  Article,
} from '../../types';
import { setCanvasBackground, generateObjectId, upscaleSvgDataUrl, fitLogoToPrintArea, printAreaToPixelCorners } from '../../utils/canvas-helpers';
import { resolveViewPrintArea } from '../../utils/print-area';
import { validateDecoration, type ObjectBounds } from '../../utils/decoration-validation';
import { exportArticlePdf, selectPrintableDecorations, type PdfExportConfig } from '../../utils/pdf-export';

/** Id of the implicit view used when the host supplies productImage/printArea instead of views. */
const LEGACY_VIEW_ID = 'default';

/** Longest side of a decoration thumbnail in pixels. */
const PREVIEW_SIZE = 120;

@Component({
  tag: 'wtp-editor',
  styleUrl: 'wtp-editor.scss',
  scoped: true,
})
export class WtpEditor {
  @Element() el: HTMLWtpEditorElement;

  /** Canvas width in pixels. */
  @Prop() width: number = 800;
  /** Canvas height in pixels. */
  @Prop() height: number = 600;
  /** Decoration options (Veredelungen) of the article. Each view needs a stable `id`. */
  @Prop() views: ArticleView[] = [];
  /** Article id written into the exported envelope. */
  @Prop() articleId: string = '';
  /** Id of the decoration currently being edited. Defaults to the `isDefault` view, else the first. */
  @Prop({ mutable: true }) activeViewId: string | undefined;
  /**
   * Product background image URL.
   * @deprecated Single-decoration fallback used only when `views` is empty.
   */
  @Prop() productImage: string | undefined;
  /** JSON-serialized initial editor state. */
  @Prop() initialState: string | undefined;
  /** Available font families for the text tool. */
  @Prop() fonts: string[] = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana'];
  /**
   * Print area definition (0-1 relative coordinates) to constrain objects.
   * @deprecated Single-decoration fallback used only when `views` is empty.
   */
  @Prop() printArea: PrintArea | undefined;
  /** Show the built-in decoration strip. Turn off to build your own switcher around `activeViewId`. */
  @Prop() showViewStrip: boolean = true;
  /** Show print area overlay and bounding box for debugging. */
  @Prop() debug: boolean = false;
  /** Override any of the user-facing toolbar strings. Missing keys fall back to English defaults. */
  @Prop() labels: Partial<EditorLabels> = {};

  private getLabels(): EditorLabels {
    return { ...DEFAULT_EDITOR_LABELS, ...this.labels };
  }

  @State() selectedObjectId: string | null = null;
  @State() selectedObjectType: string | null = null;
  @State() selectedFont: string = 'Arial';
  @State() selectedTextColor: string = '#000000';
  @State() currentViewId: string = LEGACY_VIEW_ID;
  /** Thumbnails per view id, refreshed when a view is left. */
  @State() viewPreviews: Record<string, string> = {};

  /** Fires when the canvas is initialized and ready. */
  @Event() wtpEditorReady: EventEmitter<void>;
  /** Fires when the editor state changes (object add/move/remove). */
  @Event() wtpEditorStateChanged: EventEmitter<ArticleEditorState>;
  /** Fires when the edited decoration changes. */
  @Event() wtpEditorViewChanged: EventEmitter<{ viewId: string; index: number }>;
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
  /** Canvas state of every view that has been left at least once. */
  private viewStates: Map<string, EditorState> = new Map();
  /** Print areas normalized to 0-1, keyed by view id. */
  private resolvedPrintAreas: Map<string, PrintArea | null> = new Map();
  /** Validation findings of every view, refreshed whenever a view is flushed. */
  private viewIssues: Map<string, LogoValidationIssue[]> = new Map();
  /** Source data of every placed logo, so it can be copied to other decorations. */
  private placedLogoData: Map<string, LogoData> = new Map();

  componentWillLoad() {
    const views = this.getViews();
    this.assertValidViews(views);
    this.currentViewId = this.resolveInitialViewId(views);
  }

  private assertValidViews(views: ArticleView[]): void {
    for (const view of views) {
      if (view.id === undefined || view.id === '') {
        throw new Error('wtp-editor: every entry in `views` needs a stable `id`.');
      }
    }
    const ids = new Set(views.map(v => v.id));
    if (ids.size !== views.length) {
      throw new Error('wtp-editor: `views` contains duplicate ids.');
    }
  }

  componentDidLoad() {
    this.initCanvas();
  }

  private resolveInitialViewId(views: ArticleView[]): string {
    if (this.activeViewId !== undefined && views.some(v => v.id === this.activeViewId)) return this.activeViewId;
    return views.find(v => v.isDefault === true)?.id ?? views[0].id;
  }

  /** The article's decorations, or a single implicit view for the deprecated single-decoration props. */
  private getViews(): ArticleView[] {
    if (this.views.length > 0) return this.views;
    return [
      {
        id: LEGACY_VIEW_ID,
        image: this.productImage ?? '',
        label: 'Default',
        printArea: this.printArea ?? null,
      },
    ];
  }

  private getActiveView(): ArticleView {
    const views = this.getViews();
    return views.find(v => v.id === this.currentViewId) ?? views[0];
  }

  /** Print area of the active view, normalized to 0-1 where possible. */
  private getActivePrintArea(): PrintArea | undefined {
    const view = this.getActiveView();
    const resolved = this.resolvedPrintAreas.get(view.id);
    return (resolved ?? view.printArea) ?? undefined;
  }

  private getActiveImage(): string {
    return this.getActiveView().image;
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
      const image = this.getActiveImage();
      if (image !== '') {
        this.backgroundReady = setCanvasBackground(this.canvas, image);
      }
      this.canvas.renderAll();
    }
  }

  @Watch('debug')
  onDebugChange() {
    this.canvas?.renderAll();
  }

  @Watch('activeViewId')
  onActiveViewIdChange(next: string | undefined) {
    if (next === undefined || next === this.currentViewId) return;
    if (!this.getViews().some(v => v.id === next)) return;
    void this.setActiveView(next);
  }

  @Watch('views')
  onViewsChange() {
    const views = this.getViews();
    this.assertValidViews(views);

    // A new set of decorations means a different article: drop the old per-view state
    // and open the new default decoration.
    if (!views.some(v => v.id === this.currentViewId)) {
      this.viewStates.clear();
      this.viewIssues.clear();
      this.viewPreviews = {};
      this.currentViewId = this.resolveInitialViewId(views);
      this.activeViewId = this.currentViewId;
      void this.activateView(this.getActiveView());
    }

    void this.resolvePrintAreas();
  }

  /** Normalizes every view's print area to 0-1, loading images only when needed. */
  private async resolvePrintAreas(): Promise<void> {
    await Promise.all(
      this.getViews().map(async view => {
        const resolved = await resolveViewPrintArea(view);
        this.resolvedPrintAreas.set(view.id, resolved);
      }),
    );
    this.canvas?.renderAll();
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

    const activePrintArea = this.getActivePrintArea();
    if (activePrintArea !== undefined) {
      // Fit logo into the print area: 0-1 coords map directly to canvas pixels
      const transform = fitLogoToPrintArea(img.width ?? 100, img.height ?? 100, activePrintArea, canvasWidth, canvasHeight);
      img.set({
        left: transform.x,
        top: transform.y,
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
    this.placedLogoData.set(id, logoData);
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

    const textPrintArea = this.getActivePrintArea();
    if (textPrintArea !== undefined) {
      const corners = printAreaToPixelCorners(textPrintArea, this.canvas.getWidth(), this.canvas.getHeight());
      centerX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
      centerY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
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

  /** Export the state of every decoration as a versioned envelope. */
  @Method()
  async exportState(): Promise<ArticleEditorState> {
    return this.buildArticleState();
  }

  /** Switch to another decoration, storing the current one first. */
  @Method()
  async setActiveView(viewId: string): Promise<void> {
    const views = this.getViews();
    const target = views.find(v => v.id === viewId);
    if (target === undefined) throw new Error(`wtp-editor: unknown view id "${viewId}".`);
    if (target.id === this.currentViewId) return;

    this.flushActiveView();

    this.currentViewId = target.id;
    this.activeViewId = target.id;
    this.selectedObjectId = null;
    this.selectedObjectType = null;

    await this.activateView(target);

    this.wtpEditorViewChanged.emit({ viewId: target.id, index: views.indexOf(target) });
  }

  /**
   * Places the given logo on every decoration that is still empty, fitted to that
   * decoration's own print area. Decorations that already carry a design are left alone.
   * Returns the ids of the views that received the logo.
   */
  @Method()
  async applyLogoToAllViews(logoId: string): Promise<string[]> {
    const source = this.placedLogoData.get(logoId);
    if (source === undefined) throw new Error(`wtp-editor: unknown logo id "${logoId}".`);

    const originalViewId = this.currentViewId;
    const applied: string[] = [];

    for (const view of this.getViews()) {
      if (view.id === originalViewId) continue;

      const stored = this.viewStates.get(view.id);
      const isEmpty = stored === undefined || (stored.logos.length === 0 && stored.texts.length === 0);
      if (!isEmpty) continue;

      await this.setActiveView(view.id);
      await this.addLogo(source);
      applied.push(view.id);
    }

    if (this.currentViewId !== originalViewId) {
      await this.setActiveView(originalViewId);
    }

    return applied;
  }

  /**
   * Renders a high-resolution mockup per decoration, keyed by view id — the input the
   * PDF export needs. Only the editor can produce these, because each decoration has to
   * be put on the canvas first. The originally active decoration is restored afterwards.
   */
  @Method()
  async renderMockups(viewIds?: string[], multiplier: number = 3): Promise<Record<string, { dataUrl: string; width: number; height: number }>> {
    const originalViewId = this.currentViewId;
    const targets = this.getViews().filter(v => viewIds === undefined || viewIds.includes(v.id));
    const mockups: Record<string, { dataUrl: string; width: number; height: number }> = {};

    for (const view of targets) {
      if (view.id !== this.currentViewId) await this.setActiveView(view.id);
      mockups[view.id] = await this.exportImageHighRes('png', 1, multiplier);
    }

    if (this.currentViewId !== originalViewId) await this.setActiveView(originalViewId);

    return mockups;
  }

  /**
   * Renders the proof PDF for every designed decoration and triggers the download.
   *
   * Hosts can also call `exportArticlePdf` themselves — but importing the library's ESM
   * bundle into a page that already loaded the components pulls in a second Stencil
   * runtime, so going through the component is the safer route.
   * Requires jsPDF to be loaded globally.
   */
  @Method()
  async exportPdf(article: Article, config?: Partial<PdfExportConfig>): Promise<void> {
    const state = await this.exportState();
    const viewIds = selectPrintableDecorations(state, config?.viewIds).map(d => d.viewId);
    if (viewIds.length === 0) throw new Error('wtp-editor: no designed decoration to export.');

    const mockups = await this.renderMockups(viewIds);
    await exportArticlePdf(state, article, mockups, config);
  }

  /** Load a previously exported state — the v2 envelope or a legacy single-view state. */
  @Method()
  async loadState(state: ArticleEditorState | EditorState): Promise<void> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    if (this.isArticleState(state)) {
      this.viewStates.clear();
      for (const decoration of state.decorations) {
        this.viewStates.set(decoration.viewId, decoration.state);
      }
      await this.activateView(this.getActiveView());
      return;
    }

    // Legacy v1 state belongs to the default view.
    this.viewStates.clear();
    this.viewStates.set(this.getActiveView().id, state);
    await this.loadEditorState(state);
  }

  private isArticleState(state: ArticleEditorState | EditorState): state is ArticleEditorState {
    return (state as ArticleEditorState).version === 2 && Array.isArray((state as ArticleEditorState).decorations);
  }

  /** Restore a single view's canvas state, or start it empty. */
  private async activateView(view: ArticleView): Promise<void> {
    if (this.canvas === undefined) return;

    const stored = this.viewStates.get(view.id);
    if (stored !== undefined) {
      await this.loadEditorState(stored);
      return;
    }

    this.canvas.clear();
    this.objectMap.clear();
    this.previewUrlMap.clear();
    this.canvas.setDimensions({ width: this.width, height: this.height });
    this.canvas.backgroundColor = '#ffffff';

    if (view.image !== '') {
      this.backgroundReady = setCanvasBackground(this.canvas, view.image);
      await this.backgroundReady;
    }
    this.canvas.renderAll();
  }

  /** Store the canvas state of the currently edited view, plus a fresh thumbnail. */
  private flushActiveView(): void {
    if (this.canvas === undefined) return;
    const state = this.buildEditorState();
    this.viewStates.set(this.currentViewId, state);
    this.viewIssues.set(this.currentViewId, this.validateActiveView(state));
    this.capturePreview(this.currentViewId);
  }

  /**
   * Runs the per-decoration checks for the view on the canvas right now. Bounds come
   * from Fabric, so this only works while the view is active — which is why the result
   * is cached per view.
   */
  private validateActiveView(state: EditorState): LogoValidationIssue[] {
    if (this.canvas === undefined) return [];

    const bounds: ObjectBounds[] = [];
    for (const obj of this.objectMap.values()) {
      const rect = obj.getBoundingRect();
      bounds.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }

    return validateDecoration({
      view: this.getActiveView(),
      state,
      bounds,
      printArea: this.getActivePrintArea() ?? null,
      canvasWidth: this.canvas.getWidth(),
      canvasHeight: this.canvas.getHeight(),
    });
  }

  /**
   * Renders a small thumbnail of the current canvas. Only called when a view is left
   * (and on export) — a full-size toDataURL on every object change is far too expensive
   * for 2400px product images.
   */
  private capturePreview(viewId: string): void {
    if (this.canvas === undefined) return;

    const width = this.canvas.getWidth();
    const height = this.canvas.getHeight();
    if (width <= 0 || height <= 0) return;

    const multiplier = PREVIEW_SIZE / Math.max(width, height);
    try {
      const dataUrl = this.canvas.toDataURL({ multiplier: Math.min(multiplier, 1), format: 'png', quality: 1 });
      this.viewPreviews = { ...this.viewPreviews, [viewId]: dataUrl };
    } catch {
      // Cross-origin product images taint the canvas; the strip falls back to a label.
    }
  }

  private handleViewSelect = (e: MouseEvent) => {
    const viewId = (e.currentTarget as HTMLElement).dataset.viewId;
    if (viewId !== undefined && viewId !== '') void this.setActiveView(viewId);
  };

  private async loadEditorState(state: EditorState): Promise<void> {
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
    try {
      return this.canvas.toDataURL({ multiplier: 1, format, quality });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'SecurityError') {
        throw new Error('Cannot export: product image is cross-origin. Use a CORS proxy or serve images from the same domain.');
      }
      throw e;
    }
  }

  /** Export the canvas as a high-resolution data URL image (for PDF/print).
   *  Returns the data URL plus the actual canvas dimensions (which may differ
   *  from the width/height props after setCanvasBackground resizes the canvas). */
  @Method()
  async exportImageHighRes(format: 'png' | 'jpeg' = 'png', quality: number = 1, multiplier: number = 3): Promise<{ dataUrl: string; width: number; height: number }> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    // Hide selection handles
    this.canvas.discardActiveObject();

    // Temporarily disable debug overlay during export
    const wasDebug = this.debug;
    this.debug = false;
    this.canvas.renderAll();

    let dataUrl: string;
    try {
      dataUrl = this.canvas.toDataURL({ multiplier, format, quality });
    } catch (e) {
      this.debug = wasDebug;
      this.canvas.renderAll();
      if (e instanceof DOMException && e.name === 'SecurityError') {
        throw new Error('Cannot export: product image is cross-origin. Use a CORS proxy or serve images from the same domain.');
      }
      throw e;
    }
    const width = this.canvas.getWidth();
    const height = this.canvas.getHeight();

    // Restore debug state
    this.debug = wasDebug;
    this.canvas.renderAll();

    return { dataUrl, width, height };
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

    this.canvas.on('after:render', () => this.drawDebugOverlay());

    // Normalize pixel print areas before anything is placed on the canvas
    void this.resolvePrintAreas();

    // Load initial state if provided
    if (this.initialState !== undefined && this.initialState !== '') {
      try {
        const state = JSON.parse(this.initialState) as ArticleEditorState | EditorState;
        this.loadState(state);
      } catch {
        // Invalid JSON, ignore
      }
    } else if (this.getActiveImage() !== '') {
      this.backgroundReady = setCanvasBackground(this.canvas, this.getActiveImage());
    }

    this.wtpEditorReady.emit();
  }


  /** Draw print area outline and bounding box on the canvas when debug mode is active. */
  private drawDebugOverlay() {
    const printArea = this.getActivePrintArea();
    if (!this.debug || this.canvas === undefined || printArea === undefined) return;

    const ctx = this.canvas.getContext() as CanvasRenderingContext2D;
    const corners = printAreaToPixelCorners(printArea, this.canvas.getWidth(), this.canvas.getHeight());

    ctx.save();

    // Draw the quad outline (actual print area shape)
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw corner dots
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw axis-aligned bounding box (used for clamping)
    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);

    // Corner labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#2563eb';
    const labels = ['TL', 'TR', 'BR', 'BL'];
    for (let i = 0; i < 4; i++) {
      ctx.fillText(labels[i], corners[i].x + 6, corners[i].y - 6);
    }

    ctx.restore();
  }

  /**
   * Get the print area's rotated frame: center, local axes, and dimensions
   * along those axes. This lets us clamp in the print area's own coordinate
   * system instead of using an axis-aligned bounding box.
   */
  private getPrintAreaFrame(): { cx: number; cy: number; halfW: number; halfH: number; cos: number; sin: number } | null {
    const printArea = this.getActivePrintArea();
    if (printArea === undefined || this.canvas === undefined) return null;
    const corners = printAreaToPixelCorners(printArea, this.canvas.getWidth(), this.canvas.getHeight());
    const [tl, tr, br, bl] = corners;

    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const botLen = Math.hypot(br.x - bl.x, br.y - bl.y);
    const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);

    const halfW = (topLen + botLen) / 4;
    const halfH = (leftLen + rightLen) / 4;

    // Angle from bottom edge (same as fitLogoToPrintArea)
    const angle = Math.atan2(br.y - bl.y, br.x - bl.x);
    return { cx, cy, halfW, halfH, cos: Math.cos(angle), sin: Math.sin(angle) };
  }

  private clampObjectToPrintArea(obj: FabricObject) {
    const frame = this.getPrintAreaFrame();
    if (frame === null) return;

    // Skip background objects
    if ((obj as FabricObject & { _isBackground?: boolean })._isBackground === true) return;

    const { cx, cy, halfW, halfH, cos, sin } = frame;

    // Use the actual visual size of the object (not getBoundingRect which includes control handles)
    const objW = (obj.width ?? 0) * (obj.scaleX ?? 1);
    const objH = (obj.height ?? 0) * (obj.scaleY ?? 1);

    // Relative angle between object and print area frame
    const objAngleRad = ((obj.angle ?? 0) * Math.PI) / 180;
    const frameAngle = Math.atan2(sin, cos);
    const relAngle = objAngleRad - frameAngle;
    const relCos = Math.abs(Math.cos(relAngle));
    const relSin = Math.abs(Math.sin(relAngle));

    // Object's half-size projected onto the print area's local axes
    let projHalfW = (objW * relCos + objH * relSin) / 2;
    let projHalfH = (objW * relSin + objH * relCos) / 2;

    // Cap scale if the object exceeds the print area in its local frame
    if (projHalfW > halfW || projHalfH > halfH) {
      const scaleRatio = Math.min(halfW / Math.max(projHalfW, 1), halfH / Math.max(projHalfH, 1));
      obj.set({
        scaleX: (obj.scaleX ?? 1) * scaleRatio,
        scaleY: (obj.scaleY ?? 1) * scaleRatio,
      });
      obj.setCoords();

      // Recompute projected sizes after scaling
      const newObjW = (obj.width ?? 0) * (obj.scaleX ?? 1);
      const newObjH = (obj.height ?? 0) * (obj.scaleY ?? 1);
      projHalfW = (newObjW * relCos + newObjH * relSin) / 2;
      projHalfH = (newObjW * relSin + newObjH * relCos) / 2;
    }

    // Object center in world coords (use getCenterPoint for accuracy with all origins)
    obj.setCoords();
    const objCenter = obj.getCenterPoint();

    // Transform object center into the print area's local frame
    const relX = objCenter.x - cx;
    const relY = objCenter.y - cy;
    const localX = relX * cos + relY * sin;
    const localY = -relX * sin + relY * cos;

    // Clamp in local frame so the visual object stays within the print area
    const clampedX = Math.max(-halfW + projHalfW, Math.min(halfW - projHalfW, localX));
    const clampedY = Math.max(-halfH + projHalfH, Math.min(halfH - projHalfH, localY));

    if (clampedX !== localX || clampedY !== localY) {
      // Transform back to world coordinates
      const newCx = cx + clampedX * cos - clampedY * sin;
      const newCy = cy + clampedX * sin + clampedY * cos;
      const dx = newCx - objCenter.x;
      const dy = newCy - objCenter.y;

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
        const source = this.placedLogoData.get(id)?.source;
        logos.push({
          id,
          dataUrl: (obj as FabricImage).getSrc(),
          ...(previewDataUrl !== undefined ? { previewDataUrl } : {}),
          ...(source !== undefined ? { source } : {}),
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
      // `_objectId` must be serialized explicitly — toJSON() drops custom properties,
      // which would leave the object map empty after a reload.
      fabricJson: this.canvas !== undefined ? JSON.stringify(this.canvas.toObject(['_objectId']) as unknown) : '',
      logos,
      texts,
      productImage: this.getActiveImage() !== '' ? this.getActiveImage() : null,
      width: this.width,
      height: this.height,
    };
  }

  /**
   * Builds the versioned envelope for every decoration. The active view is flushed
   * first — otherwise the decoration the customer is working on would be reported
   * as empty.
   */
  private buildArticleState(): ArticleEditorState {
    this.flushActiveView();

    const decorations: DecorationState[] = this.getViews().map(view => {
      const state = this.viewStates.get(view.id) ?? this.emptyEditorState(view);
      const designed = state.logos.length > 0 || state.texts.length > 0;

      return {
        viewId: view.id,
        label: view.label,
        ...(view.impMethod !== undefined ? { impMethod: view.impMethod } : {}),
        ...(view.impLocation !== undefined ? { impLocation: view.impLocation } : {}),
        ...(view.impWidthMm !== undefined ? { impWidthMm: view.impWidthMm } : {}),
        ...(view.impHeightMm !== undefined ? { impHeightMm: view.impHeightMm } : {}),
        ...(view.maxColours !== undefined ? { maxColours: view.maxColours } : {}),
        status: designed ? 'designed' : 'empty',
        state,
        ...(this.viewPreviews[view.id] !== undefined ? { previewDataUrl: this.viewPreviews[view.id] } : {}),
        issues: this.viewIssues.get(view.id) ?? [],
      };
    });

    return { version: 2, articleId: this.articleId, decorations };
  }

  private emptyEditorState(view: ArticleView): EditorState {
    return {
      fabricJson: '',
      logos: [],
      texts: [],
      productImage: view.image !== '' ? view.image : null,
      width: this.width,
      height: this.height,
    };
  }

  private emitStateChanged() {
    this.wtpEditorStateChanged.emit(this.buildArticleState());
  }

  private handleAddText = () => {
    this.addText(this.getLabels().defaultText, { fontFamily: this.selectedFont });
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

  private handleApplyToAll = () => {
    if (this.selectedObjectId !== null) void this.applyLogoToAllViews(this.selectedObjectId);
  };

  private handleDeleteSelected = () => {
    if (this.selectedObjectId !== null) {
      this.removeObject(this.selectedObjectId);
      this.selectedObjectId = null;
    }
  };

  /** Horizontal strip of decoration thumbnails, showing which ones already carry a design. */
  private renderViewStrip() {
    const views = this.getViews();
    if (!this.showViewStrip || views.length < 2) return null;

    const labels = this.getLabels();

    return (
      <div class="view-strip" role="tablist" aria-label={labels.viewStripLabel}>
        {views.map(view => {
          const isActive = view.id === this.currentViewId;
          const state = view.id === this.currentViewId ? undefined : this.viewStates.get(view.id);
          const designed = isActive ? this.objectMap.size > 0 : state !== undefined && (state.logos.length > 0 || state.texts.length > 0);
          const preview = this.viewPreviews[view.id];

          return (
            <button
              key={view.id}
              class={{ 'view-thumb': true, active: isActive, designed }}
              role="tab"
              aria-selected={isActive ? 'true' : 'false'}
              title={view.impMethod !== undefined ? `${view.label} — ${view.impMethod}` : view.label}
              data-view-id={view.id}
              onClick={this.handleViewSelect}
            >
              <span class="view-thumb-image">
                {preview !== undefined ? <img src={preview} alt="" /> : view.image !== '' ? <img src={view.image} alt="" /> : null}
                {designed && (
                  <span class="view-thumb-badge" title={labels.viewDesignedBadge}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </span>
              <span class="view-thumb-label">{view.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  render() {
    const labels = this.getLabels();

    return (
      <div class="wtp-editor">
        <div class="toolbar">
          <button class="toolbar-btn" onClick={this.handleAddText} title={labels.addTextTooltip}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            <span>{labels.addTextButton}</span>
          </button>

          <div class="toolbar-separator" />

          <select class="font-select" onChange={this.handleFontChange} title={labels.fontSelectTooltip}>
            {this.fonts.map(font => (
              <option value={font} style={{ fontFamily: font }}>{font}</option>
            ))}
          </select>

          {this.selectedObjectType === 'i-text' && (
            <input class="color-input" type="color" value={this.selectedTextColor} onInput={this.handleColorChange} title={labels.colorPickerTooltip} />
          )}

          {this.selectedObjectType === 'image' && this.getViews().length > 1 && (
            <button class="toolbar-btn" onClick={this.handleApplyToAll} title={labels.applyToAllTooltip}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{labels.applyToAllButton}</span>
            </button>
          )}

          <div class="toolbar-separator" />

          <button
            class="toolbar-btn danger"
            onClick={this.handleDeleteSelected}
            disabled={this.selectedObjectId === null}
            title={labels.deleteButtonTooltip}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

        </div>

        <div class="canvas-container">
          <canvas ref={el => (this.canvasEl = el)} />
        </div>

        {this.renderViewStrip()}
      </div>
    );
  }
}
