// `npm run parity:verify` — capture the current served production build and
// diff it against the committed baseline. Exit 0 only when the diff is
// empty; any difference (including structural differences in the matrix
// shape) exits non-zero. Tolerances are fixed by SPEC-001 and are never
// widened by this script.
//
// Usage:
//   BASE_URL=http://localhost:3000 npm run parity:verify
//   npm run parity:verify -- --baseline scripts/parity/baseline/baseline.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  runCapture,
  renderSummary,
  ParityPreconditionError,
  resolveBuildRef,
} from "./harness.mjs";
import { diffDocuments } from "./diff.mjs";
import {
  DEFAULT_BASELINE_PATH,
  DEFAULT_BASE_URL,
  DEFAULT_FONT_TIMEOUT_MS,
} from "./config.mjs";

const { values } = parseArgs({
  options: {
    baseline: { type: "string", default: resolve(DEFAULT_BASELINE_PATH) },
    artifacts: { type: "string" },
    "base-url": { type: "string", default: process.env.BASE_URL || DEFAULT_BASE_URL },
    "build-ref": { type: "string", default: process.env.PARITY_BUILD_REF || "" },
  },
  strict: true,
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = resolve(
  values.artifacts ?? join("scripts", "parity", "artifacts", `verify-${stamp}`),
);
mkdirSync(artifactsDir, { recursive: true });

const baselinePath = resolve(values.baseline);
let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (error) {
  console.error(
    `PRECONDITION FAILURE [baseline]: cannot read baseline document ${baselinePath}: ${error.message}`,
  );
  process.exit(1);
}

const options = {
  baseUrl: values["base-url"],
  artifactsDir,
  buildRef: values["build-ref"] || resolveBuildRef(),
  fontTimeoutMs: Number(
    process.env.PARITY_FONT_TIMEOUT_MS ?? DEFAULT_FONT_TIMEOUT_MS,
  ),
  chromeExecutable: process.env.PARITY_CHROME_EXECUTABLE || undefined,
  sourceFile: process.env.PARITY_SOURCE_FILE || undefined,
};

try {
  const { doc } = await runCapture(options);
  const { entries, counts } = diffDocuments(baseline, doc);
  const diff = { entries, counts, empty: entries.length === 0 };
  writeFileSync(join(artifactsDir, "diff.json"), JSON.stringify(diff, null, 2) + "\n");
  const summary = renderSummary({
    mode: "verify",
    doc,
    baselineMeta: baseline.meta,
    diff,
    artifactsDir,
  });
  writeFileSync(join(artifactsDir, "summary.txt"), summary + "\n");
  console.log(summary);
  console.log(`\nbaseline document: ${baselinePath}`);
  console.log(`result:            ${diff.empty ? "PASS (empty diff)" : "FAIL (differences found)"}`);
  process.exit(diff.empty ? 0 : 1);
} catch (error) {
  const message =
    error?.name === "ParityPreconditionError"
      ? error.message
      : `RUN FAILURE: ${error?.stack || error}`;
  console.error(message);
  console.error("result:            FAIL");
  try {
    writeFileSync(join(artifactsDir, "failure.txt"), message + "\n");
  } catch {
    // best-effort failure record; the non-zero exit already fails the run
  }
  process.exit(1);
}
