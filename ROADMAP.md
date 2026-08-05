# Roadmap

Planned and deliberately deferred work for `web-to-print`. Shipped milestones are
at the bottom; everything above the line is not yet built.

The multi-decoration editor (0.2.0) is complete and documented in
[`docs/specs/multi-decoration-editor.md`](docs/specs/multi-decoration-editor.md);
its §9 and §13 are the source of most items below.

## Follow-ups

### Server-side print PDF — the real print output
_Spec §9. The current proof PDF is a placement reference, not print data._

The proof PDF is browser-generated RGB with no bleed, crop marks, or spot colours, and
it rasterizes SVG/PDF/AI. Real print output needs a server step:

- Headless Chromium `print-to-PDF` renders SVG natively as vector and embeds fonts —
  the two things `svg2pdf.js` fails at. Combined with Fabric's `canvas.toSVG()` the
  mockup pages become vector too.
- This is the only path that can reach CMYK, spot colours, bleed, and crop marks —
  which is why `maxColours` already lives in the data.
- `pdf-lib` is the intermediate option if 1:1 embedding of an uploaded PDF/AI page or
  file attachments become required before a backend exists (jsPDF cannot embed either).

Sequencing note from the spec: swapping the PDF library and rebuilding the editor at the
same time means two suspects per bug — hence this was kept out of 0.2.0.

### EPS upload support
_Spec §9. Out of scope for 0.2.0 (client-only)._

EPS is not renderable in the browser and needs Ghostscript server-side. It arrives with
the server-side render step above. Today EPS is rejected; `.ai` files are accepted only
when saved with PDF compatibility.

### TIFF / AVIF in the proof PDF
_Known limitation surfaced during the 0.2.0 review._

The 0.2.0 fix makes the logo source page embed a rasterized PNG for PDF/AI originals
(whose canvas representation is already a PNG). TIFF and AVIF originals, however, keep
their raw data URL as the canvas representation, and jsPDF cannot embed those either —
so a TIFF/AVIF logo would hit the same "invalid PNG" failure the PDF/AI fix closed.
This is pre-existing (both formats predate 0.2.0) and untriggered by the demo, but it
should be closed the same way: rasterize any non-PNG/JPEG/SVG source to a PNG before
embedding. The server-side render step would also cover it.

### Blob vs. data URLs in the persisted envelope
_Spec §13 open question. No version impact._

`ArticleEditorState` currently uses data URLs. IndexedDB stores `Blob` natively and
avoids the ~33% base64 overhead; at 4 views with full-resolution previews the payload
reaches several MB. A `Blob`-based export variant can be added without a version bump
since it only affects the consumer's storage layer.

### Shop-payload → `ArticleView` adapter in the library
_Spec §13 open question. Only when a second consumer appears._

The mapping from the raw shop payload to `ArticleView[]` (documented in spec §3.1a and
demonstrated in `src/product-detail.html`) is currently the host's job. If a second
consumer needs it, promote it to an exported adapter so both share one implementation.

### Toolchain upgrades held back deliberately
_Spec §10._

- **Jest 30 is impossible** while on `@stencil/core` 4.43 — it ships adapters for jest
  27/28/29 only. (The suite already runs on Vitest; this note is about not reintroducing
  a Jest path.)
- **ESLint 10, Puppeteer 25** are feasible but belong in their own commit — Puppeteer
  drives the e2e coverage of the Fabric canvas, so a bump there wants an isolated,
  bisectable change.

---

## Shipped

### 0.2.0 — Multi-decoration editor
One `wtp-editor` edits every decoration (Veredelung) of an article; v2
`ArticleEditorState` envelope; per-decoration validation; proof PDF covering all designed
decorations; PDF/AI logo upload keeping the original for the print shop; decoration strip
with tooltips; catalog-to-editor logo flow; a shop-style demo detail page over the real
connect-shop payload. See the spec for the full scope and its §14 deviations.
