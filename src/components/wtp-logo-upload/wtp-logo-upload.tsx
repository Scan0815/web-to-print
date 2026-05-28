import { Component, h, Prop, State, Event, EventEmitter } from '@stencil/core';
import { LogoValidationConfig, LogoData, LogoValidationIssue, LogoMetadata, DEFAULT_VALIDATION_CONFIG, BgRemovalConfig, LogoUploadLabels, DEFAULT_LOGO_UPLOAD_LABELS } from '../../types';
import { validateLogo } from '../../utils/logo-validation';
import { removeBackground } from '../../utils/background-removal';
import { generatePreviewDataUrl } from '../../utils/image-preview';
import { trimSvgWhitespace, parseSvgDimensions } from '../../utils/canvas-helpers';

interface BgRemovalChoice {
  originalDataUrl: string;
  removedBgDataUrl: string | null;
  removedBgWidth: number | null;
  removedBgHeight: number | null;
  metadata: LogoMetadata;
  status: 'processing' | 'ready' | 'error';
  errorMessage: string | null;
}

@Component({
  tag: 'wtp-logo-upload',
  styleUrl: 'wtp-logo-upload.scss',
  shadow: true,
})
export class WtpLogoUpload {
  /** Validation rules for uploaded logos. */
  @Prop() config: LogoValidationConfig = DEFAULT_VALIDATION_CONFIG;
  /** Accepted file MIME types for the file input. */
  @Prop() accept: string = 'image/png,image/jpeg,image/svg+xml,image/tiff,image/avif';
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

  private async buildLogoData(dataUrl: string, metadata: LogoMetadata): Promise<LogoData> {
    const previewDataUrl = await generatePreviewDataUrl(dataUrl);
    return { dataUrl, previewDataUrl, metadata };
  }

  private isRasterFormat(format: string): boolean {
    return ['png', 'jpeg', 'tiff', 'avif'].includes(format);
  }

  private async processFiles(files: FileList | File[]) {
    if (this.disabled) return;

    this.isProcessing = true;
    this.rejections = [];
    this.wtpLogoProcessing.emit(true);

    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const result = await validateLogo(file, this.config);

      if (result.valid) {
        const rawDataUrl = await this.fileToDataUrl(file);
        let dataUrl: string;
        const metadata = result.metadata;

        if (metadata.format === 'svg') {
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
          this.addPendingChoice(dataUrl, metadata, file);
        } else {
          const logoData = await this.buildLogoData(dataUrl, metadata);
          this.previews = [...this.previews, logoData];
          this.selectedIndex = this.previews.length - 1;
          this.wtpLogoValidated.emit(logoData);
          this.wtpLogoSelected.emit(logoData);
        }
      } else {
        this.rejections = [...this.rejections, { fileName: file.name, issues: result.issues }];
        this.wtpLogoRejected.emit({ file, issues: result.issues });
      }
    }

    this.isProcessing = false;
    this.wtpLogoProcessing.emit(false);
  }

  private addPendingChoice(originalDataUrl: string, metadata: LogoMetadata, file: File) {
    const choice: BgRemovalChoice = {
      originalDataUrl,
      removedBgDataUrl: null,
      removedBgWidth: null,
      removedBgHeight: null,
      metadata,
      status: 'processing',
      errorMessage: null,
    };
    this.pendingChoices = [...this.pendingChoices, choice];
    const index = this.pendingChoices.length - 1;
    this.performBackgroundRemoval(file, index);
  }

  private async performBackgroundRemoval(file: File, index: number) {
    try {
      const result = await removeBackground(file, this.bgRemovalConfig);
      this.pendingChoices = this.pendingChoices.map((c, i) =>
        i === index ? { ...c, removedBgDataUrl: result.dataUrl, removedBgWidth: result.width, removedBgHeight: result.height, status: 'ready' as const } : c,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Background removal failed';
      this.pendingChoices = this.pendingChoices.map((c, i) =>
        i === index ? { ...c, status: 'error' as const, errorMessage: message } : c,
      );
    }
  }

  private async selectChoice(index: number, useRemoved: boolean) {
    const choice = this.pendingChoices[index];
    if (choice === undefined) return;

    const dataUrl = useRemoved && choice.removedBgDataUrl !== null ? choice.removedBgDataUrl : choice.originalDataUrl;
    const metadata = useRemoved && choice.removedBgWidth !== null && choice.removedBgHeight !== null
      ? { ...choice.metadata, width: choice.removedBgWidth, height: choice.removedBgHeight }
      : choice.metadata;
    const logoData = await this.buildLogoData(dataUrl, metadata);
    this.previews = [...this.previews, logoData];
    this.selectedIndex = this.previews.length - 1;
    this.wtpLogoValidated.emit(logoData);
    this.wtpLogoSelected.emit(logoData);
    this.pendingChoices = this.pendingChoices.filter((_, i) => i !== index);
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
    const btn = (e.currentTarget as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (btn === null) return;
    this.selectChoice(Number(btn.dataset.index), false);
  };

  private handleSelectRemoved = (e: Event) => {
    const btn = (e.currentTarget as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (btn === null) return;
    this.selectChoice(Number(btn.dataset.index), true);
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
            {this.pendingChoices.map((choice, index) => (
              <div class="choice-card" part="choice-card">
                <p class="choice-title">{choice.metadata.fileName}</p>
                <div class="choice-options">
                  <button class="choice-option" part="choice-option" data-index={index} onClick={this.handleSelectOriginal}>
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
                    data-index={index}
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
                data-index={index}
                onClick={this.handleSelectPreview}
                role="button"
                tabindex={0}
              >
                <img src={preview.previewDataUrl ?? preview.dataUrl} alt={preview.metadata.fileName} class="preview-image" />
                <div class="preview-info">
                  <span class="preview-name">{preview.metadata.fileName}</span>
                  <span class="preview-dims">{preview.metadata.width} x {preview.metadata.height}px</span>
                  {preview.metadata.dpiX !== null && <span class="preview-dpi">{preview.metadata.dpiX} {labels.rejectionDpiUnit}</span>}
                </div>
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
