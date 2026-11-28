// Auth lifecycle E2E (issue #24; AC-01/AC-02/AC-03/AC-04; FR-05–FR-09,
// FR-11/FR-12/FR-22, FR-36/FR-38; TR-13/TR-14).
//
// Run against the PRODUCTION build on a free port:
//
//   npm run build
//   DEPLOYMENT_MODE=selfhost DATABASE_URL=… AUTH_SECRET=… APP_URL=http://127.0.0.1:PORT \
//     SMTP_HOST=… SMTP_PORT=… SMTP_USER=… SMTP_PASSWORD=… PORT=4683 npm run start &
//   BASE_URL=http://127.0.0.1:4683 DATABASE_URL=… MAILPIT_HTTP_URL=http://127.0.0.1:8025 \
//     node scripts/e2e/auth-lifecycle.mjs --phase identity
//
// Phases (each against a server started with the matching env):
// - identity   SMTP configured (Mailpit): full identity lifecycle — sign-up
//              with verification email over SMTP, duplicate-email
//              non-disclosure, sign-in, cookie flags, session gating +
//              local return redirect, GTM/analytics absence, app 404 splat,
//              origin/CSRF rejection over the real RPC endpoint, rate
//              limiting (429) per IP and per email, forgot/reset with
//              session revocation + cookie replay rejection, password
//              change revoking sessions, sign-out-all, child profiles
//              (cap at 10, nickname bounds, owner isolation over the real
//              server functions, delete with explicit confirmation).
// - nosmtp     NO SMTP vars: self-host starts, /readyz 200 (database+auth),
//              sign-up shows the operator limitation and completes without
//              verification, sign-in works, and the committed operator
//              reset command (npm run reset-password) changes the password,
//              revokes the session, and is proven NOT reachable over HTTP.
// - secure-cookie  APP_URL is https://…: captured Set-Cookie must carry the
//              Secure attribute (the identity phase asserts the http case:
//              no Secure on plain http).
//
// Every phase asserts statuses AND content types AND body markers — the SSR
// catch-all answers 200 text/html for unmatched paths, so a status-only
// check cannot distinguish fail-closed responses from a leaked `/` document.
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const { values } = parseArgs({
  options: {
    "base-url": {
      type: "string",
      default: process.env.BASE_URL ?? "http://127.0.0.1:4730",
    },
    phase: { type: "string", default: "identity" },
  },
  strict: true,
});

const baseUrl = values["base-url"].replace(/\/$/, "");
const phase = values.phase;
const DATABASE_URL = process.env.DATABASE_URL;
const MAILPIT_HTTP_URL = process.env.MAILPIT_HTTP_URL;
const CHROME = process.env.PARITY_CHROME_EXECUTABLE || undefined;

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

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function db() {
  const { Pool } = await import("pg");
  return new Pool({ connectionString: DATABASE_URL });
}

async function fetchRoute(path, init) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "manual", ...init });
  const body = await response.text();
  return { response, body, contentType: response.headers.get("content-type") ?? "" };
}

async function newPage() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    channel: CHROME ? undefined : "chrome",
    executablePath: CHROME,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

async function drainMailpit() {
  if (!MAILPIT_HTTP_URL) {
    throw new Error("MAILPIT_HTTP_URL is required for this phase");
  }
  await fetch(`${MAILPIT_HTTP_URL.replace(/\/$/, "")}/api/v1/messages`, {
    method: "DELETE",
  });
}

async function latestMailTo(address) {
  const listResponse = await fetch(
    `${MAILPIT_HTTP_URL.replace(/\/$/, "")}/api/v1/search?query=${encodeURIComponent(address)}`,
  );
  const list = await listResponse.json();
  const message = list.messages?.[0];
  if (!message) {
    return null;
  }
  const detail = await (
    await fetch(`${MAILPIT_HTTP_URL.replace(/\/$/, "")}/api/v1/message/${message.ID}`)
  ).json();
  return { subject: detail.Subject ?? "", text: detail.Text ?? "" };
}

async function sign_upViaUi(page, email, password) {
  await page.goto(`${baseUrl}/sign-up`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  // The result notice (generic success message), distinct from any static
  // info notice that may already be on the page.
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
        /Your account is ready|Check your inbox/i.test(p.textContent ?? ""),
      ),
    undefined,
    { timeout: 20000 },
  );
  const notices = await page.$$eval("p[role=status]", (nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  );
  return notices.find((text) => /Your account is ready|Check your inbox/i.test(text)) ?? "";
}

async function signInViaUi(page, email, password, target = "/app") {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${baseUrl}${target}`, { timeout: 20000 });
}

// ---------------------------------------------------------------------------
// Phase: identity (SMTP configured)
// ---------------------------------------------------------------------------
async function runIdentity() {
  const pool = await db();
  let setCookieCapture = [];

  section("Phase: identity — sign-up with SMTP verification (FR-05/FR-06)");
  const { browser, context, page } = await newPage();

  // Capture raw Set-Cookie headers from server-function RPC responses.
  // allHeaders() exposes set-cookie (headers() omits it); multiple values
  // arrive newline-joined.
  page.on("response", (response) => {
    if (response.request().method() === "POST") {
      void response
        .allHeaders()
        .then((headers) => {
          const setCookie = headers["set-cookie"];
          if (setCookie) {
            for (const value of setCookie.split("\n")) {
              setCookieCapture.push(value);
            }
          }
        })
        .catch(() => {});
    }
  });

  await drainMailpit();
  const emailA = `owner-${Date.now()}@test.example`;
  const passwordA = "identity-pass-123456";
  const signUpMessage1 = await sign_upViaUi(page, emailA, passwordA);

  const mail = await latestMailTo(emailA);
  check(
    "verification email delivered over SMTP with an actionable link",
    mail !== null && mail.text.includes("/verify-email?token="),
    mail ? `subject ${mail.subject}` : "no mail captured",
  );
  check(
    "no care data in email beyond the account email and link",
    mail !== null && !mail.text.includes("password"),
    "email text leaked unexpected content",
  );

  check(
    "sign-up response is the generic verification message",
    signUpMessage1.includes("Check your inbox"),
    signUpMessage1,
  );

  section("Duplicate email non-disclosure (FR-05/AC-02)");
  await drainMailpit();
  const signUpMessage2 = await sign_upViaUi(
    page,
    emailA,
    "different-pass-654321",
  );
  check(
    "duplicate sign-up returns the SAME generic message (no existence disclosure)",
    signUpMessage2 === signUpMessage1,
    `first="${signUpMessage1}" second="${signUpMessage2}"`,
  );
  check(
    "duplicate sign-up sent NO email",
    (await latestMailTo(emailA)) === null,
    "duplicate signup produced mail",
  );

  section("Unverified sign-in blocked (FR-06)");
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "load" });
  await page.fill("#email", emailA);
  await page.fill("#password", passwordA);
  await page.click("button[type=submit]");
  await page.waitForSelector("p[role=status]", { timeout: 15000 });
  const blockedMessage = (await page.textContent("p[role=status]")) ?? "";
  check(
    "unverified cloud-style sign-in is blocked with a verification message",
    blockedMessage.includes("verify your email"),
    blockedMessage,
  );

  section("Verification link: 24h token consumed, session issued (FR-06)");
  const token = new URL(mail.text.match(/https?:\/\/\S*verify-email\?token=([^\s]+)/)?.[0]).searchParams.get("token");
  check("verification token extracted from the mail link", Boolean(token));
  await page.goto(`${baseUrl}/verify-email?token=${token}`, { waitUntil: "load" });
  // Wait for the RESULT state (the token consumer runs client-side).
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
        /verified|invalid|expired/i.test(p.textContent ?? ""),
      ),
    undefined,
    { timeout: 30000 },
  );
  const verifyStatus = (await page.textContent("p[role=status]")) ?? "";
  check(
    "verification succeeds in the UI",
    verifyStatus.includes("verified"),
    verifyStatus,
  );
  // autoSignInAfterVerification: the session cookie was applied to this
  // response — capture it for the cookie-flag assertions below.
  await page.goto(`${baseUrl}/app`, { waitUntil: "load" });
  check(
    "auto-sign-in after verification lands on /app",
    page.url().startsWith(`${baseUrl}/app`),
    `landed on ${page.url()}`,
  );

  section("Cookie flags on the session cookie (FR-08; TR-13)");
  const sessionCookie = (await page.context().cookies(`${baseUrl}/app`)).find(
    (cookie) => cookie.name.endsWith("session_token"),
  );
  check("session cookie present", Boolean(sessionCookie));
  const rawSessionSetCookie = setCookieCapture.find((value) =>
    value.startsWith("better-auth.session_token="),
  );
  if (rawSessionSetCookie) {
    const lower = rawSessionSetCookie.toLowerCase();
    check("Set-Cookie carries HttpOnly", lower.includes("httponly"), rawSessionSetCookie.slice(0, 80));
    check("Set-Cookie carries SameSite=Lax", lower.includes("samesite=lax"), rawSessionSetCookie.slice(0, 80));
    check("Set-Cookie carries Path=/", lower.includes("path=/"), rawSessionSetCookie.slice(0, 80));
    check(
      "Set-Cookie omits Secure on plain http APP_URL",
      !lower.includes("secure"),
      rawSessionSetCookie.slice(0, 80),
    );
  } else {
    check("raw Set-Cookie captured from an RPC response", false, "no set-cookie captured");
  }

  section("GTM/analytics absence on /app and auth HTML (FR-03/FR-38)");
  for (const path of ["/app", "/app/settings", "/sign-in"]) {
    const { response, body, contentType } = await fetchRoute(path);
    const isHtml =
      response.status === 200 && contentType.includes("text/html");
    check(
      `GET ${path} serves HTML when ready (or redirects)`,
      isHtml || [302, 303, 307, 308].includes(response.status),
      `status ${response.status} ${contentType}`,
    );
    if (isHtml) {
      check(
        `GET ${path} HTML has no googletagmanager/dataLayer/analytics`,
        !body.includes("googletagmanager") &&
          !body.includes("dataLayer") &&
          !body.includes("GTM-"),
        "analytics marker found in digital HTML",
      );
    }
  }

  section("TR-14 security headers on digital documents");
  const appHtml = await fetchRoute("/app", {
    headers: page.context().request
      ? {}
      : {},
  });
  const headers = appHtml.response.headers;
  check(
    "X-Content-Type-Options: nosniff on /app",
    headers.get("x-content-type-options") === "nosniff",
    String(headers.get("x-content-type-options")),
  );
  check(
    "Referrer-Policy on /app",
    headers.get("referrer-policy") === "strict-origin-when-cross-origin",
    String(headers.get("referrer-policy")),
  );
  check(
    "X-Frame-Options: DENY on /app",
    (headers.get("x-frame-options") ?? "").toLowerCase() === "deny",
    String(headers.get("x-frame-options")),
  );

  section("Sign-out clears cookie + deletes the session row (FR-08)");
  const userIdA = (
    await pool.query('SELECT id FROM "user" WHERE email = $1', [emailA])
  ).rows[0].id;
  const sessionsBefore = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  await page.goto(`${baseUrl}/app/settings`, { waitUntil: "load" });
  await page.click("text=\"Sign out\"");
  await page.waitForURL(`${baseUrl}/`, { timeout: 20000 });
  const sessionsAfter = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  check(
    `sign-out deleted the session row (${sessionsBefore} → ${sessionsAfter})`,
    sessionsBefore >= 1 && sessionsAfter === 0,
    `before ${sessionsBefore}, after ${sessionsAfter}`,
  );

  section("Unauthenticated /app redirects to /sign-in with a LOCAL return path");
  const appRedirect = await fetchRoute("/app");
  check(
    "GET /app redirects when unauthenticated",
    [302, 303, 307, 308].includes(appRedirect.response.status),
    `status ${appRedirect.response.status}`,
  );
  const location = appRedirect.response.headers.get("location") ?? "";
  check(
    "redirect target is /sign-in with a local return path",
    location.includes("/sign-in") && decodeURIComponent(location).includes("return=/app"),
    location,
  );

  section("Cookie replay after sign-out is rejected (AC-02)");
  // Sign in again, capture the cookie, sign out server-side by deleting the
  // session row (revocation), then replay the cookie against /app.
  await signInViaUi(page, emailA, passwordA);
  const replayCookie = (
    await page.context().cookies(`${baseUrl}/app`)
  ).find((cookie) => cookie.name.endsWith("session_token"));
  await pool.query('DELETE FROM "session" WHERE "userId" = $1', [userIdA]);
  const replay = await page.context().request.get(`${baseUrl}/app`, {
    maxRedirects: 0,
    headers: {
      cookie: `${replayCookie.name}=${replayCookie.value}`,
    },
  });
  check(
    "revoked session cookie replaying /app redirects to sign-in",
    [302, 303, 307, 308].includes(replay.status()),
    `status ${replay.status()}`,
  );

  section("Origin/CSRF rejection on a mutating server function (ADR-002 §1 control 1)");
  // Capture the real RPC endpoint + body from an actual form submit.
  let rpcCapture = null;
  const capturePage = await context.newPage();
  capturePage.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("_server") &&
      rpcCapture === null
    ) {
      rpcCapture = {
        url: request.url(),
        body: request.postData() ?? "",
        contentType: request.headers()["content-type"] ?? "application/json",
      };
    }
  });
  await capturePage.goto(`${baseUrl}/sign-in`, { waitUntil: "load" });
  await capturePage.fill("#email", `origin-probe-${Date.now()}@test.example`);
  await capturePage.fill("#password", "origin-probe-pass-123");
  await capturePage.click("button[type=submit]");
  await capturePage.waitForTimeout(1500);
  check("captured a real RPC request to replay", rpcCapture !== null);
  if (rpcCapture) {
    const forged = await fetch(rpcCapture.url, {
      method: "POST",
      headers: {
        "content-type": rpcCapture.contentType,
        origin: "https://evil.example",
        host: new URL(baseUrl).host,
      },
      body: rpcCapture.body,
    });
    check(
      "forged Origin on the RPC endpoint is rejected (403/4xx, JSON gate)",
      [403].includes(forged.status) || (forged.status >= 400 && forged.status < 500),
      `status ${forged.status}`,
    );
    const forgedBody = await forged.text();
    check(
      "forged-origin response is a rejection (403; never the `/` document)",
      forged.status === 403 &&
        !forgedBody.includes("<!DOCTYPE html>") &&
        forgedBody.length < 500,
      `status ${forged.status} body ${forgedBody.slice(0, 80)}`,
    );
    const originless = await fetch(rpcCapture.url, {
      method: "POST",
      headers: { "content-type": rpcCapture.contentType },
      body: rpcCapture.body,
    });
    check(
      "missing Origin on the RPC endpoint is rejected",
      [403].includes(originless.status),
      `status ${originless.status}`,
    );
  }
  await capturePage.close();

  section("Rate limiting: per-IP 429s that survive nothing in-process (AC-02)");
  if (rpcCapture) {
    let saw429 = false;
    let sawRetryAfter = false;
    const limitedEmail = `ratelimit-${Date.now()}@test.example`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(rpcCapture.url, {
        method: "POST",
        headers: {
          "content-type": rpcCapture.contentType,
          origin: baseUrl,
        },
        body: rpcCapture.body.replace(
          /"email":"[^"]*"/,
          `"email":"${limitedEmail}"`,
        ),
      });
      if (response.status === 429) {
        saw429 = true;
        sawRetryAfter = response.headers.get("retry-after") !== null;
        break;
      }
    }
    check("repeated sign-ins trip the limiter with 429", saw429);
    check("429 carries a Retry-After horizon", sawRetryAfter);
  }

  section("Password reset: single-use token, session revocation (FR-07)");
  await signInViaUi(page, emailA, passwordA);
  const resetEmail = `reset-${Date.now()}@test.example`;
  // Reuse the same verified account: request a reset for emailA.
  await drainMailpit();
  await page.goto(`${baseUrl}/forgot-password`, { waitUntil: "load" });
  await page.fill("#email", emailA);
  await page.click("button[type=submit]");
  await page.waitForSelector("p[role=status]", { timeout: 15000 });
  const resetMail = await latestMailTo(emailA);
  check(
    "reset email delivered with a single-use link",
    resetMail !== null && resetMail.text.includes("/reset-password?token="),
    resetMail ? resetMail.subject : "no reset mail",
  );
  const sessionsBeforeReset = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  check("a session exists before reset", sessionsBeforeReset >= 1);
  const resetToken = new URL(
    resetMail.text.match(/https?:\/\/\S*reset-password\?token=([^\s]+)/)?.[0],
  ).searchParams.get("token");
  const passwordNew = "reset-pass-987654321";
  await page.goto(`${baseUrl}/reset-password?token=${resetToken}`, { waitUntil: "load" });
  await page.fill("#new-password", passwordNew);
  await page.click("button[type=submit]");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
        /Password updated|invalid|expired|failed/i.test(p.textContent ?? ""),
      ),
    undefined,
    { timeout: 30000 },
  );
  const resetStatus = (await page.textContent("p[role=status]")) ?? "";
  check(
    "reset succeeds in the UI and states sessions were revoked",
    resetStatus.includes("Password updated") && resetStatus.includes("signed out"),
    resetStatus,
  );
  const sessionsAfterReset = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  check(
    "reset revoked prior sessions",
    sessionsAfterReset === 0,
    `sessions after reset: ${sessionsAfterReset}`,
  );
  const replayRejected = await (async () => {
    await page.goto(`${baseUrl}/reset-password?token=${resetToken}`, {
      waitUntil: "load",
    });
    await page.waitForSelector("#new-password", { timeout: 20000 });
    await page.fill("#new-password", "replay-pass-000000");
    await page.click("button[type=submit]");
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
          /invalid|expired|Password updated/i.test(p.textContent ?? ""),
        ),
      undefined,
      { timeout: 20000 },
    );
    const replayStatus = (await page.textContent("p[role=status]")) ?? "";
    return replayStatus.includes("invalid or has expired");
  })();
  check(
    "reset token is single-use (replay fails)",
    replayRejected,
  );
  // Old password dead, new password works.
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "load" });
  await page.fill("#email", emailA);
  await page.fill("#password", passwordA);
  await page.click("button[type=submit]");
  await page.waitForSelector("p[role=status]", { timeout: 15000 });
  const oldPasswordStatus = (await page.textContent("p[role=status]")) ?? "";
  check(
    "old password rejected after reset",
    oldPasswordStatus.includes("Invalid email or password"),
    oldPasswordStatus,
  );
  await signInViaUi(page, emailA, passwordNew);

  section("Password change revokes sessions via the F5 pairing (FR-08)");
  await page.goto(`${baseUrl}/app/settings`, { waitUntil: "load" });
  const passwordChanged = "changed-pass-112233";
  await page.fill("#current-password", passwordNew);
  await page.fill("#settings-new-password", passwordChanged);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/sign-in/, { timeout: 20000 });
  const sessionsAfterChange = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  check(
    "password change revoked every session (zero rows) and forced re-auth",
    sessionsAfterChange === 0,
    `sessions: ${sessionsAfterChange}`,
  );
  await signInViaUi(page, emailA, passwordChanged);

  section("Sign-out-all leaves zero session rows (FR-08)");
  await signInViaUi(page, emailA, passwordChanged);
  await pool.query(
    "INSERT INTO \"session\" (\"id\", \"expiresAt\", \"token\", \"userId\", \"createdAt\", \"updatedAt\") VALUES ($1, now() + interval '1 day', $2, $3, now(), now())",
    [`extra-${Date.now()}`, `extra-token-${Date.now()}`, userIdA],
  );
  await page.goto(`${baseUrl}/app/settings`, { waitUntil: "load" });
  await page.click("text=\"Sign out everywhere\"");
  await page.waitForURL(`${baseUrl}/`, { timeout: 20000 });
  const sessionsAfterAll = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userIdA])
  ).rows[0].n;
  check(
    "sign-out-all left zero session rows",
    sessionsAfterAll === 0,
    `sessions: ${sessionsAfterAll}`,
  );

  section("Child profiles: nickname-only CRUD, cap at 10, confirmation (FR-12/FR-36)");
  await signInViaUi(page, emailA, passwordChanged);
  await page.goto(`${baseUrl}/app`, { waitUntil: "load" });
  // create 10 — wait for each create to land before the next
  for (let index = 1; index <= 10; index += 1) {
    await page.fill("#new-nickname", `Kid ${String(index).padStart(2, "0")}`);
    await page.click("text=Add profile");
    await page.waitForFunction(
      (expected) =>
        ((document.querySelector("main")?.textContent ?? "").match(/Kid \d\d/g) ?? []).length >=
        expected,
      index,
      { timeout: 20000 },
    );
  }
  const listText = (await page.textContent("main")) ?? "";
  check(
    "ten profiles listed",
    (listText.match(/Kid \d\d/g) ?? []).length >= 10,
    listText.slice(0, 200),
  );
  // 11th rejected with LIMIT message
  await page.fill("#new-nickname", "Kid 11");
  await page.click("text=Add profile");
  await page.waitForSelector("p[role=alert]", { timeout: 15000 });
  const limitError = (await page.textContent("p[role=alert]")) ?? "";
  check(
    "the 11th profile is rejected with the limit error",
    limitError.includes("up to 10"),
    limitError,
  );
  // rename
  await page.click("li >> nth=0 >> text=Rename");
  await page.fill("li >> nth=0 >> input", "Kid Renamed");
  await page.click("li >> nth=0 >> text=Save");
  await page.waitForTimeout(400);
  check(
    "rename updates the profile",
    ((await page.textContent("main")) ?? "").includes("Kid Renamed"),
  );
  // delete requires the exact nickname
  const childIdFirst = (
    await pool.query(
      'SELECT id FROM "child_profile" WHERE "user_id" = $1 ORDER BY "created_at" ASC LIMIT 1',
      [userIdA],
    )
  ).rows[0]?.id;
  await page.click("li >> nth=0 >> text=Delete");
  await page.fill("li >> nth=0 >> input", "wrong-confirm");
  await page.click("li >> nth=0 >> text=Delete profile");
  try {
    await page.waitForFunction(
      () => /Type the nickname/i.test(document.querySelector("p[role=alert]")?.textContent ?? ""),
      undefined,
      { timeout: 20000 },
    );
  } catch {
    throw new Error("confirmation-rejection did not appear");
  }
  const confirmError = (await page.textContent("p[role=alert]")) ?? "";
  check(
    "delete without the exact nickname confirmation is rejected",
    confirmError.includes("Type the nickname"),
    confirmError,
  );
  await page.fill("li >> nth=0 >> input", "Kid Renamed");
  await page.click("li >> nth=0 >> text=Delete profile");
  try {
    // The success notice mentions the nickname; assert the PROFILE ROW left
    // the list (the li containing the Delete/Rename actions).
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("main li")).every(
          (li) => !(li.querySelector("button") && li.textContent?.includes("Kid Renamed")),
        ),
      undefined,
      { timeout: 20000 },
    );
  } catch {
    throw new Error("confirmed delete did not remove the profile");
  }
  check(
    "delete with the exact nickname removes the profile",
    (await page.$$eval("main li", (nodes) => nodes.length)) === 9,
  );

  section("Owner isolation over the real server functions (AC-04)");
  // Sign up account B in the background API sense: drive the UI.
  const emailB = `second-${Date.now()}@test.example`;
  const passwordB = "second-account-pass";
  // sign up (verification needed) — reuse Mailpit.
  await drainMailpit();
  const signUpPage = await page.context().newPage();
  const signUpBMessage = await sign_upViaUi(signUpPage, emailB, passwordB);
  const mailB = await latestMailTo(emailB);
  const tokenB = new URL(
    mailB.text.match(/https?:\/\/\S*verify-email\?token=([^\s]+)/)?.[0],
  ).searchParams.get("token");
  await signUpPage.goto(`${baseUrl}/verify-email?token=${tokenB}`, { waitUntil: "load" });
  await signUpPage.waitForTimeout(1000);
  await signInViaUi(signUpPage, emailB, passwordB);
  const userIdB = (
    await pool.query('SELECT id FROM "user" WHERE email = $1', [emailB])
  ).rows[0].id;
  check(
    "account B sees an empty child list (owner scoping in the real shell)",
    ((await signUpPage.textContent("main")) ?? "").includes(
      "No child profiles yet",
    ),
  );

  // B creates a profile, then renames it — capturing the UPDATE RPC whose
  // payload carries an id — and replays it against A's child id.
  await signUpPage.fill("#new-nickname", "Bs Own Kid");
  await signUpPage.click("text=Add profile");
  await signUpPage.waitForTimeout(800);
  check(
    "account B can create their own profile",
    ((await signUpPage.textContent("main")) ?? "").includes("Bs Own Kid"),
  );
  let bChildrenRpc = null;
  signUpPage.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("_server") &&
      bChildrenRpc === null &&
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(
        request.postData() ?? "",
      )
    ) {
      bChildrenRpc = {
        url: request.url(),
        body: request.postData() ?? "",
        contentType: request.headers()["content-type"] ?? "application/json",
      };
    }
  });
  await signUpPage.click("li >> nth=0 >> text=Rename");
  await signUpPage.fill("li >> nth=0 >> input", "Bs Renamed Kid");
  await signUpPage.click("li >> nth=0 >> text=Save");
  await signUpPage.waitForFunction(
    () => (document.querySelector("main")?.textContent ?? "").includes("Bs Renamed Kid"),
    undefined,
    { timeout: 20000 },
  );
  check("captured B's children-update RPC for the foreign-id probe", bChildrenRpc !== null);
  if (bChildrenRpc) {
    const foreignPayload = bChildrenRpc.body.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      childIdFirst,
    );
    const foreignResponse = await fetch(bChildrenRpc.url, {
      method: "POST",
      headers: {
        "content-type": bChildrenRpc.contentType,
        origin: baseUrl,
        cookie: (
          await signUpPage.context().cookies(`${baseUrl}`)
        )
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; "),
      },
      body: foreignPayload,
    });
    const foreignText = await foreignResponse.text();
    check(
      "B mutating A's child id returns the NOT_FOUND envelope",
      foreignText.includes("NOT_FOUND"),
      foreignText.slice(0, 200),
    );
  } else {
    check("captured B's children RPC for the foreign-id probe", false);
  }

  section("Unknown digital paths never hit the SSR catch-all");
  await signUpPage.close();
  const splatApp = await fetchRoute("/app/nonexistent", {
    headers: { cookie: (await page.context().cookies(`${baseUrl}`)).map((c) => `${c.name}=${c.value}`).join("; ") },
  });
  check(
    "/app/unknown (authenticated) answers 404 JSON",
    splatApp.response.status === 404 &&
      splatApp.contentType.includes("application/json") &&
      splatApp.body.includes("not_found"),
    `status ${splatApp.response.status} ${splatApp.contentType}`,
  );
  const splatAuth = await fetchRoute("/sign-in/unknown");
  check(
    "/sign-in/unknown answers gate JSON (503/404), never 200 HTML",
    (splatAuth.response.status === 503 || splatAuth.response.status === 404) &&
      splatAuth.contentType.includes("application/json"),
    `status ${splatAuth.response.status} ${splatAuth.contentType}`,
  );

  await browser.close();
  await pool.end();
}

// ---------------------------------------------------------------------------
// Phase: nosmtp (self-host without SMTP; AC-03/FR-06/FR-09)
// ---------------------------------------------------------------------------
async function runNoSmtp() {
  section("Phase: nosmtp — self-host without SMTP (AC-03)");
  const pool = await db();

  const readyz = await fetchRoute("/readyz");
  check(
    "/readyz is 200 with database+auth ok",
    readyz.response.status === 200 &&
      readyz.body.includes('"name":"database"') &&
      readyz.body.includes('"name":"auth"'),
    `status ${readyz.response.status} body ${readyz.body.slice(0, 200)}`,
  );
  check(
    "/readyz has no smtp/stripe entries in self-host",
    !readyz.body.includes('"smtp"') && !readyz.body.includes('"stripe"'),
    readyz.body.slice(0, 300),
  );
  const healthz = await fetchRoute("/healthz");
  check("/healthz is 200 JSON", healthz.response.status === 200 && healthz.contentType.includes("application/json"));
  const root = await fetchRoute("/");
  check(
    "/ stays 200 HTML without any GTM (self-host)",
    root.response.status === 200 &&
      root.contentType.includes("text/html") &&
      !root.body.includes("googletagmanager"),
  );

  const { browser, page } = await newPage();
  const email = `nosmtp-${Date.now()}@test.example`;
  const passwordA = "nosmtp-pass-123456";
  await page.goto(`${baseUrl}/sign-up`, { waitUntil: "load" });
  const notice = (await page.textContent("p[role=status]")) ?? "";
  check(
    "sign-up page states the no-SMTP operator limitation",
    notice.includes("does not send email") && notice.includes("operator"),
    notice,
  );
  await page.fill("#email", email);
  await page.fill("#password", passwordA);
  await page.click("button[type=submit]");
  // The result notice (not the static info notice above the form).
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
        /Your account is ready/i.test(p.textContent ?? ""),
      ),
    undefined,
    { timeout: 20000 },
  );
  const signUpStatus = (await page.$$eval("p[role=status]", (nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  )).find((text) => /Your account is ready/i.test(text)) ?? "";
  check(
    "sign-up completes WITHOUT verification (generic ready message)",
    signUpStatus.includes("Your account is ready"),
    signUpStatus,
  );

  section("Operator reset command (FR-09/AC-03)");
  // Sign in to create a session, then the command must revoke it.
  await signInViaUi(page, email, passwordA);
  const userId = (
    await pool.query('SELECT id FROM "user" WHERE email = $1', [email])
  ).rows[0].id;
  const sessionsBefore = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userId])
  ).rows[0].n;
  check("a session exists before the operator reset", sessionsBefore >= 1);

  const newPassword = "operator-pass-654321";
  const resetRun = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/reset-password.mjs",
      email,
      newPassword,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL },
      encoding: "utf8",
    },
  );
  const resetOutput = `${resetRun.stdout ?? ""}${resetRun.stderr ?? ""}`;
  check(
    "operator reset command succeeds and reports revocation",
    resetRun.status === 0 && resetOutput.includes("password updated") && resetOutput.includes("session(s) revoked"),
    `exit ${resetRun.status}: ${resetOutput.slice(0, 300)}`,
  );
  check(
    "operator reset output never echoes the connection URL or password",
    !resetOutput.includes(newPassword) && !/postgres:\/\/[^*]/.test(resetOutput),
    resetOutput.slice(0, 200),
  );

  const sessionsAfterReset = (
    await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1', [userId])
  ).rows[0].n;
  check(
    "operator reset revoked the user's sessions",
    sessionsAfterReset === 0,
    `sessions: ${sessionsAfterReset}`,
  );
  const replay = await page.context().request.get(`${baseUrl}/app`, { maxRedirects: 0 });
  check(
    "pre-reset cookie replay is rejected after the operator reset",
    [302, 303, 307, 308].includes(replay.status()),
    `status ${replay.status()}`,
  );
  await signInViaUi(page, email, newPassword);
  check("sign-in with the operator-set password reaches /app", page.url().startsWith(`${baseUrl}/app`));

  section("The operator command has no HTTP surface");
  const probe = await fetchRoute("/reset-password-command", { method: "POST", body: "{}" });
  check(
    "no HTTP route serves the operator command (unknown paths never expose it)",
    (probe.response.status === 404 || probe.response.status === 200) &&
      !probe.body.includes("reset-password: password updated"),
    `status ${probe.response.status} ${probe.contentType}`,
  );
  const builtServer = await import("node:fs/promises").then((fs) =>
    fs.readFile(".output/server/index.mjs", "utf8").catch(() => ""),
  );
  check(
    "the built server never references the reset command script",
    !builtServer.includes("reset-password.mjs"),
    "found reset-password.mjs reference in .output",
  );

  await browser.close();
  await pool.end();
}

// ---------------------------------------------------------------------------
// Phase: secure-cookie (server started with an https APP_URL)
//
// The browser talks to https://appsecure.example:4744 — a local TLS
// terminator in front of the plain-http server (a self-signed cert is
// accepted via Chrome flags and the hostname resolved by host-resolver-rules)
// — so the BROWSER ORIGIN EQUALS APP_URL, exactly as in production. The
// sign-up Set-Cookie is captured from the real RPC response.
// ---------------------------------------------------------------------------
async function runSecureCookie() {
  section("Phase: secure-cookie — Secure attribute when APP_URL is HTTPS");
  const pool = await db();
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      "--host-resolver-rules=MAP appsecure.example 127.0.0.1",
      "--ignore-certificate-errors",
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let sessionSetCookie = null;
  page.on("response", (response) => {
    if (response.request().method() === "POST" && sessionSetCookie === null) {
      void response
        .allHeaders()
        .then((headers) => {
          const setCookie = headers["set-cookie"];
          if (setCookie) {
            for (const value of setCookie.split("\n")) {
              if (value.includes("session_token=")) {
                sessionSetCookie = value;
              }
            }
          }
        })
        .catch(() => {});
    }
  });
  const httpsBase = "https://appsecure.example:4744";
  const email = `secure-${Date.now()}@test.example`;
  await page.goto(`${httpsBase}/sign-up`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", "secure-pass-123456");
  await page.click("button[type=submit]");
  // The no-SMTP secure server signs the account in at sign-up.
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p[role=status]")).some((p) =>
        /Your account is ready/i.test(p.textContent ?? ""),
      ),
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);
  check("captured a session Set-Cookie", sessionSetCookie !== null);
  if (sessionSetCookie) {
    const lower = sessionSetCookie.toLowerCase();
    check(
      "Set-Cookie carries Secure when APP_URL is HTTPS (ADR-002 §1 control 4)",
      lower.includes("secure"),
      sessionSetCookie.slice(0, 140),
    );
    check("Set-Cookie carries HttpOnly", lower.includes("httponly"), sessionSetCookie.slice(0, 140));
    check("Set-Cookie carries SameSite=Lax", lower.includes("samesite=lax"), sessionSetCookie.slice(0, 140));
    check("Set-Cookie carries Path=/", lower.includes("path=/"), sessionSetCookie.slice(0, 140));
  }
  await browser.close();
  await pool.end();
}

if (phase === "identity") {
  await runIdentity();
} else if (phase === "nosmtp") {
  await runNoSmtp();
} else if (phase === "secure-cookie") {
  await runSecureCookie();
} else {
  console.error(`unknown phase ${phase} (identity|nosmtp|secure-cookie)`);
  process.exit(2);
}

console.log(
  `\nE2E ${phase}: ${passes} passed, ${failures} failed${failures > 0 ? " → FAILING" : ""}`,
);
if (failures > 0) {
  process.exit(1);
}
