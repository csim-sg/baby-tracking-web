// `npm run parity:capture` — capture a parity document (computed styles,
// screenshots, print capture, PDFs, selector inventory) from the served
// production build.
//
// Usage:
//   BASE_URL=http://localhost:3000 npm run parity:capture
//   npm run parity:capture -- --out scripts/parity/baseline/baseline.json \
//       --artifacts scripts/parity/artifacts/<label>
//
// The capture document is written only if the entire run succeeds; any
// precondition failure exits non-zero and names the failing precondition.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  runCapture,
  renderSummary,
  serializeDocument,
  ParityPreconditionError,
  resolveBuildRef,
} from "./harness.mjs";
import {
  DEFAULT_BASELINE_PATH,
  DEFAULT_BASE_URL,
  DEFAULT_FONT_TIMEOUT_MS,
} from "./config.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: resolve(DEFAULT_BASELINE_PATH) },
    artifacts: { type: "string" },
    label: { type: "string", default: "capture" },
    "demo-missing-selector": { type: "string" },
    "base-url": { type: "string", default: process.env.BASE_URL || DEFAULT_BASE_URL },
    "build-ref": { type: "string", default: process.env.PARITY_BUILD_REF || "" },
  },
  strict: true,
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = resolve(
  values.artifacts ?? join("scripts", "parity", "artifacts", `${values.label}-${stamp}`),
);
mkdirSync(artifactsDir, { recursive: true });

const options = {
  baseUrl: values["base-url"],
  artifactsDir,
  buildRef: values["build-ref"] || resolveBuildRef(),
  fontTimeoutMs: Number(
    process.env.PARITY_FONT_TIMEOUT_MS ?? DEFAULT_FONT_TIMEOUT_MS,
  ),
  chromeExecutable: process.env.PARITY_CHROME_EXECUTABLE || undefined,
  sourceFile: process.env.PARITY_SOURCE_FILE || undefined,
  demoMissingSelector: values["demo-missing-selector"],
};

try {
  const { doc, sinks } = await runCapture(options);
  const outPath = resolve(values.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializeDocument(doc));
  const summary = renderSummary({
    mode: "capture",
    doc,
    artifactsDir,
  });
  writeFileSync(join(artifactsDir, "summary.txt"), summary + "\n");
  console.log(summary);
  console.log(`\ncapture document:  ${outPath}`);
  console.log("result:            PASS");
} catch (error) {
  const message =
    error instanceof ParityPreconditionError || error?.name === "ParityPreconditionError"
      ? error.message
      : `RUN FAILURE: ${error?.stack || error}`;
  console.error(message);
  console.error("result:            FAIL");
  try {
    writeFileSync(
      join(artifactsDir, "failure.txt"),
      message + "\n",
    );
  } catch {
    // best-effort failure record; the non-zero exit already fails the run
  }
  process.exit(1);
}
