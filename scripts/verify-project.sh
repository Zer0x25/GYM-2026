#!/usr/bin/env bash
# Project gate for GYM-2026: lint, typecheck, build, unit and integration tests.
# Errors propagate; never hide failures with || true.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { printf 'QUALITY GATE ERROR: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node no está instalado (requerido: Node 22)."
command -v pnpm >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 || fail "pnpm/corepack no está disponible."

run() { printf '> %s\n' "$*"; "$@"; }

# Root + workspace checks.
# build BEFORE typecheck: @gym/db and @gym/contracts publish their types from
# dist/, so apps/api typechecks against generated .d.ts. On a clean CI checkout
# (no dist yet) typecheck-first fails with "Cannot find module '@gym/db'".
# pnpm -r runs in topological order (packages before dependent apps).
run pnpm install --frozen-lockfile
run pnpm -r lint
run pnpm -r build
run pnpm -r typecheck
run pnpm -r test

printf 'Gate de proyecto GYM-2026: verde (lint, typecheck, build, tests).\n'
