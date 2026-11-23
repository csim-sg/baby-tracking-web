// SPEC-001 parity harness (issue #1).
//
// Drives the served PRODUCTION build into both content extremes through the
// real UI controls, then captures:
//   - computed styles for the fixed 23 selectors x fixed property list,
//     under screen media at widths 1280/820/819/560/559 and under print
//     media emulation, for 16x1 and 7x2
//   - full-page screenshots per width under screen media, plus one
//     print-media capture, per extreme
//   - browser-generated PDFs (preferCSSPageSize) with page count and
//     MediaBox parsed from the raw PDF bytes
//   - the print-emulated .paper rect
//   - a selector inventory covering every class token in
//     src/routes/index.tsx, including the dynamic fragments
//
// Every precondition (Chrome, server, selector presence, font readiness,
// PDF gate) fails the run loudly. A skipped or partial capture is a failed
// run: the capture document is written only after every step succeeded.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";
import {
  SELECTORS,
  PROPERTIES,
  WIDTHS,
  EXTREMES,
  DYNAMIC_FRAGMENTS,
  FONT_ASSERTIONS,
  PDF_EXPECTED,
  DEFAULT_BASE_URL,
  DEFAULT_FONT_TIMEOUT_MS,
  DEFAULT_SOURCE_FILE,
  SUMMARY_DIFF_LIMIT,
} from "./config.mjs";
import { parsePdfSummary } from "./pdfbytes.mjs";

export class ParityPreconditionError extends Error {
  constructor(category, message) {
    super(`PRECONDITION FAILURE [${category}]: ${message}`);
    this.name = "ParityPreconditionError";
    this.category = category;
  }
}

const VIEWPORT_HEIGHT = 900;

// ---------------------------------------------------------------------------
// Environment / preconditions
// ---------------------------------------------------------------------------

export function resolveBuildRef(explicit) {
  if (explicit) return explicit;
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

async function assertServerReachable(baseUrl) {
  let response;
  try {
    response = await fetch(baseUrl, { redirect: "follow" });
  } catch (error) {
    throw new ParityPreconditionError(
      "server",
      `no response from ${baseUrl} (${error.message}). ` +
        "Build and serve the production output first: npm ci && npm run build && npm run start",
    );
  }
  if (!response.ok) {
    throw new ParityPreconditionError(
      "server",
      `${baseUrl} answered HTTP ${response.status}; expected 200`,
    );
  }
}

async function launchBrowser(chromeExecutable) {
  const options = { headless: true };
  if (chromeExecutable) {
    options.executablePath = chromeExecutable;
  } else {
    // playwright-core never downloads a browser; channel "chrome" uses the
    // installed Google Chrome.
    options.channel = "chrome";
  }
  try {
    const browser = await chromium.launch(options);
    return browser;
  } catch (error) {
    throw new ParityPreconditionError(
      "Chrome",
      `could not launch Google Chrome (${chromeExecutable || "channel:chrome"}): ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Class-token extraction from src/routes/index.tsx
// ---------------------------------------------------------------------------

const CLASS_TOKEN_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function collectTokensFromChunk(chunk, tokens, stems) {
  // double- and single-quoted strings
  for (const m of chunk.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    for (const part of (m[1] ?? m[2] ?? "").split(/\s+/)) {
      if (CLASS_TOKEN_RE.test(part)) tokens.add(part);
    }
  }
  // template literals: static parts around ${...} interpolations
  for (const m of chunk.matchAll(/`([^`]*)`/g)) {
    for (const staticPart of m[1].split(/\$\{[^}]*\}/)) {
      for (const part of staticPart.split(/\s+/)) {
        if (/^-?[a-z][a-z0-9]*-*[a-z0-9-]*$/.test(part)) {
          if (part.endsWith("-")) {
            if (part.length > 1) stems.add(part);
          } else if (CLASS_TOKEN_RE.test(part)) {
            tokens.add(part);
          }
        }
      }
    }
  }
}

export function extractClassTokens(sourcePath) {
  if (!existsSync(sourcePath)) {
    throw new ParityPreconditionError(
      "source",
      `class-token source file not found: ${sourcePath}`,
    );
  }
  const source = readFileSync(sourcePath, "utf8");
  const tokens = new Set();
  const stems = new Set();
  // plain string attributes: className="..."
  for (const m of source.matchAll(/\bclassName="([^"]*)"/g)) {
    collectTokensFromChunk(`"${m[1]}"`, tokens, stems);
  }
  // expression attributes: className={...} (single line in this codebase)
  for (const m of source.matchAll(/\bclassName=\{(.*)\}/g)) {
    collectTokensFromChunk(m[1], tokens, stems);
  }
  return { tokens: [...tokens].sort(), stems: [...stems].sort() };
}

// ---------------------------------------------------------------------------
// In-page helpers (serialized into the browser)
// ---------------------------------------------------------------------------

function collectStylesInPage({ selectors, properties }) {
  const out = {};
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) {
      out[selector] = null;
      continue;
    }
    const cs = getComputedStyle(el);
    const styles = {};
    for (const prop of properties) styles[prop] = cs.getPropertyValue(prop).trim();
    out[selector] = styles;
  }
  return out;
}

function collectInventoryInPage({ tokens }) {
  const selectors = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) selectors.push(rule.selectorText);
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
    }
  };
  let sheets = 0;
  let skippedSheets = 0;
  for (const sheet of document.styleSheets) {
    sheets++;
    try {
      walk(sheet.cssRules);
    } catch {
      // cross-origin sheet (e.g. Google Fonts CSS) — no class selectors
      skippedSheets++;
    }
  }
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = tokens.map((token) => {
    const literalRe = new RegExp("\\." + escapeRe(token) + "(?![\\w-])");
    const literalResolved = selectors.some((s) => literalRe.test(s));
    const els = document.getElementsByClassName(token);
    let elementResolved = false;
    for (let i = 0; i < Math.min(els.length, 5); i++) {
      for (const sel of selectors) {
        let matched = false;
        try {
          matched = els[i].matches(sel);
        } catch {
          matched = false;
        }
        if (matched) {
          elementResolved = true;
          break;
        }
      }
      if (elementResolved) break;
    }
    return {
      token,
      literalResolved,
      elementResolved,
      elementCount: els.length,
    };
  });
  return {
    entries: result,
    emittedSelectorCount: selectors.length,
    sheets,
    skippedSheets,
  };
}

// ---------------------------------------------------------------------------
// UI driving
// ---------------------------------------------------------------------------

async function legendCount(page) {
  return page.evaluate(
    () => document.querySelectorAll(".legend-item").length,
  );
}

async function waitForLegendCount(page, expected, what) {
  try {
    await page.waitForFunction(
      (n) => document.querySelectorAll(".legend-item").length === n,
      expected,
      { timeout: 10000 },
    );
  } catch {
    throw new Error(
      `UI drive failed (${what}): item count never reached ${expected} ` +
        `(current ${await legendCount(page)})`,
    );
  }
}

async function addCustomItem(page, name) {
  await page.locator(".add-item input").first().fill(name);
  await page.locator(".icon-picker-trigger").click();
  await page
    .locator(".icon-picker-menu button[role='option']:not([disabled])")
    .first()
    .click();
  await page.locator(".add-item > button").click();
}

async function driveToExtreme(page, extreme) {
  // Select the day layout through the existing .choice button. For the 1-day
  // extreme this doubles as the hydration proof: the active class only moves
  // once React is handling clicks.
  await page.locator(".choice-row .choice").nth(extreme.days - 1).click();
  await page.waitForFunction(
    (idx) =>
      document.querySelectorAll(".choice-row .choice")[idx]?.classList.contains("active"),
    extreme.days - 1,
    { timeout: 10000 },
  );

  // Add items through the real controls until the target count is reached:
  // first unselected default chips, then custom items via the input, the
  // icon picker, and the Add button (never React state injection).
  let customs = 0;
  while ((await legendCount(page)) < extreme.items) {
    const chip = page
      .locator(".item-chip:not(.selected):not([disabled])")
      .first();
    if ((await chip.count()) > 0) {
      await chip.click();
    } else {
      customs += 1;
      await addCustomItem(page, `Custom item ${extreme.id}-${customs}`);
    }
  }
  await waitForLegendCount(page, extreme.items, `extreme ${extreme.id}`);

  // The icon-picker menu is one of the 23 selectors; it only exists while
  // open. Open it and keep it open so every capture sees the same state.
  await page.locator(".icon-picker-trigger").click();
  await page.waitForSelector(".icon-picker-menu");

  const actual = await page.evaluate(() => ({
    days: document.querySelectorAll(".print-day").length,
    items: document.querySelectorAll(".legend-item").length,
    rows: document.querySelector(".tracking-table tbody")?.children.length ?? 0,
  }));
  if (actual.days !== extreme.days || actual.items !== extreme.items) {
    throw new Error(
      `UI drive failed: expected ${extreme.days} day(s) x ${extreme.items} item(s), ` +
        `measured ${actual.days} day(s) x ${actual.items} item(s)`,
    );
  }
  if (actual.rows !== extreme.items) {
    throw new Error(
      `UI drive failed: tracking table has ${actual.rows} item rows, expected ${extreme.items}`,
    );
  }
  return actual;
}

function assertRequiredSelectors(page, selectors) {
  return page.evaluate((list) => {
    return list.filter((sel) => !document.querySelector(sel));
  }, selectors);
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

async function awaitFontsReady(page, timeoutMs) {
  if (!(timeoutMs > 0)) {
    throw new ParityPreconditionError(
      "font timeout",
      `PARITY_FONT_TIMEOUT_MS=${timeoutMs} does not allow waiting for document.fonts.ready`,
    );
  }
  let timer;
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ParityPreconditionError(
                "font timeout",
                `document.fonts.ready did not settle within ${timeoutMs}ms — webfonts did not load`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function assertFontState(page) {
  const state = await page.evaluate((assertions) => {
    return assertions.map((a) => {
      const el = document.querySelector(a.selector);
      return {
        selector: a.selector,
        expected: a.family,
        computed: el ? getComputedStyle(el).fontFamily : null,
        webfontLoaded: document.fonts.check(`${a.checkFont} "${a.family}"`),
      };
    });
  }, FONT_ASSERTIONS);
  for (const entry of state) {
    if (!entry.computed || !entry.computed.includes(entry.expected)) {
      throw new ParityPreconditionError(
        "font",
        `computed font-family of ${entry.selector} is ${entry.computed}, expected it to include "${entry.expected}"`,
      );
    }
    if (!entry.webfontLoaded) {
      throw new ParityPreconditionError(
        "font",
        `webfont "${entry.expected}" used by ${entry.selector} is not loaded (check network access to fonts.googleapis.com)`,
      );
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );

async function captureStyles(page, extreme, media, width, sinks) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.emulateMedia({ media });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const styles = await page.evaluate(collectStylesInPage, {
    selectors: SELECTORS,
    properties: PROPERTIES,
  });
  const missing = SELECTORS.filter((sel) => !styles[sel]);
  if (missing.length) {
    throw new Error(
      `capture failed: selector(s) missing while collecting styles (${media}, width ${width}): ${missing.join(", ")}`,
    );
  }
  for (const selector of SELECTORS) {
    sinks.captures.push({
      extreme: extreme.id,
      media,
      width,
      selector,
      styles: styles[selector],
    });
  }
  if (media === "screen") {
    const path = join(
      sinks.artifactsDir,
      `${extreme.id}-screen-w${width}.png`,
    );
    await page.screenshot({ path, fullPage: true });
    sinks.screenshots.push(path);
  }
}

async function capturePdf(page, extreme, sinks) {
  const pdfPath = join(sinks.artifactsDir, `${extreme.id}.pdf`);
  // Generate the PDF under print media, as a browser print does. (An
  // explicit screen-media emulation override leaks into page.pdf rendering
  // on Chrome 158 and would mis-render the print layout.) The pdf options
  // are exactly the SPEC-mandated preferCSSPageSize: true.
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await page.pdf({ path: pdfPath, preferCSSPageSize: true });
  const { pageCount, mediaBoxes } = parsePdfSummary(readFileSync(pdfPath));
  const box = mediaBoxes[0];
  if (pageCount !== PDF_EXPECTED.pageCount) {
    throw new Error(
      `PDF gate failed for ${extreme.id}: ${pageCount} page(s), expected exactly ${PDF_EXPECTED.pageCount} (MediaBox ${box.width} x ${box.height} pt)`,
    );
  }
  const dw = Math.abs(box.width - PDF_EXPECTED.mediaBoxWidthPt);
  const dh = Math.abs(box.height - PDF_EXPECTED.mediaBoxHeightPt);
  if (
    dw > PDF_EXPECTED.mediaBoxTolerancePt ||
    dh > PDF_EXPECTED.mediaBoxTolerancePt
  ) {
    throw new Error(
      `PDF gate failed for ${extreme.id}: MediaBox ${box.width} x ${box.height} pt, ` +
        `expected ${PDF_EXPECTED.mediaBoxWidthPt} x ${PDF_EXPECTED.mediaBoxHeightPt} pt ` +
        `±${PDF_EXPECTED.mediaBoxTolerancePt}pt`,
    );
  }
  sinks.pdfs[extreme.id] = { pageCount, mediaBox: box };
  sinks.pdfPaths.push(pdfPath);
}

function mergeInventory(runs) {
  const byToken = new Map();
  for (const run of runs) {
    for (const entry of run.entries) {
      const merged = byToken.get(entry.token) ?? {
        ...entry,
        elementResolved: false,
        elementCount: 0,
      };
      merged.literalResolved = merged.literalResolved || entry.literalResolved;
      merged.elementResolved =
        merged.elementResolved || entry.elementResolved;
      merged.elementCount =
        Math.max(merged.elementCount, 0) + entry.elementCount;
      byToken.set(entry.token, merged);
    }
  }
  const entries = [...byToken.values()].sort((a, b) =>
    a.token.localeCompare(b.token),
  );
  const unresolved = entries
    .filter((e) => !e.literalResolved && !e.elementResolved)
    .map((e) => e.token);
  const literallyAbsent = entries
    .filter((e) => !e.literalResolved)
    .map((e) => e.token);
  return { entries, unresolved, literallyAbsent };
}

/**
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.artifactsDir
 * @param {string} options.buildRef
 * @param {number} options.fontTimeoutMs
 * @param {string} [options.chromeExecutable]
 * @param {string} [options.sourceFile]
 * @param {string} [options.demoMissingSelector]
 */
export async function runCapture(options) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    artifactsDir,
    buildRef,
    fontTimeoutMs = DEFAULT_FONT_TIMEOUT_MS,
    chromeExecutable,
    sourceFile = DEFAULT_SOURCE_FILE,
    demoMissingSelector,
  } = options;

  const sinks = {
    artifactsDir,
    captures: [],
    screenshots: [],
    pdfPaths: [],
    pdfs: {},
    paperRects: {},
  };
  const inventoryRuns = [];
  let fontState = null;
  let inventoryMeta = null;
  let classStems = [];
  let inventoryTokens = [];

  await assertServerReachable(baseUrl);
  const browser = await launchBrowser(chromeExecutable);
  sinks.browserVersion = browser.version();
  try {
    const { tokens, stems } = extractClassTokens(
      resolve(sourceFile),
    );
    classStems = stems;
    // The required dynamic fragments are themselves class tokens rendered by
    // the app; include them in the inventory so each one must resolve
    // (literally in an emitted selector, or via an element it styles).
    inventoryTokens = [...new Set([...tokens, ...DYNAMIC_FRAGMENTS])].sort();
    const requiredSelectors = [...SELECTORS];
    if (demoMissingSelector) {
      // Demonstration hook: run the selector precondition against a selector
      // known not to exist, to show the fail-loud behaviour.
      requiredSelectors.push(demoMissingSelector);
    }

    for (const extreme of EXTREMES) {
      const context = await browser.newContext({
        viewport: { width: WIDTHS[0], height: VIEWPORT_HEIGHT },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.waitForSelector(".item-chips .item-chip");
        await driveToExtreme(page, extreme);

        const missing = await assertRequiredSelectors(page, requiredSelectors);
        if (missing.length) {
          throw new ParityPreconditionError(
            "selector",
            `selector(s) not found in the served page for extreme ${extreme.id}: ${missing.join(", ")}`,
          );
        }

        await awaitFontsReady(page, fontTimeoutMs);
        fontState = await assertFontState(page);

        const inv = await page.evaluate(collectInventoryInPage, {
          tokens: inventoryTokens,
        });
        inventoryRuns.push(inv);
        inventoryMeta = inv;

        await page.emulateMedia({ media: "screen" });
        for (const width of WIDTHS) {
          await captureStyles(page, extreme, "screen", width, sinks);
        }
        for (const width of WIDTHS) {
          await captureStyles(page, extreme, "print", width, sinks);
        }
        await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
        await page.emulateMedia({ media: "print" });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const printShot = join(sinks.artifactsDir, `${extreme.id}-print.png`);
        await page.screenshot({ path: printShot, fullPage: true });
        sinks.screenshots.push(printShot);
        sinks.paperRects[extreme.id] = {
          media: "print",
          width: 1280,
          ...(await page.evaluate(() => {
            const r = document
              .querySelector(".paper")
              .getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })),
        };
        await capturePdf(page, extreme, sinks);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const inventory = mergeInventory(inventoryRuns);
  inventory.emittedSelectorCount = inventoryMeta?.emittedSelectorCount ?? 0;
  inventory.sheets = inventoryMeta?.sheets ?? 0;
  inventory.skippedSheets = inventoryMeta?.skippedSheets ?? 0;
  inventory.stems = classStems;
  inventory.requiredDynamicFragments = DYNAMIC_FRAGMENTS;

  if (inventory.unresolved.length) {
    throw new Error(
      "selector inventory: unresolved class token(s) " +
        "(absent from every emitted selector and styling no element): " +
        inventory.unresolved.join(", "),
    );
  }

  const doc = {
    meta: {
      format: "parity-capture/1",
      capturedAtUtc: new Date().toISOString(),
      buildRef: resolveBuildRef(buildRef),
      baseUrl,
      browser: {
        engine: "chromium",
        channel: chromeExecutable ? "explicit-executable" : "chrome",
        version: sinks.browserVersion,
      },
      selectors: SELECTORS,
      properties: PROPERTIES,
      widths: WIDTHS,
      extremes: EXTREMES.map((e) => e.id),
      media: ["screen", "print"],
      fontTimeoutMs,
    },
    captures: sinks.captures,
    paperRects: sinks.paperRects,
    pdfs: sinks.pdfs,
    fonts: fontState,
    inventory,
  };
  sinks.inventory = inventory;
  sinks.fonts = fontState;
  return { doc, sinks };
}

// ---------------------------------------------------------------------------
// Document serialization
// ---------------------------------------------------------------------------

const indentBlock = (value) => JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");

/**
 * Serialize a capture document with one line per capture entry so later
 * baselines stay human-reviewable and diffable in git.
 */
export function serializeDocument(doc) {
  return (
    [
      "{",
      `  "meta": ${indentBlock(doc.meta)},`,
      "  \"captures\": [",
      doc.captures.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n"),
      "  ],",
      `  "paperRects": ${indentBlock(doc.paperRects)},`,
      `  "pdfs": ${indentBlock(doc.pdfs)},`,
      `  "fonts": ${indentBlock(doc.fonts)},`,
      `  "inventory": ${indentBlock(doc.inventory)}`,
      "}",
      "",
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Summary rendering
// ---------------------------------------------------------------------------

export function renderSummary({ mode, doc, baselineMeta, diff, artifactsDir }) {
  const lines = [];
  lines.push("PARITY RUN SUMMARY");
  lines.push(`mode:              ${mode}`);
  lines.push(`build commit:      ${doc.meta.buildRef}`);
  if (baselineMeta) {
    lines.push(`baseline ref:      ${baselineMeta.buildRef} (captured ${baselineMeta.capturedAtUtc})`);
  }
  lines.push(
    `browser:           Chromium ${doc.meta.browser.version} (channel: ${doc.meta.browser.channel})`,
  );
  lines.push(`server:            ${doc.meta.baseUrl}`);
  lines.push(`viewport widths:   ${doc.meta.widths.join(", ")}`);
  lines.push(`media:             ${doc.meta.media.join(" + ")}`);
  lines.push(
    `content extremes:  ${doc.meta.extremes.join(", ")} (${EXTREMES.map((e) => `${e.id} = ${e.days}d x ${e.items} items`).join("; ")})`,
  );
  lines.push(
    `matrix:            ${doc.meta.selectors.length} selectors (13 sheet + 10 chrome) x ${doc.meta.properties.length} properties -> ${doc.captures.length} entries`,
  );
  lines.push(
    `pdf gate:          ${Object.entries(doc.pdfs)
      .map(([k, v]) => `${k}: ${v.pageCount} page(s), MediaBox ${v.mediaBox.width} x ${v.mediaBox.height} pt`)
      .join("; ")}`,
  );
  lines.push(
    `paper rects:       ${Object.entries(doc.paperRects)
      .map(([k, v]) => `${k}: ${v.width} x ${v.height} px @ print`)
      .join("; ")}`,
  );
  lines.push(
    `fonts:             ${doc.fonts
      .map((f) => `${f.selector}=${f.expected} (loaded: ${f.webfontLoaded})`)
      .join("; ")}`,
  );
  lines.push(
    `selector inventory: ${doc.inventory.entries.length} tokens, unresolved: ${doc.inventory.unresolved.length}, ` +
      `literally absent (element-styled): ${doc.inventory.literallyAbsent.length ? doc.inventory.literallyAbsent.join(", ") : "none"}`,
  );
  if (diff) {
    lines.push(`differences:       ${diff.entries.length}`);
    const limited = diff.entries.slice(0, SUMMARY_DIFF_LIMIT);
    for (const entry of limited) {
      lines.push(
        `  - [${entry.kind}] ${entry.path}: baseline=${JSON.stringify(entry.baseline)} candidate=${JSON.stringify(entry.candidate)}`,
      );
    }
    if (diff.entries.length > limited.length) {
      lines.push(
        `  ... ${diff.entries.length - limited.length} more (full list in diff.json)`,
      );
    }
  } else {
    lines.push("differences:       n/a (capture mode)");
  }
  lines.push(`artifacts:         ${artifactsDir}`);
  return lines.join("\n");
}
