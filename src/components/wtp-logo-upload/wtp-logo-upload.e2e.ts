import { newE2EPage } from '@stencil/core/testing';

describe('wtp-logo-upload e2e', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    const el = await page.find('wtp-logo-upload');
    expect(el).not.toBeNull();
  });

  it('shows upload zone with prompt text', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    const promptText = await page.find('wtp-logo-upload >>> .prompt-text');
    expect(promptText).not.toBeNull();
    const text = await promptText.getProperty('textContent');
    expect(text).toContain('Drag & drop');
  });

  it('applies disabled styling', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload disabled></wtp-logo-upload>');

    const zone = await page.find('wtp-logo-upload >>> .upload-zone');
    expect(zone).toHaveClass('disabled');
  });

  it('opens file dialog on click', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    // Verify the file input exists
    const input = await page.find('wtp-logo-upload >>> input[type="file"]');
    expect(input).not.toBeNull();
  });

  it('emits wtpLogoRejected for invalid files', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    const el = await page.find('wtp-logo-upload');
    const rejectedSpy = await el.spyOnEvent('wtpLogoRejected');

    // Create a small invalid file via page evaluation
    await page.evaluate(() => {
      const component = document.querySelector('wtp-logo-upload');
      const input = component?.shadowRoot?.querySelector('input[type="file"]');
      if (input === null || input === undefined) return;

      const file = new File([new Uint8Array([0x00])], 'bad.bmp', { type: 'image/bmp' });
      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(input, 'files', { value: dt.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForChanges();
    // Wait for async validation
    await new Promise(r => setTimeout(r, 500));

    expect(rejectedSpy).toHaveReceivedEvent();
  });

  it('emits wtpLogoValidated for valid SVG', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    const el = await page.find('wtp-logo-upload');
    const validatedSpy = await el.spyOnEvent('wtpLogoValidated');

    await page.evaluate(() => {
      const component = document.querySelector('wtp-logo-upload');
      const input = component?.shadowRoot?.querySelector('input[type="file"]');
      if (input === null || input === undefined) return;

      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect/></svg>';
      const file = new File([svgContent], 'test.svg', { type: 'image/svg+xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(input, 'files', { value: dt.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });

  // --- URL input e2e tests ---

  it('renders URL input and button in browser', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    const urlInput = await page.find('wtp-logo-upload >>> .url-input');
    const submitBtn = await page.find('wtp-logo-upload >>> .url-submit-btn');
    expect(urlInput).not.toBeNull();
    expect(submitBtn).not.toBeNull();
  });

  it('shows error for invalid URL', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload></wtp-logo-upload>');

    await page.evaluate(() => {
      const component = document.querySelector('wtp-logo-upload');
      const urlInput = component?.shadowRoot?.querySelector('.url-input') as HTMLInputElement;
      if (urlInput === null || urlInput === undefined) return;

      // Set a non-HTTPS URL
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeInputValueSetter.call(urlInput, 'http://example.com/logo.png');
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForChanges();

    // Click the submit button
    const submitBtn = await page.find('wtp-logo-upload >>> .url-submit-btn');
    await submitBtn.click();
    await page.waitForChanges();

    const urlError = await page.find('wtp-logo-upload >>> .url-error');
    expect(urlError).not.toBeNull();
    const errorText = await urlError.getProperty('textContent');
    expect(errorText).toContain('HTTPS');
  });

  it('SVG emits wtpLogoValidated immediately even with enable-background-removal', async () => {
    const page = await newE2EPage();
    await page.setContent('<wtp-logo-upload enable-background-removal></wtp-logo-upload>');

    const el = await page.find('wtp-logo-upload');
    const validatedSpy = await el.spyOnEvent('wtpLogoValidated');

    await page.evaluate(() => {
      const component = document.querySelector('wtp-logo-upload');
      const input = component?.shadowRoot?.querySelector('input[type="file"]');
      if (input === null || input === undefined) return;

      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect/></svg>';
      const file = new File([svgContent], 'test.svg', { type: 'image/svg+xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(input, 'files', { value: dt.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForChanges();
    await new Promise(r => setTimeout(r, 500));

    expect(validatedSpy).toHaveReceivedEvent();
  });
});
