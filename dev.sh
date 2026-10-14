#!/usr/bin/env bash
# Run backend + teacher-app + student-app together for local dev
# Ctrl+C stops all three

set -e
cd "$(dirname "$0")"

pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd backend     && node server.js)        & pids+=($!)
(cd teacher-app && npm run dev)           & pids+=($!)
(cd student-app && npm run dev)           & pids+=($!)

wait
