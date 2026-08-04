import { Component, h, Prop, State, Event, EventEmitter } from '@stencil/core';
import { LogoValidationConfig, LogoData, LogoSource, LogoValidationIssue, LogoMetadata, DEFAULT_VALIDATION_CONFIG, BgRemovalConfig, LogoUploadLabels, DEFAULT_LOGO_UPLOAD_LABELS } from '../../types';
import { renderPdfFirstPage } from '../../utils/pdf-render';
import { validateLogo } from '../../utils/logo-validation';
import { removeBackground } from '../../utils/background-removal';
import { generatePreviewDataUrl } from '../../utils/image-preview';
import { trimSvgWhitespace, parseSvgDimensions, generateObjectId } from '../../utils/canvas-helpers';

interface BgRemovalChoice {
  /**
   * Identity of this card. Not its position: choices are removed as the customer decides,
   * and a background removal still running would then write its result into whichever card
   * shifted into the index it captured — or into none at all, leaving that card spinning.
   */
  id: string;
  /** The uploaded file, kept for the print shop regardless of which variant is chosen. */
  source: LogoSource;
  originalDataUrl: string;
  removedBgDataUrl: string | null;
  removedBgWidth: number | null;
  removedBgHeight: number | null;
  metadata: LogoMetadata;
  status: 'processing' | 'ready' | 'error';
  errorMessage: string | null;
}

/**
 * Logo upload with drag-and-drop, format detection and print validation.
 *
 * @slot prompt - Replaces the default drop-zone prompt (icon, headline and hint).
 *   The fallback content is shown when nothing is slotted in.
 */
@Component({
  tag: 'wtp-logo-upload',
  styleUrl: 'wtp-logo-upload.scss',
  shadow: true,
})
export class WtpLogoUpload {
  /** Validation rules for uploaded logos. */
  @Prop() config: LogoValidationConfig = DEFAULT_VALIDATION_CONFIG;
  /** Accepted file MIME types for the file input. */
  @Prop() accept: string = 'image/png,image/jpeg,image/svg+xml,image/tiff,image/avif,application/pdf,.ai';
  /** Whether multiple files can be uploaded at once. */
  @Prop() multiple: boolean = false;
  /** Disables the upload component. */
  @Prop() disabled: boolean = false;
  /** Enables background removal for raster images after upload. */
  @Prop() enableBackgroundRemoval: boolean = false;
  /** Shows the "fetch from URL" input. Hidden by default; set to true to opt in. */
  @Prop() allowUrlUpload: boolean = false;
  /** Configuration for the color-based background removal algorithm. */
  @Prop() bgRemovalConfig: Partial<BgRemovalConfig> = {};
  /** Override any of the user-facing strings. Missing keys fall back to English defaults. */
  @Prop() labels: Partial<LogoUploadLabels> = {};

  private getLabels(): LogoUploadLabels {
    return { ...DEFAULT_LOGO_UPLOAD_LABELS, ...this.labels };
  }

  @State() isDragOver: boolean = false;
  @State() previews: LogoData[] = [];
  @State() selectedIndex: number = -1;
  @State() rejections: { fileName: string; issues: LogoValidationIssue[] }[] = [];
  @State() isProcessing: boolean = false;
  @State() pendingChoices: BgRemovalChoice[] = [];
  @State() urlInput: string = '';
  @State() urlError: string | null = null;
  @State() isUrlFetching: boolean = false;

  /** Fires when a logo passes validation and is ready for use. */
  @Event() wtpLogoValidated: EventEmitter<LogoData>;
  /** Fires when a logo fails validation. */
  @Event() wtpLogoRejected: EventEmitter<{ file: File; issues: LogoValidationIssue[] }>;
  /** Fires when processing state changes (true = busy, false = idle). */
  @Event() wtpLogoProcessing: EventEmitter<boolean>;
  /** Fires when a logo is selected from the preview gallery. */
  @Event() wtpLogoSelected: EventEmitter<LogoData>;

  private fileInputRef: HTMLInputElement | undefined;

  private async buildLogoData(dataUrl: string, metadata: LogoMetadata, source?: LogoSource): Promise<LogoData> {
    const previewDataUrl = await generatePreviewDataUrl(dataUrl);
    return { dataUrl, previewDataUrl, ...(source !== undefined ? { source } : {}), metadata };
  }

  private isRasterFormat(format: string): boolean {
    return ['png', 'jpeg', 'tiff', 'avif'].includes(format);
  }

  private async processFiles(files: FileList | File[]) {
    if (this.disabled) return;

    this.isProcessing = true;
    this.rejections = [];
    this.wtpLogoProcessing.emit(true);

    try {
      for (const file of Array.from(files)) {
        try {
          await this.processFile(file);
        } catch (e) {
          // A file that cannot be read or decoded is the customer's problem to see, not a
          // reason to abandon the rest of the batch — and never a reason to strand the
          // component: without the surrounding `finally` the spinner would stay up and the
          // host would keep believing an upload is in flight.
          const message = e instanceof Error ? e.message : 'Could not read the file.';
          this.reject(file, [{ code: 'FILE_UNREADABLE', severity: 'error', message }]);
        }
      }
    } finally {
      this.isProcessing = false;
      this.wtpLogoProcessing.emit(false);
    }
  }

  private async processFile(file: File): Promise<void> {
    const result = await validateLogo(file, this.config);
    if (!result.valid) {
      this.reject(file, result.issues);
      return;
    }

    const rawDataUrl = await this.fileToDataUrl(file);
    const metadata = result.metadata;
    // The print shop needs what the customer uploaded, not what the editor made of it —
    // every format derives its canvas representation, so keep the original.
    const source: LogoSource = { dataUrl: rawDataUrl, mimeType: file.type, fileName: file.name, fileSize: file.size };

    let dataUrl: string;
    if (metadata.format === 'pdf' || metadata.format === 'ai') {
      // The canvas cannot draw a PDF: rasterize page 1 and keep the original for print.
      // Caught here rather than by the caller so the finding names the actual cause.
      try {
        const rendered = await renderPdfFirstPage(file);
        dataUrl = rendered.dataUrl;
        metadata.width = rendered.width;
        metadata.height = rendered.height;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not read the file.';
        this.reject(file, [{ code: 'PDF_RENDER_FAILED', severity: 'error', message }]);
        return;
      }
    } else if (metadata.format === 'svg') {
      dataUrl = await trimSvgWhitespace(rawDataUrl);
      const trimmedDims = parseSvgDimensions(dataUrl);
      if (trimmedDims !== null) {
        metadata.width = trimmedDims.width;
        metadata.height = trimmedDims.height;
      }
    } else {
      dataUrl = rawDataUrl;
    }

    if (this.enableBackgroundRemoval && this.isRasterFormat(metadata.format)) {
      this.addPendingChoice(dataUrl, metadata, file, source);
      return;
    }

    const logoData = await this.buildLogoData(dataUrl, metadata, source);
    this.previews = [...this.previews, logoData];
    this.selectedIndex = this.previews.length - 1;
    this.wtpLogoValidated.emit(logoData);
    this.wtpLogoSelected.emit(logoData);
  }

  private reject(file: File, issues: LogoValidationIssue[]) {
    this.rejections = [...this.rejections, { fileName: file.name, issues }];
    this.wtpLogoRejected.emit({ file, issues });
  }

  private addPendingChoice(originalDataUrl: string, metadata: LogoMetadata, file: File, source: LogoSource) {
    const id = generateObjectId();
    const choice: BgRemovalChoice = {
      id,
      source,
      originalDataUrl,
      removedBgDataUrl: null,
      removedBgWidth: null,
      removedBgHeight: null,
      metadata,
      status: 'processing',
      errorMessage: null,
    };
    this.pendingChoices = [...this.pendingChoices, choice];
    this.performBackgroundRemoval(file, id);
  }

  private async performBackgroundRemoval(file: File, id: string) {
    try {
      const result = await removeBackground(file, this.bgRemovalConfig);
      this.pendingChoices = this.pendingChoices.map(c =>
        c.id === id ? { ...c, removedBgDataUrl: result.dataUrl, removedBgWidth: result.width, removedBgHeight: result.height, status: 'ready' as const } : c,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Background removal failed';
      this.pendingChoices = this.pendingChoices.map(c => (c.id === id ? { ...c, status: 'error' as const, errorMessage: message } : c));
    }
  }

  private async selectChoice(id: string, useRemoved: boolean) {
    const choice = this.pendingChoices.find(c => c.id === id);
    if (choice === undefined) return;

    const dataUrl = useRemoved && choice.removedBgDataUrl !== null ? choice.removedBgDataUrl : choice.originalDataUrl;
    const metadata = useRemoved && choice.removedBgWidth !== null && choice.removedBgHeight !== null
      ? { ...choice.metadata, width: choice.removedBgWidth, height: choice.removedBgHeight }
      : choice.metadata;
    const logoData = await this.buildLogoData(dataUrl, metadata, choice.source);
    this.previews = [...this.previews, logoData];
    this.selectedIndex = this.previews.length - 1;
    this.wtpLogoValidated.emit(logoData);
    this.wtpLogoSelected.emit(logoData);
    this.pendingChoices = this.pendingChoices.filter(c => c.id !== id);
  }

  private extractFileNameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split('/');
      const last = segments[segments.length - 1];
      return last !== undefined && last !== '' && last.includes('.') ? decodeURIComponent(last) : 'downloaded-image';
    } catch {
      return 'downloaded-image';
    }
  }

  private async handleUrlSubmit() {
    const url = this.urlInput.trim();
    const labels = this.getLabels();
    this.urlError = null;

    if (url === '') {
      this.urlError = labels.urlErrorEmpty;
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.urlError = labels.urlErrorInvalid;
      return;
    }

    if (parsed.protocol !== 'https:') {
      this.urlError = labels.urlErrorProtocol;
      return;
    }

    this.isUrlFetching = true;

    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        this.urlError = labels.urlErrorHttp(response.status, response.statusText);
        return;
      }

      const blob = await response.blob();
      const fileName = this.extractFileNameFromUrl(url);
      const file = new File([blob], fileName, { type: blob.type });

      this.urlInput = '';
      await this.processFiles([file]);
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.urlErrorFetch;
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        this.urlError = labels.urlErrorNetwork;
      } else {
        this.urlError = message;
      }
    } finally {
      this.isUrlFetching = false;
    }
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  private handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!this.disabled) this.isDragOver = true;
  };

  private handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
  };

  private handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
    if (e.dataTransfer?.files !== undefined) {
      this.processFiles(e.dataTransfer.files);
    }
  };

  private handleInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files !== null) {
      this.processFiles(input.files);
    }
  };

  private handleClick = () => {
    if (!this.disabled) {
      this.fileInputRef?.click();
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.handleClick();
    }
  };

  private handleUrlInput = (e: Event) => {
    this.urlInput = (e.target as HTMLInputElement).value;
  };

  private handleUrlInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.handleUrlSubmit();
    }
  };

  private handleUrlSubmitClick = () => {
    this.handleUrlSubmit();
  };

  private handleSelectOriginal = (e: Event) => {
    const id = (e.currentTarget as HTMLElement).dataset.choiceId;
    if (id !== undefined) this.selectChoice(id, false);
  };

  private handleSelectRemoved = (e: Event) => {
    const id = (e.currentTarget as HTMLElement).dataset.choiceId;
    if (id !== undefined) this.selectChoice(id, true);
  };

  private handleSelectPreview = (e: Event) => {
    const item = (e.currentTarget as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (item === null) return;
    const index = Number(item.dataset.index);
    this.selectedIndex = index;
    this.wtpLogoSelected.emit(this.previews[index]);
  };

  private handleRemovePreview = (e: Event) => {
    e.stopPropagation();
    const btn = (e.currentTarget as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (btn === null) return;
    const index = Number(btn.dataset.index);
    this.previews = this.previews.filter((_, i) => i !== index);
    if (this.selectedIndex === index) {
      this.selectedIndex = this.previews.length > 0 ? 0 : -1;
      if (this.selectedIndex >= 0) {
        this.wtpLogoSelected.emit(this.previews[this.selectedIndex]);
      }
    } else if (this.selectedIndex > index) {
      this.selectedIndex--;
    }
  };

  render() {
    const labels = this.getLabels();

    return (
      <div class="wtp-logo-upload" part="root">
        {this.allowUrlUpload && (
          <div>
            {/* URL input section */}
            <div class="url-input-section">
              <div class="url-input-wrapper">
                <input
                  type="url"
                  class="url-input"
                  part="url-input"
                  placeholder={labels.urlPlaceholder}
                  value={this.urlInput}
                  disabled={this.disabled || this.isUrlFetching}
                  onInput={this.handleUrlInput}
                  onKeyDown={this.handleUrlInputKeyDown}
                />
                <button
                  class="url-submit-btn"
                  part="url-submit-btn"
                  disabled={this.disabled || this.isUrlFetching || this.urlInput.trim() === ''}
                  onClick={this.handleUrlSubmitClick}
                >
                  {this.isUrlFetching ? <span class="spinner-sm" /> : labels.urlSubmit}
                </button>
              </div>
              {this.urlError !== null && <p class="url-error" part="url-error">{this.urlError}</p>}
            </div>

            {/* Divider */}
            <div class="divider" part="divider">
              <span class="divider-text">{labels.dividerText}</span>
            </div>
          </div>
        )}

        {/* Drag-and-drop zone */}
        <div
          class={{
            'upload-zone': true,
            'drag-over': this.isDragOver,
            'disabled': this.disabled,
          }}
          part={`upload-zone${this.isDragOver ? ' drag-over' : ''}${this.disabled ? ' disabled' : ''}`}
          onDragOver={this.handleDragOver}
          onDragLeave={this.handleDragLeave}
          onDrop={this.handleDrop}
          onClick={this.handleClick}
          onKeyDown={this.handleKeyDown}
          role="button"
          tabindex={this.disabled ? -1 : 0}
          aria-label={labels.uploadAriaLabel}
          aria-disabled={this.disabled ? 'true' : undefined}
        >
          <input
            type="file"
            ref={el => (this.fileInputRef = el)}
            accept={this.accept}
            multiple={this.multiple}
            onChange={this.handleInputChange}
            class="file-input"
            tabindex={-1}
          />
          <slot name="prompt">
            <div class="default-prompt">
              <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p class="prompt-text" part="prompt-text">{labels.dropPromptText}</p>
              <p class="prompt-hint" part="prompt-hint">{labels.dropPromptHint}</p>
            </div>
          </slot>
          {this.isProcessing && <div class="processing-overlay"><span class="spinner" /></div>}
        </div>

        {/* Rejections */}
        {this.rejections.length > 0 && (
          <div class="rejections" part="rejections">
            {this.rejections.map(r => (
              <div class="rejection-item" part="rejection-item">
                <strong>{r.fileName}</strong>
                <ul>
                  {r.issues.filter(i => i.severity === 'error').map(i => (
                    <li class="error">{i.message}</li>
                  ))}
                  {r.issues.filter(i => i.severity === 'warning').map(i => (
                    <li class="warning">{i.message}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Pending choice cards (background removal) */}
        {this.pendingChoices.length > 0 && (
          <div class="pending-choices" part="pending-choices">
            {this.pendingChoices.map(choice => (
              <div class="choice-card" part="choice-card">
                <p class="choice-title">{choice.metadata.fileName}</p>
                <div class="choice-options">
                  <button class="choice-option" part="choice-option" data-choice-id={choice.id} onClick={this.handleSelectOriginal}>
                    <img src={choice.originalDataUrl} alt="Original" class="choice-image" />
                    <span class="choice-label">{labels.bgRemovalUseOriginal}</span>
                  </button>
                  <button
                    class={{
                      'choice-option': true,
                      'choice-option--disabled': choice.status === 'processing',
                    }}
                    part="choice-option"
                    disabled={choice.status === 'processing'}
                    data-choice-id={choice.id}
                    onClick={this.handleSelectRemoved}
                  >
                    {choice.status === 'processing' && (
                      <div class="choice-image choice-image--loading">
                        <span class="spinner-sm" />
                        <span class="choice-loading-text">{labels.bgRemovalProcessing}</span>
                      </div>
                    )}
                    {choice.status === 'ready' && choice.removedBgDataUrl !== null && (
                      <img src={choice.removedBgDataUrl} alt="Background removed" class="choice-image choice-image--transparent" />
                    )}
                    {choice.status === 'error' && (
                      <div class="choice-image choice-image--error">
                        <span class="choice-error-text">{choice.errorMessage}</span>
                      </div>
                    )}
                    <span class="choice-label">
                      {choice.status === 'error' ? labels.bgRemovalFailed : labels.bgRemovalUseRemoved}
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Previews */}
        {this.previews.length > 0 && (
          <div class="previews" part="previews">
            {this.previews.map((preview, index) => (
              <div
                class={{ 'preview-item': true, 'preview-item--selected': index === this.selectedIndex }}
                part={`preview-item${index === this.selectedIndex ? ' selected' : ''}`}
              >
                {/* A real button: it takes focus, activates on Enter and Space, and — unlike
                    a div with role="button" wrapped around everything — leaves the remove
                    button as a sibling instead of nesting one control inside another. */}
                <button
                  type="button"
                  class="preview-select"
                  part="preview-select"
                  data-index={index}
                  onClick={this.handleSelectPreview}
                  aria-pressed={index === this.selectedIndex ? 'true' : 'false'}
                >
                  <img src={preview.previewDataUrl ?? preview.dataUrl} alt={preview.metadata.fileName} class="preview-image" />
                  <div class="preview-info">
                    <span class="preview-name">{preview.metadata.fileName}</span>
                    <span class="preview-dims">{preview.metadata.width} x {preview.metadata.height}px</span>
                    {preview.metadata.dpiX !== null && <span class="preview-dpi">{preview.metadata.dpiX} {labels.rejectionDpiUnit}</span>}
                  </div>
                </button>
                <button class="remove-btn" part="remove-btn" data-index={index} onClick={this.handleRemovePreview} aria-label={labels.removeAriaLabel(preview.metadata.fileName)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
