import { describe, it, expect, beforeEach } from '@stencil/vitest';
import { sanitizeSvgForMount } from './svg-sanitize';
import { trimSvgWhitespace } from './canvas-helpers';
import { prepareSvgLogo } from './pdf-vector';

interface ProbeWindow {
  __svgProbe?: string;
}

const probe = (): string | undefined => (window as unknown as ProbeWindow).__svgProbe;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Long enough for the unsanitized control below to fire, with a wide margin. */
const SETTLE_MS = 600;

const HIT = "window.__svgProbe='hit'";

/** The viewBox matches the artwork, so trimming has nothing to change. */
const wrap = (inner: string, rootAttributes = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="10 10 80 80" width="80" height="80" ${rootAttributes}>` +
  `<rect x="10" y="10" width="80" height="80" fill="#cc0000"/>${inner}</svg>`;

/** Markup that runs script once it sits in a live document. */
const ACTIVE: Record<string, string> = {
  'an XHTML img': wrap(`<h:img src="data:,x" onerror="${HIT}"/>`),
  'an XHTML video source': wrap(`<h:video><h:source src="data:,x" onerror="${HIT}"/></h:video>`),
  'an XHTML audio': wrap(`<h:audio src="data:,x" onerror="${HIT}"/>`),
  'an XHTML style': wrap(`<h:style onload="${HIT}">a{}</h:style>`),
  'an XHTML link': wrap(`<h:link rel="stylesheet" href="data:,x" onerror="${HIT}" onload="${HIT}"/>`),
  'an SVG image': wrap(`<image href="data:,x" width="1" height="1" onerror="${HIT}"/>`),
};

const parse = (svg: string): Element => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
const toDataUrl = (svg: string): string => 'data:image/svg+xml;base64,' + btoa(svg);

function mount(element: Element): void {
  const host = document.createElement('div');
  host.appendChild(element);
  document.body.appendChild(host);
  host.remove();
}

beforeEach(() => {
  delete (window as unknown as ProbeWindow).__svgProbe;
});

describe('sanitizeSvgForMount', () => {
  it('control: the test markup does run when mounted unsanitized', async () => {
    mount(document.importNode(parse(ACTIVE['an XHTML img']), true));
    await wait(SETTLE_MS);
    expect(probe()).toBe('hit');
  });

  for (const [name, svg] of Object.entries(ACTIVE)) {
    it(`keeps ${name} from running`, async () => {
      const clean = sanitizeSvgForMount(parse(svg));
      expect(clean).not.toBeNull();
      mount(clean as SVGSVGElement);
      await wait(SETTLE_MS);
      expect(probe()).toBeUndefined();
    });
  }

  it('removes foreign elements, scripts, animations and event handlers', () => {
    const clean = sanitizeSvgForMount(
      parse(wrap(`<h:iframe srcdoc="x"/><script>${HIT}</script><foreignObject><h:b>x</h:b></foreignObject><set attributeName="x" to="1" onbegin="${HIT}"/><circle r="5" onclick="${HIT}"/>`, `onload="${HIT}"`)),
    ) as SVGSVGElement;

    expect(Array.from(clean.querySelectorAll('*')).map(e => e.localName)).toEqual(['rect', 'circle']);
    expect(clean.getAttribute('onload')).toBeNull();
    expect(clean.querySelector('circle')?.getAttribute('onclick')).toBeNull();
  });

  it('drops links to other files but keeps references into the same file', () => {
    const clean = sanitizeSvgForMount(
      parse(wrap('<defs><path id="p" d="M0 0h5v5z"/></defs><use href="#p"/><use xlink:href="https://example.com/a.svg#x"/><image href="https://example.com/a.png" width="1" height="1"/>')),
    ) as SVGSVGElement;

    const uses = Array.from(clean.querySelectorAll('use'));
    expect(uses[0].getAttribute('href')).toBe('#p');
    expect(uses[1].hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(false);
    expect(clean.querySelector('image')?.hasAttribute('href')).toBe(false);
  });

  it('refuses CSS that would fetch something', () => {
    expect(sanitizeSvgForMount(parse(wrap('<style>@import "https://example.com/a.css";</style>')))).toBeNull();
    expect(sanitizeSvgForMount(parse(wrap('<style>rect{fill:url(https://example.com/a.svg#g)}</style>')))).toBeNull();
    expect(sanitizeSvgForMount(parse(wrap('<style>rect{fill:\\75rl(https://example.com/a.svg#g)}</style>')))).toBeNull();
    expect(sanitizeSvgForMount(parse(wrap('<circle r="5" style="fill:url(\'https://example.com/a.svg#g\')"/>')))).toBeNull();
    expect(sanitizeSvgForMount(parse(wrap('<style>svg{background:image-set("https://example.com/a.png" 1x)}</style>')))).toBeNull();
  });

  it('keeps plain styling and same-file paint references', () => {
    const clean = sanitizeSvgForMount(
      parse(wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><style>.a{fill:url(#g)}</style><circle class="a" r="5" fill="url(\'#g\')" style="stroke:url( #g )"/>')),
    );
    expect(clean?.querySelector('style')?.textContent).toBe('.a{fill:url(#g)}');
    expect(clean?.querySelector('circle')?.getAttribute('fill')).toBe("url('#g')");
  });

  it('accepts the metadata an editor export carries', async () => {
    // Shaped like an Inkscape export saved on Windows; written by hand, not a real file.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
      'viewBox="0 0 200 200" xml:space="preserve" sodipodi:docname="logo.svg" inkscape:export-filename="C:\\Users\\me\\logo.png">' +
      '<sodipodi:namedview id="nv" pagecolor="#ffffff"/><g inkscape:label="Layer 1" inkscape:groupmode="layer"><rect x="50" y="60" width="40" height="20" style="fill:#0000ff"/></g></svg>';

    const clean = sanitizeSvgForMount(parse(svg));
    expect(clean?.querySelector('rect')).not.toBeNull();

    const trimmed = atob((await trimSvgWhitespace(toDataUrl(svg))).split(',')[1]);
    expect(trimmed).toContain('viewBox="49 59 42 22"');
    expect(trimmed).toContain('inkscape:export-filename');

    expect(await prepareSvgLogo({ dataUrl: toDataUrl(svg), fileName: 'logo.svg' })).not.toBeNull();
  });

  it('leaves the parsed original untouched', () => {
    const original = parse(ACTIVE['an XHTML img']);
    sanitizeSvgForMount(original);
    expect(original.querySelector('*|img')).not.toBeNull();
  });

  it('refuses a root that is not an SVG', () => {
    expect(sanitizeSvgForMount(parse('<h:html xmlns:h="http://www.w3.org/1999/xhtml"><h:body/></h:html>'))).toBeNull();
  });
});

describe('trimSvgWhitespace with hostile SVG', () => {
  for (const [name, svg] of Object.entries(ACTIVE)) {
    it(`does not run ${name}`, async () => {
      await trimSvgWhitespace(toDataUrl(svg));
      await wait(SETTLE_MS);
      expect(probe()).toBeUndefined();
    });
  }

  it('does not run markup when the viewBox needs trimming either', async () => {
    await trimSvgWhitespace(toDataUrl(ACTIVE['an XHTML img'].replace('viewBox="10 10 80 80"', 'viewBox="0 0 200 200"')));
    await wait(SETTLE_MS);
    expect(probe()).toBeUndefined();
  });

  it('still trims an ordinary SVG and keeps its stylesheet', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>.a{fill:#00f}</style><rect class="a" x="50" y="60" width="40" height="20"/></svg>';
    const trimmed = atob((await trimSvgWhitespace(toDataUrl(svg))).split(',')[1]);
    expect(trimmed).toContain('viewBox="49 59 42 22"');
    expect(trimmed).toContain('.a{fill:#00f}');
  });

  it('does not let the stylesheet of the SVG restyle the host page', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>body{outline:7px solid red}</style><rect x="50" y="60" width="40" height="20"/></svg>';
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(getComputedStyle(document.body).outlineWidth));
    observer.observe(document.body, { childList: true });
    await trimSvgWhitespace(toDataUrl(svg));
    await wait(50);
    observer.disconnect();
    expect(seen).not.toContain('7px');
  });

  it('leaves an SVG with external CSS untrimmed', async () => {
    const url = toDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>@import "https://example.com/a.css";</style><rect x="50" y="60" width="40" height="20"/></svg>');
    expect(await trimSvgWhitespace(url)).toBe(url);
  });
});

describe('prepareSvgLogo with hostile SVG', () => {
  for (const [name, svg] of Object.entries(ACTIVE)) {
    // The converter refuses <image> before anything is mounted.
    const refused = name === 'an SVG image';

    it(`does not run ${name}`, async () => {
      const logo = await prepareSvgLogo({ dataUrl: toDataUrl(svg), fileName: 'logo.svg' });
      await wait(SETTLE_MS);
      expect(probe()).toBeUndefined();
      if (refused) expect(logo).toBeNull();
      else expect(logo?.svg).toContain('<rect');
    });
  }

  it('falls back to the raster for an SVG with external CSS', async () => {
    const logo = await prepareSvgLogo({ dataUrl: toDataUrl(wrap('<style>@import "https://example.com/a.css";</style>')), fileName: 'logo.svg' });
    expect(logo).toBeNull();
  });
});
