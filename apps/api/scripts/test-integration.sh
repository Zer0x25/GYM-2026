#!/usr/bin/env bash
# Runs the three integration suites, each against its OWN isolated database.
#
# Why: the suites TRUNCATE overlapping schemas (organizations, "user", plans…),
# so they must never share a database or run concurrently. A single global
# TEST_DATABASE_URL makes all three point at the same DB and corrupt each
# other. Each file pins its own database via TEST_DATABASE_URL here.
#
# Requires the gym-test-pg container on :55432 (see docs/operations/runbook.md).
set -euo pipefail

cd "$(dirname "$0")/.."
PW="${PGTEST_PASSWORD:-gymtestpass}"
BASE="postgres://gym:${PW}@localhost:55432"

run_suite() {
  local file="$1" db="$2"
  echo "── ${file} → ${db}"
  TEST_DATABASE_URL="${BASE}/${db}" pnpm exec vitest run "src/${file}"
}

run_suite "payments.integration.test.ts"  "gym_test_payments"
run_suite "cash.integration.test.ts"      "gym_test_cash"
run_suite "bookings.integration.test.ts"  "gym_test_clases"
run_suite "offline.integration.test.ts"   "gym_test_offline"
run_suite "session-revocation.integration.test.ts" "gym_test_revoke"
echo "── all integration suites passed"
