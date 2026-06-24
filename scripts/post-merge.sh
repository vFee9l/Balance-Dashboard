#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate
