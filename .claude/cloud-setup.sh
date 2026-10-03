#!/bin/bash
# Setup script for Claude Code cloud sessions (claude.ai/code → environment → Setup script).
# Paste the contents of this file into the environment's setup script field.
# Everything here is a warm-up and must never fail: a failing setup script stops every new
# session before it starts (2026-09-29). Sessions re-run this file themselves when Node 24
# or pnpm 12 is missing.
set -uo pipefail

if ! node --version 2>/dev/null | grep -q '^v24'; then
  { npm install -g n && n 24 && hash -r; } >/dev/null 2>&1 || echo "WARN: could not install Node 24"
fi
node --version || true

# pnpm from npm, not corepack: corepack's signing keys went stale ("Cannot find matching keyid").
export COREPACK_ENABLE_STRICT=0
npm install -g --force pnpm@12.6.0 >/dev/null 2>&1 || echo "WARN: pnpm install failed"
pnpm --version || true

if command -v docker >/dev/null 2>&1; then
  (service docker start >/dev/null 2>&1 || true)
  for img in pgvector/pgvector:pg18 redis:7 axllent/mailpit:latest; do
    docker pull "$img" >/dev/null 2>&1 || echo "WARN: $img pull failed"
  done
fi

if [ -f package.json ] && grep -q '"@playwright/test"' package.json 2>/dev/null; then
  pnpm install --frozen-lockfile || echo "WARN: pnpm install failed during setup; sessions install on start"
fi

echo "Yayatoh cloud environment ready."
exit 0
