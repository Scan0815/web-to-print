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
  LogoMetadata,
  Article,
} from '../../types';
import {
  setCanvasBackground,
  generateObjectId,
  upscaleSvgDataUrl,
  fitLogoToPrintArea,
  printAreaToPixelCorners,
  printAreaFrame,
  clampToPrintAreaFrame,
  drawPrintAreaOverlay,
  getObjectId,
  setObjectId,
  type PrintAreaFrame,
} from '../../utils/canvas-helpers';
import { decorationMetaOf } from '../../utils/decoration-meta';
import { isPixelPrintArea, resolveViewPrintArea } from '../../utils/print-area';
import { validateDecoration, type ObjectBounds, type ObjectSize } from '../../utils/decoration-validation';
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
  /**
   * Logo the customer already picked in the catalog, placed once when the editor
   * initializes. It lands in the decoration the editor opens on and nowhere else:
   * `status: 'designed'` is what the shop charges for, so auto-filling every decoration
   * would order — and bill — positions the customer never chose. `applyLogoToAllViews`
   * is the one visible click that extends it. Ignored when `initialState` is set.
   */
  @Prop() initialLogo: LogoData | undefined;
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
  /** Suppresses the debug overlay during exports without touching the @Prop (which re-renders). */
  private suppressDebug: boolean = false;
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
  /** Resolves once every view's print area has been normalized. */
  private printAreasReady: Promise<void> = Promise.resolve();
  /** Validation findings of every view, refreshed whenever a view is flushed. */
  private viewIssues: Map<string, LogoValidationIssue[]> = new Map();
  /** Source data of every placed logo, so it can be copied to other decorations. */
  private placedLogoData: Map<string, LogoData> = new Map();
  /** Identifies the article the per-view state belongs to. */
  private loadedArticleKey: string = '';
  /** Serializes canvas transitions — two overlapping switches would flush into the wrong view. */
  private transition: Promise<void> = Promise.resolve();

  componentWillLoad() {
    const views = this.getViews();
    this.assertValidViews(views);
    this.currentViewId = this.resolveInitialViewId(views);
    this.loadedArticleKey = this.buildArticleKey(views);
  }

  /** Articles are told apart by id plus their decoration ids — view ids alone repeat across articles. */
  private buildArticleKey(views: ArticleView[]): string {
    return `${this.articleId}|${views.map(v => v.id).join(',')}`;
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
    if (this.resolvedPrintAreas.has(view.id)) return this.resolvedPrintAreas.get(view.id) ?? undefined;

    // Not normalized yet. A pixel area read as 0-1 would place logos and guides thousands
    // of pixels off the canvas, so having no print area is the safer intermediate state.
    if (view.printArea != null && isPixelPrintArea(view.printArea)) return undefined;
    return view.printArea ?? undefined;
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

  @Watch('articleId')
  onArticleIdChange() {
    this.onViewsChange();
  }

  @Watch('views')
  onViewsChange() {
    const views = this.getViews();
    this.assertValidViews(views);

    // A different article means the old per-view state is meaningless — even when the
    // new decorations happen to reuse an id like "front".
    const key = this.buildArticleKey(views);
    if (key !== this.loadedArticleKey) {
      this.loadedArticleKey = key;
      this.resetViewState();
      this.currentViewId = this.resolveInitialViewId(views);
      this.activeViewId = this.currentViewId;
      void this.enqueue(async () => {
        await this.activateView(this.getActiveView());
        await this.placeInitialLogo();
      });
    }

    void this.resolvePrintAreas();
  }

  /** Normalizes every view's print area to 0-1, loading images only when needed. */
  private resolvePrintAreas(): Promise<void> {
    this.printAreasReady = Promise.all(
      this.getViews().map(async view => {
        const resolved = await resolveViewPrintArea(view);
        this.resolvedPrintAreas.set(view.id, resolved);
      }),
    ).then(() => {
      this.canvas?.renderAll();
    });
    return this.printAreasReady;
  }

  @Watch('printArea')
  async onPrintAreaChange() {
    // Wait for background to finish loading so canvas dimensions are final
    await this.backgroundReady;
    // Re-constrain existing user objects to the new bounds
    if (this.canvas !== undefined) {
      for (const obj of this.objectMap.values()) {
        this.clampToActivePrintArea(obj);
      }
      this.canvas.renderAll();
    }
  }

  /** Add a logo image to the canvas and return its object ID. */
  @Method()
  async addLogo(logoData: LogoData): Promise<string> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');

    // Wait for background image to load so canvas dimensions are final, and for the
    // print areas to be normalized — otherwise the logo is fitted to nothing.
    await this.backgroundReady;
    await this.printAreasReady;

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

    setObjectId(img, id);
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

    // Wait for background image to load so canvas dimensions are final, and for the
    // print areas to be normalized — otherwise the text is centred on nothing.
    await this.backgroundReady;
    await this.printAreasReady;

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

    setObjectId(iText, id);
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
      this.placedLogoData.delete(id);
      this.canvas.renderAll();
      this.emitStateChanged();
    }
  }

  /** Export the state of every decoration as a versioned envelope. */
  @Method()
  async exportState(): Promise<ArticleEditorState> {
    return this.persistableArticleState(true);
  }

  /** Switch to another decoration, storing the current one first. */
  @Method()
  async setActiveView(viewId: string): Promise<void> {
    const views = this.getViews();
    const target = views.find(v => v.id === viewId);
    if (target === undefined) throw new Error(`wtp-editor: unknown view id "${viewId}".`);
    if (target.id === this.currentViewId) return;

    await this.visitView(target, { withPreview: true });
    this.wtpEditorViewChanged.emit({ viewId: target.id, index: views.indexOf(target) });
  }

  /**
   * Puts a decoration on the canvas. Bulk operations use this directly so one logical
   * action does not emit a view-change event or re-encode a thumbnail per hop.
   */
  private async visitView(target: ArticleView, options: { withPreview: boolean }): Promise<void> {
    await this.enqueue(async () => {
      if (target.id === this.currentViewId) return;

      this.flushActiveView(options.withPreview);

      this.currentViewId = target.id;
      this.activeViewId = target.id;
      this.selectedObjectId = null;
      this.selectedObjectType = null;

      await this.activateView(target);
    });
  }

  /**
   * Runs canvas transitions one after another. Overlapping switches would otherwise
   * flush the canvas that is still on screen into the state of the view being opened.
   */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.transition = this.transition.then(work, work);
    return this.transition;
  }

  private resetViewState(): void {
    this.viewStates.clear();
    this.viewIssues.clear();
    this.placedLogoData.clear();
    this.viewPreviews = {};
  }

  private async visitViewById(viewId: string, options: { withPreview: boolean }): Promise<void> {
    const target = this.getViews().find(v => v.id === viewId);
    if (target !== undefined) await this.visitView(target, options);
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

      await this.visitView(view, { withPreview: false });
      await this.addLogo(source);
      applied.push(view.id);
    }

    await this.visitViewById(originalViewId, { withPreview: false });

    return applied;
  }

  /**
   * Renders one decoration to an image, whether or not it is the one on screen. The
   * decoration is put on the canvas, exported, and the original one restored — so a host
   * building its own switcher can render a thumbnail for any decoration.
   *
   * The round trip goes through the same path as a manual switch, so it clears the
   * current selection when the requested decoration is not the active one.
   */
  @Method()
  async exportViewImage(viewId: string, format: 'png' | 'jpeg' = 'png', quality: number = 1): Promise<string> {
    const target = this.getViews().find(v => v.id === viewId);
    if (target === undefined) throw new Error(`wtp-editor: unknown view id "${viewId}".`);
    if (target.id === this.currentViewId) return this.exportImage(format, quality);

    const originalViewId = this.currentViewId;
    try {
      await this.visitView(target, { withPreview: false });
      return await this.exportImage(format, quality);
    } finally {
      await this.visitViewById(originalViewId, { withPreview: false });
    }
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
      await this.visitView(view, { withPreview: false });
      mockups[view.id] = await this.exportImageHighRes('png', 1, multiplier);
    }

    await this.visitViewById(originalViewId, { withPreview: false });

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
      this.resetViewState();
      const previews: Record<string, string> = {};

      for (const decoration of state.decorations) {
        this.viewStates.set(decoration.viewId, decoration.state);
        this.viewIssues.set(decoration.viewId, decoration.issues);
        if (decoration.previewDataUrl !== undefined) previews[decoration.viewId] = decoration.previewDataUrl;
        this.rememberPlacedLogos(decoration.state);
      }

      this.viewPreviews = previews;
      await this.enqueue(() => this.activateView(this.getActiveView()));
      return;
    }

    // Legacy v1 state belongs to the default view.
    this.resetViewState();
    this.viewStates.set(this.getActiveView().id, state);
    this.rememberPlacedLogos(state);
    await this.loadEditorState(state);
  }

  /**
   * Restores the logo lookup from a loaded state. Only what the envelope carries is
   * known — the upload metadata is not persisted, so it is reconstructed from the
   * source file information where available.
   */
  private rememberPlacedLogos(state: EditorState): void {
    for (const logo of state.logos) {
      this.placedLogoData.set(logo.id, {
        dataUrl: logo.dataUrl,
        ...(logo.previewDataUrl !== undefined ? { previewDataUrl: logo.previewDataUrl } : {}),
        ...(logo.source !== undefined ? { source: logo.source } : {}),
        metadata: {
          format: 'unknown',
          width: 0,
          height: 0,
          dpiX: null,
          dpiY: null,
          fileSize: logo.source?.fileSize ?? 0,
          fileName: logo.source?.fileName ?? '',
          mimeType: logo.source?.mimeType ?? '',
          hasTransparency: false,
        },
      });
    }
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

  /**
   * Places the catalog logo on the decoration the editor opens on.
   *
   * Runs again after an article reset rather than once at startup: hosts create the
   * element first and assign `views`/`articleId` once the article has been fetched, and
   * that reset clears the canvas. Placing only at startup loses the logo — nondeterministically,
   * since it races the image decode. Re-placing is safe because a reset means a new
   * article, so there is nothing of the customer's to overwrite.
   *
   * Failures are swallowed on purpose: a logo that cannot be decoded must not stop the
   * editor from coming up — the customer can still upload another one.
   */
  private async placeInitialLogo(): Promise<void> {
    if (this.initialLogo === undefined) return;
    if (this.initialState !== undefined && this.initialState !== '') return;

    try {
      await this.addLogo(this.initialLogo);
    } catch {
      // Undecodable initial logo; the editor stays usable without it.
    }
  }

  /**
   * Stores the canvas state of the currently edited view. The thumbnail is only
   * refreshed when explicitly asked for: `text:changed` fires per keystroke, and a
   * toDataURL of a 2400px product image per character is far too expensive.
   */
  private flushActiveView(withPreview: boolean = false): void {
    if (this.canvas === undefined) return;
    const state = this.buildEditorState();
    this.viewStates.set(this.currentViewId, state);
    this.viewIssues.set(this.currentViewId, this.validateActiveView(state));
    if (withPreview) this.capturePreview(this.currentViewId);
  }

  /**
   * Runs the per-decoration checks for the view on the canvas right now. Bounds come
   * from Fabric, so this only works while the view is active — which is why the result
   * is cached per view.
   */
  private validateActiveView(state: EditorState): LogoValidationIssue[] {
    if (this.canvas === undefined) return [];

    const bounds: ObjectBounds[] = [];
    const sizes: ObjectSize[] = [];
    for (const obj of this.objectMap.values()) {
      const rect = obj.getBoundingRect();
      bounds.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      // getBoundingRect is the world-space box, which is up to 1.41x the real size once
      // the object is rotated to match a tilted print area. Both geometry checks work in
      // the area's own frame instead — the same frame the drag clamp uses.
      const center = obj.getCenterPoint();
      sizes.push({
        centerX: center.x,
        centerY: center.y,
        width: (obj.width ?? 0) * (obj.scaleX ?? 1),
        height: (obj.height ?? 0) * (obj.scaleY ?? 1),
        angle: obj.angle ?? 0,
      });
    }

    // Only the logos actually on this decoration — the map is article-wide.
    const logoMetadata: LogoMetadata[] = [];
    for (const logo of state.logos) {
      const metadata = this.placedLogoData.get(logo.id)?.metadata;
      if (metadata !== undefined) logoMetadata.push(metadata);
    }

    return validateDecoration({
      view: this.getActiveView(),
      state,
      bounds,
      sizes,
      printArea: this.getActivePrintArea() ?? null,
      canvasWidth: this.canvas.getWidth(),
      canvasHeight: this.canvas.getHeight(),
      logoMetadata,
      labels: this.getLabels().issues,
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
        const id = getObjectId(obj);
        if (id !== undefined) this.objectMap.set(id, obj);
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

  /** Cross-origin product images taint the canvas; explain that instead of leaking the DOM error. */
  private asExportError(e: unknown): Error {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      return new Error('Cannot export: product image is cross-origin. Use a CORS proxy or serve images from the same domain.');
    }
    return e instanceof Error ? e : new Error(String(e));
  }

  /** Export the canvas as a data URL image. */
  @Method()
  async exportImage(format: 'png' | 'jpeg' = 'png', quality: number = 1): Promise<string> {
    if (this.canvas === undefined) throw new Error('Canvas not initialized');
    try {
      return this.canvas.toDataURL({ multiplier: 1, format, quality });
    } catch (e) {
      throw this.asExportError(e);
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

    this.suppressDebug = true;
    this.canvas.renderAll();

    try {
      const dataUrl = this.canvas.toDataURL({ multiplier, format, quality });
      return { dataUrl, width: this.canvas.getWidth(), height: this.canvas.getHeight() };
    } catch (e) {
      throw this.asExportError(e);
    } finally {
      this.suppressDebug = false;
      this.canvas.renderAll();
    }
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
      if (e.target !== undefined) this.clampToActivePrintArea(e.target);
    });

    this.canvas.on('object:scaling', e => {
      if (e.target !== undefined) this.clampToActivePrintArea(e.target);
    });

    this.canvas.on('after:render', () => this.drawDebugOverlay());

    // Normalize pixel print areas before anything is placed on the canvas
    void this.resolvePrintAreas();

    // Load initial state if provided
    if (this.initialState !== undefined && this.initialState !== '') {
      try {
        const state = JSON.parse(this.initialState) as ArticleEditorState | EditorState;
        void this.loadState(state);
      } catch {
        // Invalid JSON, ignore
      }
    } else {
      if (this.getActiveImage() !== '') {
        this.backgroundReady = setCanvasBackground(this.canvas, this.getActiveImage());
      }
      void this.enqueue(() => this.placeInitialLogo());
    }

    this.wtpEditorReady.emit();
  }


  /** Draw print area outline and bounding box on the canvas when debug mode is active. */
  private drawDebugOverlay() {
    if (!this.debug || this.suppressDebug || this.canvas === undefined) return;

    const printArea = this.getActivePrintArea();
    if (printArea === undefined) return;

    drawPrintAreaOverlay(this.canvas.getContext() as CanvasRenderingContext2D, printArea, this.canvas.getWidth(), this.canvas.getHeight());
  }

  /** The active print area's own coordinate system, or null when it has none. */
  private getPrintAreaFrame(): PrintAreaFrame | null {
    const printArea = this.getActivePrintArea();
    if (printArea === undefined || this.canvas === undefined) return null;
    return printAreaFrame(printArea, this.canvas.getWidth(), this.canvas.getHeight());
  }

  private clampToActivePrintArea(obj: FabricObject) {
    const frame = this.getPrintAreaFrame();
    if (frame !== null) clampToPrintAreaFrame(obj, frame);
  }

  private handleSelection(obj: FabricObject | undefined) {
    if (obj === undefined) return;
    const id = getObjectId(obj);
    if (id !== undefined) {
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

  /**
   * @param withFabricJson Serializing the whole canvas costs a multi-MB base64 string
   *   (every logo src is included). Only the persistence paths need it.
   */
  private buildEditorState(withFabricJson: boolean = true): EditorState {
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
      fabricJson: withFabricJson && this.canvas !== undefined ? JSON.stringify(this.canvas.toObject(['_objectId']) as unknown) : '',
      logos,
      texts,
      productImage: this.getActiveImage() !== '' ? this.getActiveImage() : null,
      width: this.width,
      height: this.height,
    };
  }

  /**
   * The envelope to persist: complete, with `fabricJson` for every decoration. The active
   * view is stored first — otherwise the decoration the customer is working on right now
   * would be reported as empty.
   */
  private persistableArticleState(withPreview: boolean = false): ArticleEditorState {
    this.flushActiveView(withPreview);
    return this.composeArticleState();
  }

  /**
   * The envelope for the change event: cheap. The active decoration is read straight off
   * the canvas without serializing it or writing it back, so it carries no `fabricJson`.
   * `text:changed` fires per keystroke, and persistence uses the stored state anyway.
   */
  private liveArticleState(): ArticleEditorState {
    const activeState = this.canvas !== undefined ? this.buildEditorState(false) : undefined;
    const activeIssues = activeState !== undefined ? this.validateActiveView(activeState) : undefined;
    return this.composeArticleState(activeState, activeIssues);
  }

  /**
   * Assembles one `DecorationState` per view from what is stored. The two callers differ
   * only in where the active decoration comes from: stored (persistable) or passed in
   * live (change event).
   */
  private composeArticleState(activeState?: EditorState, activeIssues?: LogoValidationIssue[]): ArticleEditorState {
    const decorations: DecorationState[] = this.getViews().map(view => {
      const isActive = view.id === this.currentViewId;
      const state = (isActive ? activeState : undefined) ?? this.viewStates.get(view.id) ?? this.emptyEditorState(view);
      const issues = (isActive ? activeIssues : undefined) ?? this.viewIssues.get(view.id) ?? [];
      const designed = state.logos.length > 0 || state.texts.length > 0;

      return {
        viewId: view.id,
        label: view.label,
        ...decorationMetaOf(view),
        status: designed ? 'designed' : 'empty',
        state,
        ...(this.viewPreviews[view.id] !== undefined ? { previewDataUrl: this.viewPreviews[view.id] } : {}),
        issues,
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
    this.wtpEditorStateChanged.emit(this.liveArticleState());
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
