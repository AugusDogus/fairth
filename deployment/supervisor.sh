#!/usr/bin/env bash

set -euo pipefail

export ADB_ENDPOINT="${ADB_ENDPOINT:-android:5555}"
export ANDROID_WORKER_DATA="${ANDROID_WORKER_DATA:-/data/fairth/worker}"
export AUTH_DATA_ROOT="${AUTH_DATA_ROOT:-/data/fairth/web}"
export HOME="${FAIRTH_HOME:-/data/fairth/home}"
export INCOMING_ROOT="${INCOMING_ROOT:-/incoming}"
export ANDROID_WORKER_URL="${ANDROID_WORKER_URL:-http://127.0.0.1:3001}"
export HOST="${HOST:-0.0.0.0}"
export HOSTNAME="${FAIRTH_HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export HEALTH_PORT="${HEALTH_PORT:-3001}"
export PROVISIONING_STATE_DIRECTORY="${PROVISIONING_STATE_DIRECTORY:-/data/fairth/provisioning}"
export POLL_INTERVAL_MS="${POLL_INTERVAL_MS:-${ANDROID_WORKER_POLL_INTERVAL_MS:-5000}}"
export STABLE_FOR_MS="${STABLE_FOR_MS:-${ANDROID_WORKER_STABLE_FOR_MS:-15000}}"
export MAX_RETRIES="${MAX_RETRIES:-${ANDROID_WORKER_MAX_RETRIES:-8}}"

mkdir -p "${ANDROID_WORKER_DATA}" "${AUTH_DATA_ROOT}" "${HOME}" "${INCOMING_ROOT}"

pids=()

stop_services() {
  trap - INT TERM EXIT
  if ((${#pids[@]} > 0)); then
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}

trap stop_services INT TERM EXIT

bun /app/apps/android-worker/dist/main.js &
pids+=("$!")

(
  cd /app/apps/web
  bun server.js
) &
pids+=("$!")

/usr/local/bin/fairth-android-viewer &
pids+=("$!")

wait -n "${pids[@]}"
