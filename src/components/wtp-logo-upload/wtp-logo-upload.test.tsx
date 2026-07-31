import { render, h, describe, it, expect } from '@stencil/vitest';

/** Feeds a file into the component's hidden file input, as a real upload would. */
function selectFile(root: HTMLElement, file: File): void {
  const input = root.shadowRoot?.querySelector('input[type="file"]');
  if (input == null) return;

  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect/></svg>';

describe('wtp-logo-upload browser', () => {
  it('renders', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root).not.toBeNull();
  });

  it('shows upload zone with prompt text', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const promptText = root.shadowRoot?.querySelector('.prompt-text');
    expect(promptText).not.toBeNull();
    expect(promptText?.textContent).toContain('Drag & drop');
  });

  it('applies disabled styling', async () => {
    const { root } = await render(<wtp-logo-upload disabled></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.upload-zone')?.classList.contains('disabled')).toBe(true);
  });

  it('opens file dialog on click', async () => {
    const { root } = await render(<wtp-logo-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('emits wtpLogoRejected for invalid files', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const rejectedSpy = spyOnEvent('wtpLogoRejected');

    selectFile(root, new File([new Uint8Array([0x00])], 'bad.bmp', { type: 'image/bmp' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(rejectedSpy).toHaveReceivedEvent();
  });

  it('emits wtpLogoValidated for valid SVG', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });

  // --- URL input tests ---

  it('renders URL input and button in browser', async () => {
    const { root } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);
    expect(root.shadowRoot?.querySelector('.url-input')).not.toBeNull();
    expect(root.shadowRoot?.querySelector('.url-submit-btn')).not.toBeNull();
  });

  it('shows error for invalid URL', async () => {
    const { root, waitForChanges } = await render(<wtp-logo-upload allow-url-upload></wtp-logo-upload>);

    const urlInput = root.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    nativeInputValueSetter.call(urlInput, 'http://example.com/logo.png');
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChanges();

    (root.shadowRoot?.querySelector('.url-submit-btn') as HTMLButtonElement).click();
    await waitForChanges();

    const urlError = root.shadowRoot?.querySelector('.url-error');
    expect(urlError).not.toBeNull();
    expect(urlError?.textContent).toContain('HTTPS');
  });

  it('SVG emits wtpLogoValidated immediately even with enable-background-removal', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<wtp-logo-upload enable-background-removal></wtp-logo-upload>);
    const validatedSpy = spyOnEvent('wtpLogoValidated');

    selectFile(root, new File([VALID_SVG], 'test.svg', { type: 'image/svg+xml' }));

    await waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });
});
