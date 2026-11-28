#!/usr/bin/env bash
# Auth compatibility spike — end-to-end reproducible run (test-only).
# From a clean checkout: infra -> deps -> migrate -> build -> serve -> verify.
#
# Two execution modes (auto-detected):
# - local:     published container ports reachable on 127.0.0.1
#              (postgres 127.0.0.1:55432, mailpit smtp 127.0.0.1:8125, api 127.0.0.1:18025)
# - container: everything runs inside the compose network via the node:22-bookworm
#              `runner` service (used for remote Docker daemons and to produce
#              Node 22 evidence matching CI).
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RESULTS="$ROOT/results"
mkdir -p "$RESULTS"

SPIKE_APP_PORT=3300

if timeout 1 bash -c 'echo > /dev/tcp/127.0.0.1/55432' 2>/dev/null; then
  MODE=local
  export AUTH_DATABASE_URL="${AUTH_DATABASE_URL:-postgres://spiketest:spiketest@127.0.0.1:55432/spiketest}"
  export SMTP_HOST="${SMTP_HOST:-127.0.0.1}"
  export SMTP_PORT="${SMTP_PORT:-8125}"
  export SPIKE_MAILPIT_API="${SPIKE_MAILPIT_API:-http://127.0.0.1:18025}"
  export SPIKE_RUNNER_IMAGE="(local host execution)"
else
  MODE=container
  export AUTH_DATABASE_URL="${AUTH_DATABASE_URL:-postgres://spiketest:spiketest@postgres:5432/spiketest}"
  export SMTP_HOST="${SMTP_HOST:-mailpit}"
  export SMTP_PORT="${SMTP_PORT:-1025}"
  export SPIKE_MAILPIT_API="${SPIKE_MAILPIT_API:-http://mailpit:8025}"
  export SPIKE_RUNNER_IMAGE="node:22-bookworm"
fi
export AUTH_BASE_URL="${AUTH_BASE_URL:-http://127.0.0.1:$SPIKE_APP_PORT}"
export SPIKE_BASE_URL="$AUTH_BASE_URL"

echo "spike run mode: $MODE"

step() { printf '\n=== %s ===\n' "$1"; }

SERVER_LOCAL_PID=""
cleanup() {
  if [ -n "$SERVER_LOCAL_PID" ]; then kill "$SERVER_LOCAL_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

# Sync the harness source into the runner container (remote-daemon safe:
# bind mounts would refer to the daemon host filesystem, not this one).
sync_to_runner() {
  tar -cf - \
    --exclude=./node_modules \
    --exclude=./.output \
    --exclude=./.nitro \
    --exclude=./results \
    --exclude=./.env \
    . | docker compose exec -T runner sh -c 'rm -rf /harness && mkdir -p /harness && tar -xf - -C /harness'
}

fetch_results() {
  docker cp auth-spike-runner:/harness/results/. "$RESULTS/"
}

# Run a command in the execution environment (host or runner container).
run_in_env() {
  if [ "$MODE" = local ]; then
    env AUTH_DATABASE_URL="$AUTH_DATABASE_URL" AUTH_BASE_URL="$AUTH_BASE_URL" \
        SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" \
        SPIKE_BASE_URL="$SPIKE_BASE_URL" SPIKE_MAILPIT_API="$SPIKE_MAILPIT_API" \
        SPIKE_RUNNER_IMAGE="$SPIKE_RUNNER_IMAGE" "$@"
  else
    docker compose exec -T -w /harness runner env \
      AUTH_DATABASE_URL="$AUTH_DATABASE_URL" AUTH_BASE_URL="$AUTH_BASE_URL" \
      SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" \
      SPIKE_BASE_URL="$SPIKE_BASE_URL" SPIKE_MAILPIT_API="$SPIKE_MAILPIT_API" \
      SPIKE_RUNNER_IMAGE="$SPIKE_RUNNER_IMAGE" "$@"
  fi
}

step "1/7 ephemeral infra (postgres:16 + mailpit + runner)"
docker compose up -d --wait || { echo "FATAL: containers failed"; exit 1; }

# Kill any server left running in the runner container by a previous run
docker compose exec -T runner sh -c 'pkill -f "output/server/index.mjs" 2>/dev/null; sleep 0.5' || true

if [ "$MODE" = container ]; then
  echo "syncing harness source into runner container..."
  sync_to_runner || { echo "FATAL: source sync failed"; exit 1; }
fi

# Host-side container image digests for the evidence record
{
  for image in postgres:16 axllent/mailpit:latest node:22-bookworm; do
    docker image inspect --format '{{.Id}} {{join .RepoDigests ","}}' "$image" 2>/dev/null | sed "s|^|$image |"
  done
} > "$RESULTS/container-images.txt"
docker compose config > "$RESULTS/compose-config.txt" 2>/dev/null

step "2/7 install harness dependencies (isolated package; no lifecycle scripts)"
if [ -f package-lock.json ]; then
  run_in_env npm ci --ignore-scripts || { echo "FATAL: npm ci failed"; exit 1; }
else
  run_in_env npm install --ignore-scripts || { echo "FATAL: npm install failed"; exit 1; }
fi

step "3/7 version inventory"
run_in_env node scripts/collect-versions.mjs > "$RESULTS/versions-collect.log" 2>&1
echo "results/versions.json written"

step "4/7 one-shot auth migration (better-auth db/migration runner)"
set +e
run_in_env node --experimental-strip-types scripts/migrate.mjs > "$RESULTS/migration.log" 2>&1
MIGRATE_EXIT=$?
set -e
echo "$MIGRATE_EXIT" > "$RESULTS/migration.exit-code"
echo "migrate exit code: $MIGRATE_EXIT (results/migration.log)"
tail -3 "$RESULTS/migration.log"

step "5/7 build harness app (vite + nitro node-server)"
run_in_env npm run build > "$RESULTS/build.log" 2>&1 || { echo "FATAL: build failed (results/build.log)"; exit 1; }
tail -3 "$RESULTS/build.log"

step "6/7 start harness app"
if [ "$MODE" = local ]; then
  env AUTH_DATABASE_URL="$AUTH_DATABASE_URL" AUTH_BASE_URL="$AUTH_BASE_URL" \
      SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" PORT="$SPIKE_APP_PORT" \
      node "$ROOT/.output/server/index.mjs" > "$RESULTS/server.log" 2>&1 &
  SERVER_LOCAL_PID=$!
else
  # Keep the exec client alive locally so the in-container server survives.
  docker compose exec -T -w /harness runner env \
    AUTH_DATABASE_URL="$AUTH_DATABASE_URL" AUTH_BASE_URL="$AUTH_BASE_URL" \
    SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" PORT="$SPIKE_APP_PORT" \
    node .output/server/index.mjs > "$RESULTS/server.log" 2>&1 &
  SERVER_LOCAL_PID=$!
fi

ready=0
for i in $(seq 1 60); do
  if [ "$MODE" = local ]; then
    if curl -sf -o /dev/null "$AUTH_BASE_URL/"; then ready=1; break; fi
  else
    if docker compose exec -T -w /harness runner node -e "fetch('http://127.0.0.1:3300/').then(r=>{console.log('http',r.status);process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  fi
  if ! kill -0 "$SERVER_LOCAL_PID" 2>/dev/null; then
    echo "FATAL: server exited early (results/server.log)"; tail -20 "$RESULTS/server.log"; exit 1
  fi
  sleep 1
done
[ "$ready" = 1 ] && grep -q "Listening" "$RESULTS/server.log" && echo "app ready on $AUTH_BASE_URL" || { echo "FATAL: app did not become ready (results/server.log)"; tail -20 "$RESULTS/server.log"; exit 1; }

step "7/7 verification matrix"
VERIFY_EXIT=0
# `|| VERIFY_EXIT=$?` keeps errexit from aborting before the status is
# captured, and results/evidence fetching below still runs on failure.
run_in_env node scripts/verify.mjs || VERIFY_EXIT=$?
echo "verify exit code: $VERIFY_EXIT"

if [ "$MODE" = container ]; then
  fetch_results || echo "WARN: could not fetch container results (verifier status still propagated)"
fi

echo
echo "Done. Evidence in $RESULTS:"
ls -la "$RESULTS"
exit "$VERIFY_EXIT"
