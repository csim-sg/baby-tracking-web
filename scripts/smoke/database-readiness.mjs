// Database readiness smoke (issue #23; FR-41/FR-43; AC-13/AC-15). Run
// against the PRODUCTION build on a free port, with a disposable
// PostgreSQL 16 reachable at DATABASE_URL, in a mode with the digital
// surface enabled (selfhost, or cloud with CLOUD_APP_ENABLED=true):
//
//   npm run build
//   DEPLOYMENT_MODE=selfhost DATABASE_URL=postgres://... AUTH_SECRET=... \
//     APP_URL=http://127.0.0.1:PORT PORT=4682 npm run start &
//   node scripts/smoke/database-readiness.mjs --base-url http://127.0.0.1:4682 \
//     --database-status ok
//
// --database-status ok    schema applied + PostgreSQL reachable
// --database-status fail  PostgreSQL stopped OR schema missing/partial
//
// Asserts, in the requested state:
// - GET /readyz JSON: checks contains { name: "database", status } — the
//   check was REGISTERED AT SERVER START, so the very first cold-start
//   request already evaluates it (never "uninitialized");
// - when ok is requested, the database entry is "ok"; when fail is
//   requested, "fail" with a SANITIZED detail (no URL/scheme, no "@", no
//   credential-ish material, no driver error text);
// - GET / returns 200 text/html and GET /healthz returns 200 JSON — `/` and
//   liveness stay up through database failures (FR-01/FR-43; TR-05).
//
// Overall /readyz status is deliberately NOT asserted: until #24 registers
// the `auth` check the overall state is unavailable (503) even with the
// database ok. This script asserts the database entry, as the issue
// acceptance specifies.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: process.env.BASE_URL || "http://127.0.0.1:3000" },
    "database-status": { type: "string", default: "ok" },
  },
});

const baseUrl = values["base-url"].replace(/\/$/, "");
const expectedDatabaseStatus = values["database-status"];
if (expectedDatabaseStatus !== "ok" && expectedDatabaseStatus !== "fail") {
  console.error("database-readiness: --database-status must be ok or fail");
  process.exit(1);
}

let failures = 0;
function check(label, pass, detail) {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}${pass ? "" : ` — ${detail}`}`);
  if (!pass) failures += 1;
}

async function fetchPath(path, accept) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept } });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

// --- GET /readyz — database entry ---
const readyz = await fetchPath("/readyz", "application/json");
check(
  "GET /readyz returns JSON",
  readyz.contentType.includes("application/json"),
  `status ${readyz.status} content-type ${readyz.contentType}`,
);
let parsed = null;
try {
  parsed = JSON.parse(readyz.body);
} catch {}
check("GET /readyz body parses as JSON", parsed !== null, readyz.body.slice(0, 400));

const databaseCheck = (parsed?.checks ?? []).find((c) => c.name === "database");
check(
  `checks contains database with status ${expectedDatabaseStatus} (registered at server start — no uninitialized)`,
  databaseCheck?.status === expectedDatabaseStatus,
  `checks ${JSON.stringify(parsed?.checks)}`,
);

if (expectedDatabaseStatus === "fail") {
  const detail = String(databaseCheck?.detail ?? "");
  const sanitized =
    detail.length > 0 &&
    !detail.includes("://") &&
    !detail.includes("@") &&
    !/password|postgres(ql)?\s*(error|connection refused)/i.test(detail);
  check(
    "failing database detail is sanitized (no URL/host/credential material)",
    sanitized,
    `detail ${JSON.stringify(detail)}`,
  );
} else {
  check(
    "ok database detail is non-empty",
    String(databaseCheck?.detail ?? "").length > 0,
    `checks ${JSON.stringify(parsed?.checks)}`,
  );
}

// --- GET / — free product stays up ---
const root = await fetchPath("/", "text/html");
check(
  "GET / is 200 text/html through the database state change",
  root.status === 200 && root.contentType.includes("text/html"),
  `status ${root.status} content-type ${root.contentType}`,
);

// --- GET /healthz — liveness never touches the database ---
const healthz = await fetchPath("/healthz", "application/json");
check(
  "GET /healthz is 200 JSON without touching the database",
  healthz.status === 200 && healthz.contentType.includes("application/json"),
  `status ${healthz.status} content-type ${healthz.contentType}`,
);

if (failures > 0) {
  process.exit(1);
}
console.log(`RESULT: PASS (database ${expectedDatabaseStatus})`);
