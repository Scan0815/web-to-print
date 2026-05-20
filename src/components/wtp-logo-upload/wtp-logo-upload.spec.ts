import { newSpecPage } from '@stencil/core/testing';
import { WtpLogoUpload } from './wtp-logo-upload';

describe('wtp-logo-upload', () => {
  it('renders the upload zone', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const uploadZone = page.root?.shadowRoot?.querySelector('.upload-zone');
    expect(uploadZone).toBeTruthy();
  });

  it('renders the default prompt', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const promptText = page.root?.shadowRoot?.querySelector('.prompt-text');
    expect(promptText?.textContent).toContain('Drag & drop');
  });

  it('renders file input with correct accept attribute', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const input = page.root?.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe('image/png,image/jpeg,image/svg+xml,image/tiff,image/avif');
  });

  it('reflects the disabled state', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload disabled></wtp-logo-upload>',
    });

    const uploadZone = page.root?.shadowRoot?.querySelector('.upload-zone');
    expect(uploadZone?.classList.contains('disabled')).toBe(true);
  });

  it('supports multiple file upload', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload multiple></wtp-logo-upload>',
    });

    const input = page.root?.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it('renders slot for custom prompt', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload><span slot="prompt">Custom prompt</span></wtp-logo-upload>',
    });

    const slot = page.root?.shadowRoot?.querySelector('slot[name="prompt"]');
    expect(slot).toBeTruthy();
  });

  it('has accessible role and tabindex', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const uploadZone = page.root?.shadowRoot?.querySelector('.upload-zone');
    expect(uploadZone?.getAttribute('role')).toBe('button');
    expect(uploadZone?.getAttribute('tabindex')).toBe('0');
  });

  it('sets tabindex to -1 when disabled', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload disabled></wtp-logo-upload>',
    });

    const uploadZone = page.root?.shadowRoot?.querySelector('.upload-zone');
    expect(uploadZone?.getAttribute('tabindex')).toBe('-1');
  });

  // --- URL input tests ---

  it('renders URL input and submit button', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const urlInput = page.root?.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const submitBtn = page.root?.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement;
    expect(urlInput).toBeTruthy();
    expect(urlInput.type).toBe('url');
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.textContent).toContain('Fetch');
  });

  it('disables URL input when component is disabled', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload disabled></wtp-logo-upload>',
    });

    const urlInput = page.root?.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const submitBtn = page.root?.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement;
    expect(urlInput.disabled).toBe(true);
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders divider between URL input and drop zone', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const divider = page.root?.shadowRoot?.querySelector('.divider');
    const dividerText = page.root?.shadowRoot?.querySelector('.divider-text');
    expect(divider).toBeTruthy();
    expect(dividerText?.textContent).toBe('or');
  });

  // --- Background removal prop tests ---

  it('accepts enableBackgroundRemoval prop', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload enable-background-removal></wtp-logo-upload>',
    });

    expect(page.rootInstance.enableBackgroundRemoval).toBe(true);
  });

  it('does not show pending choices when bg-removal is disabled', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const pendingChoices = page.root?.shadowRoot?.querySelector('.pending-choices');
    expect(pendingChoices).toBeNull();
  });

  // --- Labels prop tests ---

  it('uses default labels when no override is provided', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const promptText = page.root?.shadowRoot?.querySelector('.prompt-text');
    const dividerText = page.root?.shadowRoot?.querySelector('.divider-text');
    const submitBtn = page.root?.shadowRoot?.querySelector('.url-submit-btn');
    expect(promptText?.textContent).toContain('Drag & drop');
    expect(dividerText?.textContent).toBe('or');
    expect(submitBtn?.textContent).toContain('Fetch');
  });

  it('overrides individual labels via the labels prop', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    (page.root as unknown as { labels: object }).labels = {
      dropPromptText: 'Logo hierher ziehen',
      dividerText: 'oder',
      urlSubmit: 'Laden',
    };
    await page.waitForChanges();

    const promptText = page.root?.shadowRoot?.querySelector('.prompt-text');
    const dividerText = page.root?.shadowRoot?.querySelector('.divider-text');
    const submitBtn = page.root?.shadowRoot?.querySelector('.url-submit-btn');
    expect(promptText?.textContent).toBe('Logo hierher ziehen');
    expect(dividerText?.textContent).toBe('oder');
    expect(submitBtn?.textContent).toContain('Laden');
  });

  it('falls back to defaults for unspecified label keys', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    (page.root as unknown as { labels: object }).labels = { dividerText: 'oder' };
    await page.waitForChanges();

    const promptText = page.root?.shadowRoot?.querySelector('.prompt-text');
    expect(promptText?.textContent).toContain('Drag & drop');
  });

  // --- CSS part attribute tests ---

  it('exposes part attributes for shadow-DOM theming', async () => {
    const page = await newSpecPage({
      components: [WtpLogoUpload],
      html: '<wtp-logo-upload></wtp-logo-upload>',
    });

    const root = page.root?.shadowRoot?.querySelector('[part="root"]');
    const urlInput = page.root?.shadowRoot?.querySelector('[part="url-input"]');
    const submitBtn = page.root?.shadowRoot?.querySelector('[part="url-submit-btn"]');
    const divider = page.root?.shadowRoot?.querySelector('[part="divider"]');
    expect(root).toBeTruthy();
    expect(urlInput).toBeTruthy();
    expect(submitBtn).toBeTruthy();
    expect(divider).toBeTruthy();
  });
});
