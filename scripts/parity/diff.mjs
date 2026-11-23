// Compare a capture document against the committed baseline.
//
// Tolerances are fixed by SPEC-001 and must never be widened:
//   - computed style floats: ±0.01px (formatting epsilon only)
//   - print-emulated .paper rect: ±1px
//   - PDF MediaBox: ±0.5pt, page count exact
// Everything else compares as an exact string. Missing or extra capture
// entries are structural failures — a reduced matrix can never pass.

import {
  STYLE_EPSILON_PX,
  PAPER_RECT_TOLERANCE_PX,
  PDF_EXPECTED,
} from "./config.mjs";

const PX_RE = /^-?\d+(?:\.\d+)?px$/;

function styleValueDiffers(a, b) {
  const aPx = PX_RE.test(a);
  const bPx = PX_RE.test(b);
  if (aPx && bPx) {
    return Math.abs(parseFloat(a) - parseFloat(b)) > STYLE_EPSILON_PX;
  }
  return a !== b;
}

function captureKey(entry) {
  return `${entry.extreme}|${entry.media}|w${entry.width}|${entry.selector}`;
}

/**
 * @param {object} baseline committed baseline document
 * @param {object} candidate freshly captured document
 * @returns {{entries: Array<object>, counts: object<string, number>}}
 */
export function diffDocuments(baseline, candidate) {
  const entries = [];

  // Matrix shape must be identical (guards a reduced selector/property set).
  for (const field of [
    "selectors",
    "properties",
    "widths",
    "extremes",
    "media",
  ]) {
    const a = JSON.stringify(baseline.meta?.[field] ?? null);
    const b = JSON.stringify(candidate.meta?.[field] ?? null);
    if (a !== b) {
      entries.push({
        kind: "structure",
        path: `meta.${field}`,
        baseline: a,
        candidate: b,
      });
    }
  }

  const baseByKey = new Map(
    (baseline.captures ?? []).map((e) => [captureKey(e), e]),
  );
  const candByKey = new Map(
    (candidate.captures ?? []).map((e) => [captureKey(e), e]),
  );

  for (const [key, base] of baseByKey) {
    const cand = candByKey.get(key);
    if (!cand) {
      entries.push({ kind: "missing-entry", path: key });
      continue;
    }
    const props = new Set([
      ...Object.keys(base.styles ?? {}),
      ...Object.keys(cand.styles ?? {}),
    ]);
    for (const prop of props) {
      const a = base.styles?.[prop];
      const b = cand.styles?.[prop];
      if (a === undefined || b === undefined) {
        entries.push({
          kind: "property",
          path: `${key}|${prop}`,
          baseline: a ?? "<missing>",
          candidate: b ?? "<missing>",
        });
      } else if (styleValueDiffers(a, b)) {
        entries.push({
          kind: "style",
          path: `${key}|${prop}`,
          baseline: a,
          candidate: b,
        });
      }
    }
  }
  for (const key of candByKey.keys()) {
    if (!baseByKey.has(key)) {
      entries.push({ kind: "extra-entry", path: key });
    }
  }

  // Print-emulated .paper rect (±1px per coordinate).
  const baseRects = baseline.paperRects ?? {};
  const candRects = candidate.paperRects ?? {};
  for (const extreme of new Set([
    ...Object.keys(baseRects),
    ...Object.keys(candRects),
  ])) {
    const a = baseRects[extreme];
    const b = candRects[extreme];
    if (!a || !b) {
      entries.push({
        kind: "paper-rect",
        path: `paperRects.${extreme}`,
        baseline: a ? "present" : "<missing>",
        candidate: b ? "present" : "<missing>",
      });
      continue;
    }
    for (const coord of ["x", "y", "width", "height"]) {
      if (Math.abs((a[coord] ?? 0) - (b[coord] ?? 0)) > PAPER_RECT_TOLERANCE_PX) {
        entries.push({
          kind: "paper-rect",
          path: `paperRects.${extreme}.${coord}`,
          baseline: a[coord],
          candidate: b[coord],
          tolerance: PAPER_RECT_TOLERANCE_PX,
        });
      }
    }
  }

  // Mechanical PDF gate: page count exact, MediaBox ±0.5pt.
  const basePdfs = baseline.pdfs ?? {};
  const candPdfs = candidate.pdfs ?? {};
  for (const extreme of new Set([
    ...Object.keys(basePdfs),
    ...Object.keys(candPdfs),
  ])) {
    const a = basePdfs[extreme];
    const b = candPdfs[extreme];
    if (!a || !b) {
      entries.push({
        kind: "pdf",
        path: `pdfs.${extreme}`,
        baseline: a ? "present" : "<missing>",
        candidate: b ? "present" : "<missing>",
      });
      continue;
    }
    if (a.pageCount !== b.pageCount) {
      entries.push({
        kind: "pdf",
        path: `pdfs.${extreme}.pageCount`,
        baseline: a.pageCount,
        candidate: b.pageCount,
      });
    }
    for (const dim of ["width", "height"]) {
      const expected =
        dim === "width"
          ? PDF_EXPECTED.mediaBoxWidthPt
          : PDF_EXPECTED.mediaBoxHeightPt;
      for (const [label, value] of [
        ["baseline", a.mediaBox?.[dim]],
        ["candidate", b.mediaBox?.[dim]],
      ]) {
        if (
          typeof value !== "number" ||
          Math.abs(value - expected) > PDF_EXPECTED.mediaBoxTolerancePt
        ) {
          entries.push({
            kind: "pdf",
            path: `pdfs.${extreme}.mediaBox.${dim}`,
            baseline: a.mediaBox?.[dim],
            candidate: b.mediaBox?.[dim],
            note: `expected ${expected}pt ±${PDF_EXPECTED.mediaBoxTolerancePt} (${label} out of tolerance)`,
          });
        }
      }
    }
  }

  // Any unresolved class token in the candidate inventory fails the run.
  const unresolved = candidate.inventory?.unresolved ?? [];
  for (const token of unresolved) {
    entries.push({
      kind: "inventory",
      path: `inventory.unresolved.${token}`,
      baseline: "",
      candidate: token,
      note: "class token resolves to no emitted rule and styles no element",
    });
  }

  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return { entries, counts };
}
