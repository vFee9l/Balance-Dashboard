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
echo "[1/6] Pulling latest code from git..."
git pull --ff-only

# --- Install / update dependencies ---
echo ""
echo "[2/6] Installing dependencies..."
pnpm install --frozen-lockfile

# --- Apply database migrations ---
# This script is idempotent — safe to run on every update.
# It handles column renames and new tables that drizzle-kit push cannot
# apply automatically in a non-interactive (non-TTY) environment.
echo ""
echo "[3/6] Applying database migrations..."
pnpm --filter @workspace/scripts run migrate

# --- Build frontend ---
echo ""
echo "[4/6] Building React frontend..."
pnpm --filter @workspace/balance-alerts run build

# --- Build API server ---
echo ""
echo "[5/6] Building API server..."
pnpm --filter @workspace/api-server run build

# --- Restart pm2 process ---
echo ""
echo "[6/6] Restarting pm2 process '$APP_NAME'..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  echo "Process not found in pm2 — starting fresh..."
  pm2 start "$APP_DIR/ecosystem.config.cjs"
  pm2 save
fi

echo ""
echo "=============================================="
echo " Update complete!"
echo " App running at http://localhost:${PORT:-3030}"
echo "=============================================="
