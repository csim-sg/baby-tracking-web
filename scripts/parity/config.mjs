// Fixed parity matrix for SPEC-001 / issue #1.
//
// The selector list, property list, widths, and content extremes below are
// authoritative (SPEC-001 § Testing Strategy; issue #1 Tech-Lead Guardrails).
// Adding, dropping, or substituting entries here to make a run pass is a
// spec change, not a fix. Numeric tolerance must never be widened.

/**
 * Exactly 23 selectors: 13 sheet + 10 chrome, in SPEC-001's enumeration
 * order. Captured under both `screen` and `print` media emulation.
 */
export const SELECTORS = [
  // 13 sheet selectors
  ".paper",
  ".print-day",
  ".print-head",
  ".print-date",
  ".item-legend",
  ".legend-item",
  ".tracking-table",
  ".table-corner",
  ".corner-diagonal",
  ".time-heading",
  ".item-heading",
  ".tracking-cell",
  ".item-row-icon",
  // 10 chrome selectors
  ".app-shell",
  ".builder-grid",
  ".topbar",
  ".hero h1",
  ".choice",
  ".item-chip",
  ".add-item input",
  ".icon-picker-trigger",
  ".icon-picker-menu",
  ".preview-footer button",
];

/**
 * Fixed property list (SPEC-001 § Testing Strategy, computed-style parity):
 * box metrics, padding, margin, border width/style/colour, border-collapse,
 * border-spacing, background, colour, font family/size/weight/line-height/
 * letter-spacing, display, position, gap, grid/flex geometry, aspect-ratio,
 * container-type, transform, z-index, box-shadow, opacity, overflow,
 * print-color-adjust, writing-mode.
 */
export const PROPERTIES = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-collapse",
  "border-spacing",
  "background-color",
  "background-image",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "aspect-ratio",
  "container-type",
  "transform",
  "z-index",
  "box-shadow",
  "opacity",
  "overflow",
  "print-color-adjust",
  "writing-mode",
];

/** Screen widths (CSS px) required for screenshots and computed styles. */
export const WIDTHS = [1280, 820, 819, 560, 559];

/** Both boundary configurations the item/day limits allow. */
export const EXTREMES = [
  { id: "16x1", days: 1, items: 16 },
  { id: "7x2", days: 2, items: 7 },
];

/**
 * Class tokens rendered dynamically from src/routes/index.tsx. The selector
 * inventory must resolve every one of these (issue guardrail).
 */
export const DYNAMIC_FRAGMENTS = [
  "tint-0",
  "tint-1",
  "tint-2",
  "tint-3",
  "tint-4",
  "two-days",
  "active",
  "selected",
];

/**
 * Targeted font assertions (issue AC: hero-heading and sheet-legend-item
 * font-family assertions). `.hero h1` uses Nunito via the `font` shorthand;
 * `.legend-item` inherits "DM Sans" from `:root`. The Google Fonts import
 * loads Nunito at weights 700/800/900 and DM Sans at 400–700, so the
 * load check uses a weight that is actually imported for each family.
 */
export const FONT_ASSERTIONS = [
  { selector: ".hero h1", family: "Nunito", checkFont: "900 16px" },
  { selector: ".legend-item", family: "DM Sans", checkFont: "400 16px" },
];

/** Mechanical PDF gate (SPEC-001, AC-08): one A4 landscape page. */
export const PDF_EXPECTED = {
  pageCount: 1,
  mediaBoxWidthPt: 841.92,
  mediaBoxHeightPt: 594.96,
  mediaBoxTolerancePt: 0.5,
};

/** Print-emulated `.paper` rect tolerance vs baseline (SPEC-001 AC-08). */
export const PAPER_RECT_TOLERANCE_PX = 1;

/**
 * Style comparison epsilon for float values, in px. Formatting tolerance
 * only — any larger delta is a finding. Never widen (SPEC-001).
 */
export const STYLE_EPSILON_PX = 0.01;

/** How many differences the run summary prints in full. */
export const SUMMARY_DIFF_LIMIT = 20;

export const DEFAULT_FONT_TIMEOUT_MS = 15000;
export const DEFAULT_BASE_URL = "http://localhost:3000";
export const DEFAULT_BASELINE_PATH = "scripts/parity/baseline/baseline.json";
export const DEFAULT_SOURCE_FILE = "src/routes/index.tsx";
