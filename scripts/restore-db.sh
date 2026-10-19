#!/usr/bin/env bash
# Reproducible PostgreSQL restore & verification script into a clean target database (Spec 023, REQ-11).
set -euo pipefail

DUMP_FILE="${1:?Uso: ./scripts/restore-db.sh <ruta-al-dump> [bd-destino]}"
TARGET_DB="${2:-gym_restore_check}"
CONTAINER="${PG_CONTAINER:-gym-dev-pg}"
DB_USER="${POSTGRES_USER:-gym}"

[[ -f "$DUMP_FILE" ]] || { printf 'No existe el archivo de backup: %s\n' "$DUMP_FILE" >&2; exit 1; }

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\""
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\""
docker cp "$DUMP_FILE" "${CONTAINER}:/tmp/gym_restore.dump"
docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$TARGET_DB" --no-owner /tmp/gym_restore.dump
docker exec "$CONTAINER" rm -f /tmp/gym_restore.dump

printf 'Restore completado y verificado sobre base limpia: %s\n' "$TARGET_DB"
