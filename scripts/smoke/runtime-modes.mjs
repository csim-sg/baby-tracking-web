// Runtime-mode / dependency-stop smoke (issue #22; FR-40/FR-43/FR-44;
// TR-05/TR-09; AC-13). Run against the PRODUCTION build on a free port:
//
//   npm run build
//   DEPLOYMENT_MODE=cloud PORT=4681 npm run start &
//   node scripts/smoke/runtime-modes.mjs --base-url http://127.0.0.1:4681 \
//     --scenario cloud-launch-disabled
//
// Scenarios (server-side env) and what they assert:
//
//   mode-missing               no DEPLOYMENT_MODE
//   mode-unknown               DEPLOYMENT_MODE=nonsense
//   cloud-launch-disabled      DEPLOYMENT_MODE=cloud               (CLOUD_APP_ENABLED defaults false)
//   cloud-enabled-unready      DEPLOYMENT_MODE=cloud CLOUD_APP_ENABLED=true          (no digital vars)
//   cloud-enabled-unready-vars DEPLOYMENT_MODE=cloud CLOUD_APP_ENABLED=true + all digital vars (DB module uninitialized)
//   selfhost-unready           DEPLOYMENT_MODE=selfhost            (no vars)
//   selfhost-unready-vars      DEPLOYMENT_MODE=selfhost + vars     (DB module uninitialized)
//
// Every check asserts HTTP status AND content-type AND a body marker — the
// SSR catch-all returns 200 text/html for unmatched paths, so a status-only
// check cannot distinguish fail-closed responses from a leaked `/` document.
//
// Optional: --network drives the pages in Chrome (playwright-core, channel
// chrome or PARITY_CHROME_EXECUTABLE) and records googletagmanager.com
// requests, proving GTM loads on cloud `/` only and nowhere else.
import { parseArgs } from "node:util";

const GTM_ID = "GTM-NP4XPXZS";
const GTM_MARKER = "googletagmanager.com";

const SCENARIOS = {
  "mode-missing": {
    gtmOnRoot: false,
    readyz: { status: 503, problemVariable: "DEPLOYMENT_MODE", ready: false },
    digital: 503,
    webhook: 404,
  },
  "mode-unknown": {
    gtmOnRoot: false,
    readyz: { status: 503, problemVariable: "DEPLOYMENT_MODE", ready: false },
    digital: 503,
    webhook: 404,
  },
  "cloud-launch-disabled": {
    gtmOnRoot: true,
    readyz: { status: 200, problemVariable: null, ready: true },
    digital: 404,
    webhook: 404,
  },
  "cloud-enabled-unready": {
    gtmOnRoot: true,
    readyz: { status: 503, problemVariable: "DATABASE_URL", ready: false },
    digital: 503,
    webhook: 503,
  },
  "cloud-enabled-unready-vars": {
    gtmOnRoot: true,
    readyz: {
      status: 503,
      problemVariable: null,
      ready: false,
      checkUninitialized: "database",
    },
    digital: 503,
    webhook: 503,
  },
  "selfhost-unready": {
    gtmOnRoot: false,
    readyz: { status: 503, problemVariable: "DATABASE_URL", ready: false },
    digital: 503,
    webhook: 404,
  },
  "selfhost-unready-vars": {
    gtmOnRoot: false,
    readyz: {
      status: 503,
      problemVariable: null,
      ready: false,
      checkUninitialized: "database",
    },
    digital: 503,
    webhook: 404,
  },
};

const MODE_BY_SCENARIO = {
  "mode-missing": null,
  "mode-unknown": null,
  "cloud-launch-disabled": "cloud",
  "cloud-enabled-unready": "cloud",
  "cloud-enabled-unready-vars": "cloud",
  "selfhost-unready": "selfhost",
  "selfhost-unready-vars": "selfhost",
};

const { values } = parseArgs({
  options: {
    "base-url": {
      type: "string",
      default: process.env.BASE_URL || "http://127.0.0.1:3000",
    },
    scenario: { type: "string" },
    network: { type: "boolean", default: false },
  },
  strict: true,
});

const scenario = values.scenario;
if (!scenario || !SCENARIOS[scenario]) {
  console.error(
    `usage: node scripts/smoke/runtime-modes.mjs --base-url <url> --scenario <${Object.keys(SCENARIOS).join("|")}> [--network]`,
  );
  process.exit(2);
}
const expected = SCENARIOS[scenario];

let failures = 0;
let passes = 0;

function check(label, ok, detail) {
  if (ok) {
    passes += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function fetchRoute(path, init) {
  const response = await fetch(new URL(path, values["base-url"]), {
    redirect: "manual",
    ...init,
  });
  const body = await response.text();
  return { response, body };
}

async function checkRoute(label, path, init, expectFn) {
  const { response, body } = await fetchRoute(path, init);
  const contentType = response.headers.get("content-type") ?? "";
  const context = { response, body, contentType };
  expectFn(context, (ok, detail) => check(`${label} [${path}]`, ok, detail));
}

function expectJsonWithStatus(status) {
  return (ctx, assert) => {
    assert(
      ctx.response.status === status,
      `status ${ctx.response.status} (expected ${status}); content-type ${ctx.contentType}`,
    );
    assert(
      ctx.contentType.includes("application/json"),
      `content-type ${ctx.contentType} — SSR catch-all leak returns text/html`,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ctx.body);
    } catch {
      // handled by the next assert
    }
    assert(parsed !== null, "body is not JSON");
    return parsed;
  };
}

async function runRouteChecks() {
  console.log(`smoke ${scenario} against ${values["base-url"]}`);

  // --- GET / ---
  await checkRoute("GET /", "/", null, (ctx, assert) => {
    assert(ctx.response.status === 200, `status ${ctx.response.status}`);
    assert(
      ctx.contentType.includes("text/html"),
      `content-type ${ctx.contentType}`,
    );
    const hasGtm = ctx.body.includes(GTM_MARKER) && ctx.body.includes(GTM_ID);
    if (expected.gtmOnRoot) {
      assert(hasGtm, "expected GTM tag on cloud / — none found");
    } else {
      assert(
        !ctx.body.includes(GTM_MARKER) && !ctx.body.includes(GTM_ID),
        "GTM tag found on / where it must not load",
      );
    }
  });

  // --- GET /healthz --- liveness without DB (FR-43)
  await checkRoute("GET /healthz", "/healthz", null, (ctx, assert) => {
    assert(ctx.response.status === 200, `status ${ctx.response.status}`);
    assert(
      ctx.contentType.includes("application/json"),
      `content-type ${ctx.contentType}`,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ctx.body);
    } catch {}
    assert(parsed?.status === "ok", `body ${JSON.stringify(parsed)}`);
  });

  // --- GET /readyz --- structured readiness (FR-43)
  const parseReadyz = expectJsonWithStatus(expected.readyz.status);
  await checkRoute("GET /readyz", "/readyz", null, (ctx, assert) => {
    const parsed = parseReadyz(ctx, assert);
    if (!parsed) return;
    assert(
      parsed.mode === MODE_BY_SCENARIO[scenario],
      `mode ${JSON.stringify(parsed.mode)}`,
    );
    if (expected.readyz.problemVariable) {
      const named = (parsed.problems ?? []).some(
        (problem) => problem.variable === expected.readyz.problemVariable,
      );
      assert(
        named,
        `readyz must name ${expected.readyz.problemVariable}; problems ${JSON.stringify(parsed.problems)}`,
      );
    }
    if (expected.readyz.checkUninitialized) {
      const entry = (parsed.checks ?? []).find(
        (entry) => entry.name === expected.readyz.checkUninitialized,
      );
      assert(
        entry?.status === "uninitialized",
        `expected ${expected.readyz.checkUninitialized} uninitialized; checks ${JSON.stringify(parsed.checks)}`,
      );
    }
    assert(
      (parsed.status === "ok") === expected.readyz.ready,
      `ready flag ${parsed.status} (expected ${expected.readyz.ready ? "ok" : "unavailable"})`,
    );
  });

  // --- digital surfaces ---
  const expectDigital = expectJsonWithStatus(expected.digital);
  const digitalPaths = ["/app", "/app/logs", "/sign-in", "/api/auth/session"];
  for (const path of digitalPaths) {
    await checkRoute("GET digital", path, null, (ctx, assert) => {
      const parsed = expectDigital(ctx, assert);
      if (!parsed) return;
      if (expected.digital === 404) {
        assert(parsed.error === "not_found", `error ${parsed.error}`);
      } else {
        assert(parsed.error === "digital_unavailable", `error ${parsed.error}`);
      }
    });
  }

  // --- POST /api/stripe/webhook --- fail-closed (only /api contract route)
  await checkRoute(
    "POST webhook",
    "/api/stripe/webhook",
    {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    },
    (ctx, assert) => {
      const parsed = expectJsonWithStatus(expected.webhook)(ctx, assert);
      if (!parsed) return;
      if (expected.webhook === 404) {
        assert(parsed.error === "not_found", `error ${parsed.error}`);
      } else {
        assert(parsed.error === "digital_unavailable", `error ${parsed.error}`);
      }
    },
  );

  // --- root-level-only contract: /api/healthz must NOT be a health endpoint ---
  await checkRoute("GET decoy", "/api/healthz", null, (ctx, assert) => {
    const isJsonHealth =
      ctx.contentType.includes("application/json") &&
      ctx.response.status === 200;
    assert(
      !isJsonHealth,
      "/api/healthz must not answer as a health endpoint (root-level only)",
    );
  });

  // --- SSR catch-all unchanged for unrelated unknown paths ---
  await checkRoute(
    "GET unknown",
    "/totally-unknown-page",
    null,
    (ctx, assert) => {
      assert(ctx.response.status === 200, `status ${ctx.response.status}`);
      assert(
        ctx.contentType.includes("text/html"),
        `content-type ${ctx.contentType}`,
      );
    },
  );

  console.log(`smoke ${scenario}: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

async function runNetworkChecks() {
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.PARITY_CHROME_EXECUTABLE || undefined;
  const browser = await chromium.launch({
    channel: executablePath ? undefined : "chrome",
    executablePath,
  });
  try {
    const page = await browser.newPage();
    const gtmRequests = [];
    page.on("request", (request) => {
      if (request.url().includes(GTM_MARKER)) {
        gtmRequests.push(request.url());
      }
    });

    for (const path of ["/", "/sign-in", "/app"]) {
      gtmRequests.length = 0;
      const response = await page.goto(
        new URL(path, values["base-url"]).toString(),
        {
          waitUntil: "load",
        },
      );
      const label = `GET ${path}`;
      if (expected.gtmOnRoot && path === "/") {
        check(
          `network ${label}`,
          gtmRequests.length > 0,
          "expected GTM request on cloud /",
        );
      } else {
        check(
          `network ${label}`,
          gtmRequests.length === 0,
          `GTM requests recorded: ${JSON.stringify(gtmRequests)}`,
        );
        check(
          `network ${label} not-html-or-status`,
          !(
            path !== "/" &&
            response?.status() === 200 &&
            (response?.headers()["content-type"] ?? "").includes("text/html")
          ),
          "digital surface returned 200 text/html (catch-all leak)",
        );
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) process.exit(1);
}

await runRouteChecks();
if (values.network) {
  await runNetworkChecks();
}
if (failures === 0) {
  console.log(`RESULT: PASS (${scenario})`);
}
