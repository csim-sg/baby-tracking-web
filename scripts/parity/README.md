# SPEC-001 parity harness

Re-runnable, fail-loud measure of visual and print equivalence for the
styling migration (SPEC-001, issue #1). It drives the **served production
build** (never the dev server) into both content extremes through the real
UI controls, and captures:

- **Computed styles** — the fixed 23 selectors (13 sheet + 10 chrome, see
  `config.mjs`) × the fixed property list, under `screen` media at widths
  1280 / 820 / 819 / 560 / 559 and under `print` media emulation, for both
  content extremes 16×1 and 7×2.
- **Screenshots** — full-page captures at every width under screen media,
  plus one print-media capture, per extreme (retained as reviewer evidence
  under `artifacts/`, never committed).
- **PDFs** — browser-generated per extreme under print media
  (`preferCSSPageSize: true`; an explicit screen-media emulation override
  leaks into `page.pdf` rendering on Chrome 158, so the PDF is generated
  with print emulation active, as a browser print does); page count and
  MediaBox are parsed from the raw PDF bytes (no PDF library) and asserted
  to be exactly one A4 landscape page, 841.92 × 594.96 pt ± 0.5.
- **Paper rect** — the print-emulated `.paper` bounding rect (±1px vs
  baseline).
- **Selector inventory** — every class token in `src/routes/index.tsx`
  (string attributes, expression attributes, template-literal static
  parts, plus the required dynamic fragments `tint-0`…`tint-4`,
  `two-days`, `active`, `selected`) must resolve against the emitted CSS.
  Resolution semantics: a token is *unresolved* — and fails the run — only
  when it appears in no emitted selector **and** no emitted rule styles any
  element carrying it. Tokens absent from every emitted selector but
  element-styled (e.g. `tint-0` at baseline, styled through `.item-heading`)
  are reported as `literallyAbsent`. This guards against deleted-but-needed
  or renamed-but-not-updated rules.

The committed baseline lives at
`scripts/parity/baseline/baseline.json` (captured from `674256c` with the
Chrome version named in its `meta`). Only this text JSON is committed;
screenshots/PDFs stay uncommitted under `scripts/parity/artifacts/` and are
attached to the issue/PR.

## Commands

```sh
# 1. Build and serve the production build of the tree you want to measure
npm ci && npm run build && npm run start        # default BASE_URL http://localhost:3000

# 2. Capture a parity document (writes JSON only if the whole run passes)
BASE_URL=http://localhost:3000 npm run parity:capture -- \
  --out scripts/parity/baseline/baseline.json \
  --artifacts scripts/parity/artifacts/<label>

# 3. Verify the served build against the committed baseline (exit 0 = empty diff)
BASE_URL=http://localhost:3000 npm run parity:verify
```

`npm run parity:verify` prints a run summary naming the build commit,
baseline ref, browser version, every viewport/configuration, and the first
differences; the full machine-readable diff lands in
`artifacts/<run>/diff.json`.

## Preconditions (all fail loudly, exit ≠ 0, naming the failure)

- Google Chrome must be installed (`channel: chrome`; override the path
  with `PARITY_CHROME_EXECUTABLE`). `playwright-core` never downloads a
  browser.
- The server at `BASE_URL` must answer HTTP 200 (production build, not the
  dev server).
- Every required selector must exist in the served page for both extremes.
  The icon-picker menu is opened through its trigger during the drive so
  it exists at capture time.
- `document.fonts.ready` must settle within `PARITY_FONT_TIMEOUT_MS`
  (default 15000). After it settles, `.hero h1` must compute to Nunito and
  `.legend-item` to DM Sans, and both webfonts must report loaded
  (`document.fonts.check`).
- The PDF gate must hold for both extremes (one page, MediaBox in
  tolerance). If the raw-byte parse ever fails, the run fails.
- The content drive must reach exactly 1×16 / 2×7 via the real controls
  (`.choice` buttons, `.item-chip` toggles, `.add-item` input, icon picker,
  Add button) — asserted before any capture. No React state injection.

A skipped or partial capture is a failed run: the capture document is
written only after every step succeeded.

## Tolerances (fixed — never widen)

| Comparison | Tolerance |
| --- | --- |
| Computed-style float values (px) | ±0.01px |
| Print-emulated `.paper` rect | ±1px |
| PDF MediaBox | ±0.5pt, page count exact |
| Everything else | exact string |

Widening a tolerance to make a run pass is a spec change, not a fix.

## Environment variables / flags

| Name | Purpose |
| --- | --- |
| `BASE_URL` | Server under test (default `http://localhost:3000`). |
| `PARITY_BUILD_REF` | Build commit recorded in the summary/meta (default: `git rev-parse HEAD` of the invoking checkout). |
| `PARITY_FONT_TIMEOUT_MS` | `document.fonts.ready` timeout (default 15000; `0` always times out — used to demonstrate the failure). |
| `PARITY_CHROME_EXECUTABLE` | Explicit Chrome path instead of `channel: chrome`. |
| `PARITY_SOURCE_FILE` | Source scanned for the class-token inventory (default `src/routes/index.tsx`). |
| `PARITY_BASELINE` / `--baseline` | Baseline document for `parity:verify`. |
| `--out`, `--artifacts`, `--label` | Capture output paths (`parity:capture`). |
| `--demo-missing-selector <sel>` | Adds a deliberately missing selector to the precondition check to demonstrate the fail-loud behaviour. |

## Demonstration of fail-loud behaviour

```sh
# missing selector
npm run parity:capture -- --demo-missing-selector ".no-such-selector" --artifacts scripts/parity/artifacts/demo

# unreachable server
BASE_URL=http://localhost:9 npm run parity:capture -- --artifacts scripts/parity/artifacts/demo

# missing Chrome
PARITY_CHROME_EXECUTABLE=/nonexistent/chrome npm run parity:capture -- --artifacts scripts/parity/artifacts/demo

# font-load timeout
PARITY_FONT_TIMEOUT_MS=0 npm run parity:capture -- --artifacts scripts/parity/artifacts/demo
```

Each exits non-zero with a `PRECONDITION FAILURE [...]` message.
