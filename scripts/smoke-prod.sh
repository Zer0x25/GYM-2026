#!/usr/bin/env bash
# Smoke check post-despliegue de producción para App GYM (Spec 027, REQ-11, CAL-1).
# Verifica salud del servicio, sonda de preparación de base de datos y protección de rutas.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"

echo "Iniciando smoke-check de producción contra ${BASE_URL}..."

TMP_DIR="$(mktemp -d /tmp/gym_smoke_XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# 1. /health debe responder 200 con status "ok"
echo "Comprobando /health..."
HEALTH_STATUS=$(curl -s -o "${TMP_DIR}/health.json" -w "%{http_code}" "${BASE_URL}/health")
if [[ "$HEALTH_STATUS" -ne 200 ]]; then
  echo "ERROR: /health respondió HTTP ${HEALTH_STATUS} (se esperaba 200)" >&2
  exit 1
fi
if ! grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' "${TMP_DIR}/health.json"; then
  echo "ERROR: /health no contiene status 'ok'" >&2
  cat "${TMP_DIR}/health.json" >&2
  exit 1
fi
echo "✓ /health OK (HTTP 200)"

# 2. /health/ready debe responder 200 con status "ready" y db "ok"
echo "Comprobando /health/ready..."
READY_STATUS=$(curl -s -o "${TMP_DIR}/ready.json" -w "%{http_code}" "${BASE_URL}/health/ready")
if [[ "$READY_STATUS" -ne 200 ]]; then
  echo "ERROR: /health/ready respondió HTTP ${READY_STATUS} (se esperaba 200)" >&2
  cat "${TMP_DIR}/ready.json" >&2
  exit 1
fi
if ! grep -q '"status"[[:space:]]*:[[:space:]]*"ready"' "${TMP_DIR}/ready.json" || ! grep -q '"db"[[:space:]]*:[[:space:]]*"ok"' "${TMP_DIR}/ready.json"; then
  echo "ERROR: /health/ready no contiene status 'ready' o db 'ok'" >&2
  cat "${TMP_DIR}/ready.json" >&2
  exit 1
fi
echo "✓ /health/ready OK (HTTP 200, db ok)"

# 3. Rutas protegidas deben rechazar peticiones anónimas con 401 UNAUTHENTICATED
echo "Comprobando rechazo 401 en rutas protegidas anónimas (/api/v1/admin/system-status)..."
PROTECTED_STATUS=$(curl -s -o "${TMP_DIR}/protected.json" -w "%{http_code}" "${BASE_URL}/api/v1/admin/system-status")
if [[ "$PROTECTED_STATUS" -ne 401 ]]; then
  echo "ERROR: /api/v1/admin/system-status respondió HTTP ${PROTECTED_STATUS} (se esperaba 401)" >&2
  cat "${TMP_DIR}/protected.json" >&2
  exit 1
fi
if ! grep -q 'UNAUTHENTICATED' "${TMP_DIR}/protected.json"; then
  echo "ERROR: /api/v1/admin/system-status no retornó código UNAUTHENTICATED" >&2
  cat "${TMP_DIR}/protected.json" >&2
  exit 1
fi
echo "✓ /api/v1/admin/system-status protegido OK (HTTP 401 UNAUTHENTICATED)"

echo "Smoke-check de producción completado exitosamente."
exit 0
