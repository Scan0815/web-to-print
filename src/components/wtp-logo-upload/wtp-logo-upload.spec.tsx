import { render, h, describe, it, expect } from '@stencil/vitest';

type UploadElement = HTMLElement & {
  enableBackgroundRemoval: boolean;
  labels: Record<string, string>;
};

describe('wtp-logo-upload', () => {
  it('renders the upload zone', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.upload-zone')).toBeTruthy();
  });

  it('renders the default prompt', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.prompt-text')?.textContent).toContain('Drag & drop');
  });

  it('renders file input with correct accept attribute', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe('image/png,image/jpeg,image/svg+xml,image/tiff,image/avif,application/pdf,.ai');
  });

  it('reflects the disabled state', async () => {
    const { root } = await render(<wtp-logo-upload disabled></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.upload-zone')?.classList.contains('disabled')).toBe(true);
  });

  it('supports multiple file upload', async () => {
    const { root } = await render(<wtp-logo-upload multiple></wtp-logo-upload>);
    const input = root.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it('renders slot for custom prompt', async () => {
    const { root } = await render(
      <wtp-logo-upload>
        <span slot="prompt">Custom prompt</span>
      </wtp-logo-upload>,
    );
    expect(root.shadowRoot?.querySelector('slot[name="prompt"]')).toBeTruthy();
  });

  it('has accessible role and tabindex', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const uploadZone = root.shadowRoot?.querySelector('.upload-zone');
    expect(uploadZone?.getAttribute('role')).toBe('button');
    expect(uploadZone?.getAttribute('tabindex')).toBe('0');
  });

  it('sets tabindex to -1 when disabled', async () => {
    const { root } = await render(<wtp-logo-upload disabled></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.upload-zone')?.getAttribute('tabindex')).toBe('-1');
  });

  // --- URL input tests ---

  it('hides the URL input by default', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.url-input-section')).toBeNull();
    expect(root.shadowRoot?.querySelector('.divider')).toBeNull();
  });

  it('renders URL input and submit button when allowUrlUpload is set', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    const urlInput = root.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const submitBtn = root.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement;
    expect(urlInput).toBeTruthy();
    expect(urlInput.type).toBe('url');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.textContent).toContain('Fetch');
  });

  it('disables URL input when component is disabled', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload disabled></wtp-logo-upload>);
    const urlInput = root.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const submitBtn = root.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement;
    expect(urlInput.disabled).toBe(true);
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders divider between URL input and drop zone when allowUrlUpload is set', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.divider')).toBeTruthy();
    expect(root.shadowRoot?.querySelector('.divider-text')?.textContent).toBe('or');
  });

  // --- Background removal prop tests ---

  it('accepts enableBackgroundRemoval prop', async () => {
    const { root } = await render(<wtp-logo-upload enable-background-removal></wtp-logo-upload>);
    expect((root as UploadElement).enableBackgroundRemoval).toBe(true);
  });

  it('does not show pending choices when bg-removal is disabled', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.pending-choices')).toBeNull();
  });

  // --- Labels prop tests ---

  it('uses default labels when no override is provided', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.prompt-text')?.textContent).toContain('Drag & drop');
    expect(root.shadowRoot?.querySelector('.divider-text')?.textContent).toBe('or');
    expect(root.shadowRoot?.querySelector('.url-submit-btn')?.textContent).toContain('Fetch');
  });

  it('overrides individual labels via the labels prop', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);

    (root as UploadElement).labels = {
      dropPromptText: 'Logo hierher ziehen',
      dividerText: 'oder',
      urlSubmit: 'Laden',
    };
    await waitForChanges();

    expect(root.shadowRoot?.querySelector('.prompt-text')?.textContent).toBe('Logo hierher ziehen');
    expect(root.shadowRoot?.querySelector('.divider-text')?.textContent).toBe('oder');
    expect(root.shadowRoot?.querySelector('.url-submit-btn')?.textContent).toContain('Laden');
  });

  it('falls back to defaults for unspecified label keys', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);

    (root as UploadElement).labels = { dividerText: 'oder' };
    await waitForChanges();

    expect(root.shadowRoot?.querySelector('.prompt-text')?.textContent).toContain('Drag & drop');
  });

  // --- CSS part attribute tests ---

  it('exposes part attributes for shadow-DOM theming', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('[part="root"]')).toBeTruthy();
    expect(root.shadowRoot?.querySelector('[part="url-input"]')).toBeTruthy();
    expect(root.shadowRoot?.querySelector('[part="url-submit-btn"]')).toBeTruthy();
    expect(root.shadowRoot?.querySelector('[part="divider"]')).toBeTruthy();
  });
});
