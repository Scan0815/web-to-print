import type { ArticleView, EditorState, PrintArea } from '../types/editor';
import type { LogoValidationIssue } from '../types/logo';
import { DEFAULT_DECORATION_ISSUE_LABELS, type DecorationIssueLabels } from '../types/labels';
import { printAreaToPixelCorners } from './canvas-helpers';

/** Axis-aligned bounds of a placed object, in canvas pixels. */
export interface ObjectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DecorationValidationInput {
  view: ArticleView;
  state: EditorState;
  /** Bounds of the objects currently on the canvas; empty when the view is not active. */
  bounds: ObjectBounds[];
  printArea: PrintArea | null;
  canvasWidth: number;
  canvasHeight: number;
  /** Overrides for the finding messages; missing keys fall back to English defaults. */
  labels?: Partial<DecorationIssueLabels>;
}

/** Half a pixel of slack so a perfectly fitted logo is not reported as overflowing. */
const OVERFLOW_TOLERANCE_PX = 0.5;

/**
 * Per-decoration checks. Everything is a warning: colour counts of arbitrary customer
 * logos cannot be measured reliably, and a hard block on an unreliable measurement
 * prevents legitimate orders. The shop decides whether a warning stops checkout.
 */
export function validateDecoration(input: DecorationValidationInput): LogoValidationIssue[] {
  const issues: LogoValidationIssue[] = [];
  const { view, state, bounds, printArea, canvasWidth, canvasHeight } = input;
  const labels: DecorationIssueLabels = { ...DEFAULT_DECORATION_ISSUE_LABELS, ...input.labels };

  const hasContent = state.logos.length > 0 || state.texts.length > 0;
  if (!hasContent) return issues;

  if (printArea != null && bounds.length > 0) {
    const corners = printAreaToPixelCorners(printArea, canvasWidth, canvasHeight);
    const minX = Math.min(...corners.map(c => c.x));
    const maxX = Math.max(...corners.map(c => c.x));
    const minY = Math.min(...corners.map(c => c.y));
    const maxY = Math.max(...corners.map(c => c.y));

    const overflowing = bounds.some(
      b =>
        b.left < minX - OVERFLOW_TOLERANCE_PX ||
        b.top < minY - OVERFLOW_TOLERANCE_PX ||
        b.left + b.width > maxX + OVERFLOW_TOLERANCE_PX ||
        b.top + b.height > maxY + OVERFLOW_TOLERANCE_PX,
    );

    if (overflowing) {
      issues.push({
        code: 'printAreaOverflow',
        severity: 'warning',
        message: labels.printAreaOverflow(view.label),
      });
    }
  }

  if (printArea == null && hasContent) {
    issues.push({
      code: 'missingPrintArea',
      severity: 'warning',
      message: labels.missingPrintArea(view.label),
    });
  }

  issues.push(...validateColours(view, state, labels));

  return issues;
}

function validateColours(view: ArticleView, state: EditorState, labels: DecorationIssueLabels): LogoValidationIssue[] {
  const maxColours = view.maxColours;
  if (maxColours === undefined || maxColours === 'full color') return [];

  const issues: LogoValidationIssue[] = [];
  const textColours = new Set(state.texts.map(t => t.fill.toLowerCase()));

  if (textColours.size > maxColours) {
    issues.push({
      code: 'colourLimit',
      severity: 'warning',
      message: labels.colourLimit(view.label, maxColours, textColours.size),
    });
  }

  // The colour count of an uploaded logo cannot be measured reliably, so for
  // single-colour methods (screen print, laser, embroidery) we ask instead of guess.
  if (maxColours === 1 && state.logos.length > 0) {
    issues.push({
      code: 'singleColourPrint',
      severity: 'warning',
      message: labels.singleColourPrint(view.label),
    });
  }

  return issues;
}
