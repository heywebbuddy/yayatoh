# ADR 0024 — Hosting: one self-hosted server (Contabo) with Docker Compose; supersedes ADR 0004

- **Status:** Accepted (owner decision, 2026-10-05). Supersedes [ADR 0004](0004-hosting.md) for runtime hosting; its build environment (Claude Code cloud sessions) and its AWS SES/KMS, Doppler and Cloudflare R2 choices stay.
- **Relates to:** roadmap §3.6 (budget), §9 (operations); ADR 0009 (realtime: SSE first), ADR 0017 (Gotenberg), ADR 0020 (front door).

## Context
- ADR 0004 spread production over Vercel (web, admin), Fly.io (worker, Gotenberg), Neon (Postgres) and Upstash (Redis). The owner found five providers too much to run and wanted the database next to the app.
- Nothing in the code needs those providers: Redis is optional (rate limits fall back to Postgres), the worker is a plain Node process, and Postgres 18 + pgvector runs anywhere. The Vercel-specific parts were small: the `VERCEL_ENV` production check, the Domains API (never built), and the edge's client address and country headers.
- The owner bought a Contabo Cloud VPS (Ubuntu 24.04, US East) on 2026-10-05.

## Decision
- **One server, Docker Compose** (`deploy/docker-compose.prod.yml`): Caddy, web, admin, worker, Gotenberg and Postgres 18 (pgvector + pgBackRest). Only Caddy publishes ports (80, 443). `apps/api` is not deployed: the web serves `/api/v1`.
- **One image** (`Dockerfile`) for web, admin, worker and the migrate/bootstrap tasks, built by `.github/workflows/image.yml` from `main` and pushed to `ghcr.io/heywebbuddy/yayatoh:<commit>`. Pull requests that touch the image build it without pushing. No secret is in the image.
- **Production switch:** `YAYATOH_ENV=production` (`isProductionEnv()` in `@yayatoh/kernel`; `VERCEL_ENV=production` still counts). The compose file fixes it, so a missing Doppler value cannot turn production into a development build.
- **Secrets:** Doppler (`yayatoh` / `prd`). On each deploy the server writes them to tmpfs (`/run/yayatoh`, root only) with a read-only service token. The database superuser and backup keys go to Postgres only. The deploy refuses development-only names (`FAKE_*`, `LOCAL_KMS_KEY`, `YAYATOH_DEV_AUTH`, `DEV_PERSONA_PASSWORD`).
- **Key vault:** AWS KMS envelope encryption (`kmsKeyVault`, `keyVaultFromEnv`): one data key per ciphertext under the encryption context `{ scope }`, AES-256-GCM locally, data keys cached for 5 minutes. Production refuses to start without `AWS_KMS_KEY_ID`.
- **TLS and domains:** Caddy gets certificates from Let's Encrypt: the app and admin hosts up front, tenant hosts (`{slug}.yayatoh.events`, custom domains) on demand after `GET /api/internal/tls-ask` confirms the host resolves to an org. Custom domains are verified by DNS (`DOMAIN_PROVIDER=self_hosted`): a TXT ownership record plus a CNAME to `DOMAIN_CNAME_TARGET` (or A records to the server).
- **Client address and country:** Caddy drops client-sent `X-Real-IP` and `X-Vercel-IP-Country` and sets `X-Real-IP` itself. There is no country source yet, so country-based risk rules and the pricing page's currency guess see no country (the code already handles that). A GeoIP source (Caddy MaxMind module) can later set the same header.
- **Backups:** pgBackRest to an S3-compatible bucket (R2, a separate bucket and token), encrypted (AES-256), WAL archived continuously (RPO about 1 minute), full weekly, differential daily, `check` daily (systemd timers). Postgres refuses to start without backup settings unless `BACKUP_DISABLED=1` is set on purpose.
- **Deploys:** the owner runs `deploy/scripts/deploy.sh <commit>` on the server: pull the image, migrate (expand-only), start the new apps, wait for `/api/health`. Rollback is deploying the previous commit. `docs/runbooks/deploy-contabo.md`.
- **Realtime:** SSE from the web process over a direct Postgres connection (`LISTEN` works without a pooler). Ably stays optional.

## Alternatives
- **Railway Pro:** one dashboard and no server upkeep, but usage-based cost and a per-service custom-domain limit (raisable). Kept as the fallback if running a server becomes a burden.
- **ADR 0004 as written** (Vercel + Fly + Neon + Upstash): previews per PR and managed failover, at the highest cost and five providers.
- **Managed Postgres with a self-hosted app:** safer database operations, but the owner wanted the database local.

## Consequences
- One server is a single point of failure: an outage lasts until it is back, and restore from backup is the recovery path (monthly restore drill, `docs/runbooks/restore-drill.md`). A standby server can be added later without changing the code.
- Server upkeep is ours: unattended security updates, firewall, SSH keys only (`deploy/scripts/server-setup.sh`), disk and memory watching, an external uptime check on `/api/health`.
- No preview deployment per PR. Previews run locally (`pnpm dev`) or on a staging config of the same compose file later.
- The build gate is unchanged: CI on every PR; the image builds only from green `main`.
- Cost is the VPS plus backup storage, well under ADR 0004's estimate.

## Revisit when
- Traffic or uptime needs outgrow one server (add a standby or move the database to managed Postgres).
- Server operations take more owner time than the savings are worth (Railway, or ADR 0004).
