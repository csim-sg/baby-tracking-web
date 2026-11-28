#!/usr/bin/env node
/**
 * Records the exact toolchain versions used for the spike evidence.
 * Writes results/versions.json. Runs inside the execution environment
 * (local host or the node:22-bookworm runner container).
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Client } from "pg";

const harnessDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(harnessDir + "package.json");
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).stdout?.trim();

const harnessPkg = JSON.parse(readFileSync(harnessDir + "package.json", "utf8"));

const installed = {};
for (const dep of Object.keys({ ...harnessPkg.dependencies, ...harnessPkg.devDependencies })) {
  try {
    installed[dep] = require(`${dep}/package.json`).version;
  } catch {
    // packages whose exports map hides package.json: read the file directly
    try {
      installed[dep] = JSON.parse(readFileSync(harnessDir + `node_modules/${dep}/package.json`, "utf8")).version;
    } catch {
      try {
        installed[dep] = JSON.parse(readFileSync(harnessDir + `node_modules/${dep}/node_modules/${dep}/package.json`, "utf8")).version;
      } catch {
        installed[dep] = "NOT INSTALLED";
      }
    }
  }
}

const nodeInfo = {
  processVersion: process.version,
  ciBaseline: "22 (CI workflows/Dockerfile use node 22)",
  npm: run("npm", ["--version"]),
  platform: `${process.platform} ${process.arch}`,
};

const DATABASE_URL =
  process.env.AUTH_DATABASE_URL ??
  "postgres://spiketest:spiketest@127.0.0.1:55432/spiketest";

let pgServerVersion = null;
try {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  pgServerVersion = (await pg.query("SELECT version() as v")).rows[0].v;
  await pg.end();
} catch {
  pgServerVersion = "(postgres not reachable at collection time)";
}

const versions = {
  collectedAt: new Date().toISOString(),
  executionEnvironment: {
    mode: process.env.SPIKE_RUNNER_IMAGE ? (process.env.SPIKE_RUNNER_IMAGE.startsWith("node:") ? "container (compose runner service)" : "local host") : "unknown",
    runnerImage: process.env.SPIKE_RUNNER_IMAGE ?? null,
    note: "container-images.txt records image IDs/RepoDigests captured from the host side by run-all.sh",
  },
  node: nodeInfo,
  harness: {
    path: "scripts/spikes/auth-compat/",
    isolatedFromRootPackage: true,
    declaredExact: {
      dependencies: harnessPkg.dependencies,
      devDependencies: harnessPkg.devDependencies,
    },
    installed,
  },
  postgresServer: pgServerVersion,
  cliPairing: {
    betterAuthCliInvoked:
      "not used; deprecated @better-auth/cli@1.4.22 cannot drive better-auth@1.7.28 (verified 2026-11-28). Harness migrates via better-auth@1.7.28's own db/migration export: node --experimental-strip-types scripts/migrate.mjs",
    note: "One-shot migration command paired exactly with the runtime version (FR-41); plan + result recorded in results/migration.log",
  },
};

const out = harnessDir + "results/versions.json";
mkdirSync(harnessDir + "results", { recursive: true });
writeFileSync(out, JSON.stringify(versions, null, 2));
console.log(JSON.stringify(versions, null, 2));
console.log(`\nWritten: ${out}`);
