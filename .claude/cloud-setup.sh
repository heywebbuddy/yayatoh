#!/bin/bash
# Setup script for Claude Code cloud sessions (claude.ai/code → environment → Setup script).
# Paste the contents of this file into the environment's setup script field.
# Must finish in ~5 minutes so the environment image is cached.
set -euo pipefail

# Node 24 LTS (the cloud image ships Node 22). Fall back to 22 if the download fails.
if ! node --version 2>/dev/null | grep -q '^v24'; then
  if npm install -g n >/dev/null 2>&1 && n 24 >/dev/null 2>&1; then
    hash -r
  else
    echo "WARN: could not install Node 24; continuing with $(node --version)"
  fi
fi
node --version

# pnpm from npm, not corepack: corepack's pinned signing keys went stale (2026-09-29,
# "Cannot find matching keyid") and failed every new session under set -e.
export COREPACK_ENABLE_STRICT=0
npm install -g --force pnpm@12.6.0
pnpm --version

# Service images for integration and tenant-isolation tests (Postgres 18, Redis, Mailpit)
if command -v docker >/dev/null 2>&1; then
  (service docker start >/dev/null 2>&1 || true)
  docker pull postgres:18 >/dev/null 2>&1 || echo "WARN: postgres:18 pull failed"
  docker pull redis:7 >/dev/null 2>&1 || echo "WARN: redis:7 pull failed"
  docker pull axllent/mailpit:latest >/dev/null 2>&1 || echo "WARN: mailpit pull failed"
fi

# Playwright browsers (only once the repo has Playwright installed, after M0.5)
if [ -f package.json ] && grep -q '"@playwright/test"' package.json 2>/dev/null; then
  # Best effort: every session runs `pnpm install` itself, so a failed warm-up install (for
  # example a package whose postinstall needs a host the network policy blocks) must not
  # abort the whole setup.
  pnpm install --frozen-lockfile || echo "WARN: pnpm install failed during setup; sessions install on start"
  pnpm exec playwright install --with-deps chromium || true
fi

echo "Yayatoh cloud environment ready."
