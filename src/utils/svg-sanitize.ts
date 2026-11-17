/**
 * Makes an uploaded SVG safe to put into the live document.
 *
 * An SVG shown through `<img>` or drawn onto a canvas is inert. Measuring one (`getBBox`,
 * `getComputedStyle`) needs it in the document, though, and there its content is live:
 * an HTML element smuggled in through the XHTML namespace runs its event handlers with
 * the host page's origin. Everything that mounts a customer's SVG therefore goes through
 * `sanitizeSvgForMount` first.
 *
 * The result is only meant for measuring. It is not what gets displayed or exported.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** SVG elements that run script, embed foreign content or fire events on a timeline. */
const BLOCKED_ELEMENTS = new Set(['script', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'discard', 'handler', 'listener']);

/**
 * True when CSS or an attribute value could make the browser fetch something: an
 * `@import`, an `image-set()`, or a `url()` that is not a reference into the same file. A backslash counts
 * too, because CSS escapes can spell both in ways a text scan does not see.
 */
function loadsExternalResource(value: string): boolean {
  if (value.includes('\\')) return true;
  if (/@import|image-set\(/i.test(value)) return true;
  return /url\(\s*(?!["']?\s*#)/i.test(value);
}

function isLocalReference(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('#') || /^data:image\/(png|jpeg|gif|webp|avif);/i.test(trimmed);
}

/**
 * Returns a sanitized copy of a parsed SVG, owned by the live document and ready to be
 * mounted, or null when the file refers to external resources through CSS — measuring
 * it would make the customer's file call out from the host page.
 *
 * `root` must still belong to the inert document `DOMParser` produced; it is left
 * untouched.
 */
export function sanitizeSvgForMount(root: Element): SVGSVGElement | null {
  if (root.namespaceURI !== SVG_NS || root.localName !== 'svg') return null;

  // Cloned inside the inert document, so nothing loads or runs while it is cleaned.
  const copy = root.cloneNode(true) as Element;

  for (const element of Array.from(copy.querySelectorAll('*'))) {
    if (element.namespaceURI !== SVG_NS || BLOCKED_ELEMENTS.has(element.localName)) element.remove();
  }

  for (const element of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
    if (element.localName === 'style' && loadsExternalResource(element.textContent ?? '')) return null;

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      // Editor metadata (inkscape:, sodipodi:, …) means nothing to the browser, and its
      // values — a Windows export path, say — must not trip the CSS check below.
      if (attribute.namespaceURI !== null && attribute.namespaceURI !== XLINK_NS) {
        element.removeAttributeNode(attribute);
      } else if (name.startsWith('on')) {
        element.removeAttributeNode(attribute);
      } else if (name === 'href' || name === 'src') {
        if (!isLocalReference(attribute.value)) element.removeAttributeNode(attribute);
      } else if (loadsExternalResource(attribute.value)) {
        return null;
      }
    }
  }

  return document.importNode(copy, true) as unknown as SVGSVGElement;
}
