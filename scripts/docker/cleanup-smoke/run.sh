#!/usr/bin/env bash
set -euo pipefail

cd /repo

export EDWINPAI_STATE_DIR="/tmp/edwinpai-test"
export EDWINPAI_CONFIG_PATH="${EDWINPAI_STATE_DIR}/edwinpai.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${EDWINPAI_STATE_DIR}/credentials"
mkdir -p "${EDWINPAI_STATE_DIR}/agents/main/sessions"
echo '{}' >"${EDWINPAI_CONFIG_PATH}"
echo 'creds' >"${EDWINPAI_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${EDWINPAI_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm edwinpai reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${EDWINPAI_CONFIG_PATH}"
test ! -d "${EDWINPAI_STATE_DIR}/credentials"
test ! -d "${EDWINPAI_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${EDWINPAI_STATE_DIR}/credentials"
echo '{}' >"${EDWINPAI_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm edwinpai uninstall --state --yes --non-interactive

test ! -d "${EDWINPAI_STATE_DIR}"

echo "OK"
