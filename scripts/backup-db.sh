#!/usr/bin/env bash
# Reproducible PostgreSQL custom-format backup script (Spec 023, REQ-11).
set -euo pipefail

CONTAINER="${PG_CONTAINER:-gym-dev-pg}"
DB_USER="${POSTGRES_USER:-gym}"
DB_NAME="${POSTGRES_DB:-gym}"
OUT_FILE="${1:-./gym_backup_$(date -u +%Y%m%dT%H%M%SZ).dump}"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f /tmp/gym_backup.dump
docker cp "${CONTAINER}:/tmp/gym_backup.dump" "$OUT_FILE"
docker exec "$CONTAINER" rm -f /tmp/gym_backup.dump
chmod 0600 "$OUT_FILE"
printf 'Backup completado: %s\n' "$OUT_FILE"
