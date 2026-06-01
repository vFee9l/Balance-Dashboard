#!/usr/bin/env bash
# =============================================================================
# Balance Alert — Auto-Update Script
# Usage: bash /opt/balance-alert/scripts/update.sh
# =============================================================================
set -euo pipefail

APP_DIR="/opt/balance-alert"
APP_NAME="balance-alert"
ENV_FILE="$APP_DIR/.env"

echo "=============================================="
echo " Balance Alert — Updating Application"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# --- Load environment variables ---
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE"
  exit 1
fi
set -o allexport
# shellcheck disable=SC1090
source "$ENV_FILE"
set +o allexport

cd "$APP_DIR"

# --- Pull latest code ---
echo ""
echo "[1/5] Pulling latest code from git..."
git pull --ff-only

# --- Install / update dependencies ---
echo ""
echo "[2/5] Installing dependencies..."
pnpm install --frozen-lockfile

# --- Build frontend ---
echo ""
echo "[3/5] Building React frontend..."
pnpm --filter @workspace/balance-alerts run build

# --- Build API server ---
echo ""
echo "[4/5] Building API server..."
pnpm --filter @workspace/api-server run build

# --- Push database schema ---
echo ""
echo "[5/5] Applying database schema changes..."
pnpm --filter @workspace/db run push

# --- Restart pm2 process ---
echo ""
echo "Restarting pm2 process '$APP_NAME'..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  echo "Process not found in pm2 — starting fresh..."
  pm2 start "$APP_DIR/artifacts/api-server/dist/index.mjs" \
    --name "$APP_NAME" \
    --env-file "$ENV_FILE" \
    --interpreter node
  pm2 save
fi

echo ""
echo "=============================================="
echo " Update complete!"
echo " App running at http://localhost:${PORT:-3030}"
echo "=============================================="
