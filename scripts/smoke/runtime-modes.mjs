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
//   cloud-enabled-unready-vars DEPLOYMENT_MODE=cloud CLOUD_APP_ENABLED=true + all digital vars (DB check registered; the placeholder DATABASE_URL fails it)
//   selfhost-unready           DEPLOYMENT_MODE=selfhost            (no vars)
//   selfhost-unready-vars      DEPLOYMENT_MODE=selfhost + vars     (DB check registered; the placeholder DATABASE_URL fails it)
//
// Issue #24 updates: database+auth+smtp are registered and evaluated at
// server start (per-scenario `checks` expectations assert auth/smtp
// evaluated and stripe still UNINITIALIZED — #29 owns it, so a
// launch-enabled cloud keeps /readyz at 503 naming stripe: never claim
// cloud readiness 200); /app and the auth pages are real SSR routes with an
// equivalent fail-closed gate INSIDE the route/server-function boundary,
// with $.tsx splats covering unknown subpaths — every digital path must
// still answer gate JSON, never the SSR catch-all 200 text/html.
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
    // No known mode: the catalog is not evaluated.
    checks: "none",
  },
  "mode-unknown": {
    gtmOnRoot: false,
    readyz: { status: 503, problemVariable: "DEPLOYMENT_MODE", ready: false },
    digital: 503,
    webhook: 404,
    checks: "none",
  },
  "cloud-launch-disabled": {
    gtmOnRoot: true,
    readyz: { status: 200, problemVariable: null, ready: true },
    digital: 404,
    webhook: 404,
    // Launch-disabled cloud: /readyz reports 200 with NO checks evaluated
    // (unchanged #22 behavior; stripe is #29).
    checks: "none",
  },
  "cloud-enabled-unready": {
    gtmOnRoot: true,
    readyz: { status: 503, problemVariable: "DATABASE_URL", ready: false },
    digital: 503,
    webhook: 503,
    // #24: auth+smtp are registered and evaluated; stripe stays #29.
    checks: "auth-smtp-stripe",
  },
  "cloud-enabled-unready-vars": {
    gtmOnRoot: true,
    readyz: {
      status: 503,
      problemVariable: null,
      ready: false,
      checkStatus: { name: "database", status: "fail" },
    },
    digital: 503,
    webhook: 503,
    checks: "auth-smtp-stripe",
  },
  "selfhost-unready": {
    gtmOnRoot: false,
    readyz: { status: 503, problemVariable: "DATABASE_URL", ready: false },
    digital: 503,
    webhook: 404,
    checks: "auth-only",
  },
  "selfhost-unready-vars": {
    gtmOnRoot: false,
    readyz: {
      status: 503,
      problemVariable: null,
      ready: false,
      checkStatus: { name: "database", status: "fail" },
    },
    digital: 503,
    webhook: 404,
    checks: "auth-only",
  },
  // Issue #24 readiness matrix: valid self-host configuration + migrated,
  // reachable database → /readyz 200 with database+auth ok, digital pages
  // SERVE (auth pages HTML without GTM; /app redirects to /sign-in).
  "selfhost-ready": {
    gtmOnRoot: false,
    readyz: {
      status: 200,
      problemVariable: null,
      ready: true,
      checkStatus: { name: "database", status: "ok" },
    },
    digital: "ready-html",
    webhook: 404,
    checks: "auth-only",
  },
  // Cloud launch-enabled with a real database: database/auth/smtp all ok but
  // stripe is still UNINITIALIZED (#29), so /readyz MUST stay 503 naming
  // stripe — cloud readiness 200 must not be claimed by #24.
  "cloud-enabled-ready-db": {
    gtmOnRoot: true,
    readyz: {
      status: 503,
      problemVariable: null,
      ready: false,
      checkStatus: { name: "stripe", status: "uninitialized" },
      alsoOk: [
        { name: "database", status: "ok" },
        { name: "auth", status: "ok" },
        { name: "smtp", status: "ok" },
      ],
    },
    digital: 503,
    webhook: 503,
    checks: "auth-smtp-stripe",
  },
};

const MODE_BY_SCENARIO = {
  "mode-missing": null,
  "mode-unknown": null,
  "cloud-launch-disabled": "cloud",
  "cloud-enabled-unready": "cloud",
  "cloud-enabled-unready-vars": "cloud",
  "cloud-enabled-ready-db": "cloud",
  "selfhost-unready": "selfhost",
  "selfhost-unready-vars": "selfhost",
  "selfhost-ready": "selfhost",
};

/**
 * Expected evaluated checks per scenario (issue #24 readiness matrix):
 * - "auth-smtp-stripe": auth+smtp evaluated, stripe UNINITIALIZED (#29) —
 *   cloud launch-enabled /readyz stays 503 naming stripe; never claim 200;
 * - "auth-only": self-host has no smtp/stripe catalog entries;
 * - "none": no checks evaluated (unknown/missing mode, launch-disabled).
 */
function assertChecks(parsed, assert) {
  const mode = MODE_BY_SCENARIO[scenario];
  const checks = parsed.checks ?? [];
  const byName = Object.fromEntries(checks.map((entry) => [entry.name, entry]));
  const expectation = SCENARIOS[scenario].checks;
  if (expectation === "none") {
    assert(
      checks.length === 0,
      `expected no checks; got ${JSON.stringify(checks)}`,
    );
    return;
  }
  assert(
    byName.auth?.status === "ok" || byName.auth?.status === "fail",
    `auth check must be evaluated (registered at server start); got ${JSON.stringify(byName.auth)}`,
  );
  assert(
    byName.database?.status === "ok" || byName.database?.status === "fail",
    `database check must be evaluated; got ${JSON.stringify(byName.database)}`,
  );
  if (expectation === "auth-smtp-stripe") {
    assert(
      byName.smtp?.status === "ok" || byName.smtp?.status === "fail",
      `smtp check must be evaluated in cloud; got ${JSON.stringify(byName.smtp)}`,
    );
    const smtpPresent = expected.readyz.checkStatus !== undefined;
    assert(
      byName.smtp?.status === (smtpPresent ? "ok" : "fail"),
      `smtp check must ${smtpPresent ? "pass (settings present)" : "fail (settings missing)"}; got ${JSON.stringify(byName.smtp)}`,
    );
    assert(
      byName.stripe?.status === "uninitialized",
      `stripe must stay uninitialized until #29; got ${JSON.stringify(byName.stripe)}`,
    );
  } else if (expectation === "auth-only") {
    assert(
      byName.smtp === undefined,
      `self-host has no smtp check; got ${JSON.stringify(byName.smtp)}`,
    );
    assert(
      byName.stripe === undefined,
      `self-host has no stripe check; got ${JSON.stringify(byName.stripe)}`,
    );
  }
}

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
    if (expected.readyz.checkStatus) {
      const entry = (parsed.checks ?? []).find(
        (entry) => entry.name === expected.readyz.checkStatus.name,
      );
      assert(
        entry?.status === expected.readyz.checkStatus.status,
        `expected ${expected.readyz.checkStatus.name} ${expected.readyz.checkStatus.status}; checks ${JSON.stringify(parsed.checks)}`,
      );
      for (const also of expected.readyz.checkStatus.alsoOk ?? []) {
        const entry2 = (parsed.checks ?? []).find((c) => c.name === also.name);
        assert(
          entry2?.status === also.status,
          `expected ${also.name} ${also.status}; got ${JSON.stringify(entry2)}`,
        );
      }
    }
    assertChecks(parsed, assert);
    assert(
      (parsed.status === "ok") === expected.readyz.ready,
      `ready flag ${parsed.status} (expected ${expected.readyz.ready ? "ok" : "unavailable"})`,
    );
  });

  // --- digital surfaces ---
  // #24: /app and the auth pages are now real SSR routes gated INSIDE their
  // route/server-function boundary; /api/auth/* stays a nitro handler (no
  // real endpoint — T1 F4). Every path must answer the gate JSON, never the
  // SSR catch-all 200 text/html — except in a READY surface, where the auth
  // pages serve HTML and /app redirects to /sign-in.
  if (expected.digital === "ready-html") {
    const authPage = await checkRoute("GET auth page ready", "/sign-in", null, (ctx, assert) => {
      assert(ctx.response.status === 200, `status ${ctx.response.status}`);
      assert(
        ctx.contentType.includes("text/html"),
        `content-type ${ctx.contentType} — gate leaked into a ready surface`,
      );
      assert(
        !ctx.body.includes(GTM_MARKER) && !ctx.body.includes(GTM_ID),
        "GTM found on a ready auth page — must never load there",
      );
    });
    const appRedirect = await checkRoute("GET /app unauthenticated", "/app", null, (ctx, assert) => {
      assert(
        [302, 303, 307, 308].includes(ctx.response.status),
        `status ${ctx.response.status} — /app must redirect to /sign-in`,
      );
      assert(
        (ctx.response.headers.get("location") ?? "").includes("/sign-in"),
        `location ${ctx.response.headers.get("location")}`,
      );
    });
    // Unknown app subpath: the gate answers 404 JSON even when ready —
    // never the renderer's catch-all.
    const appSplat = await checkRoute("GET /app/unknown-subpage", "/app/unknown-subpage", null, (ctx, assert) => {
      const parsed = expectJsonWithStatus(404)(ctx, assert);
      if (parsed) assert(parsed.error === "not_found", `error ${parsed.error}`);
    });
    const webhookGate = await checkRoute("POST webhook selfhost", "/api/stripe/webhook", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }, (ctx, assert) => {
      const parsed = expectJsonWithStatus(404)(ctx, assert);
      if (parsed) assert(parsed.error === "not_found", `error ${parsed.error}`);
    });
    // /api/auth/* is ALWAYS gated (no real endpoint exists on this stack —
    // T1 F4; auth runs through server functions), ready or not.
    const apiAuthGate = await checkRoute("GET /api/auth/session", "/api/auth/session", null, (ctx, assert) => {
      const parsed = expectJsonWithStatus(503)(ctx, assert);
      if (parsed) assert(parsed.error === "digital_unavailable", `error ${parsed.error}`);
    });
    void [authPage, appRedirect, appSplat, webhookGate, apiAuthGate];
  } else {
    const expectDigital = expectJsonWithStatus(expected.digital);
    const digitalPaths = [
      "/app",
      "/app/settings",
      "/app/unknown-subpage",
      "/sign-in",
      "/sign-in/unknown-subpage",
      "/sign-up",
      "/sign-up/unknown-subpage",
      "/forgot-password",
      "/forgot-password/unknown-subpage",
      "/reset-password",
      "/reset-password/unknown-subpage",
      "/verify-email",
      "/verify-email/unknown-subpage",
      "/api/auth/session",
    ];
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
  }

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
