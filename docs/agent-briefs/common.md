You are one of several parallel Claude sessions building **Yayatoh 2.0** (repo heywebbuddy/yayatoh). The orchestrating session merges your branch after its own full gate. Nobody is watching you live: work autonomously to completion; never wait for input. Never end your turn while work is unfinished: keep going until your final push is done. If the spec is genuinely ambiguous on an owner decision, choose the roadmap's recommended default, write it into your spec section and docs/owner-inbox.md as "pending owner", and continue.

## Branch and git
- You start on a checkout of `m0.5-foundation-ey5gqp`. Create/use your branch **`{BRANCH}`** and push ONLY to it (`git push -u origin {BRANCH}`). Never push to any other branch, never open or edit pull requests, never force-push other branches.
- Commit in logical steps with descriptive messages, using the commit attribution your session's system prompt gives. **Your final commit message must contain your full report** (see "Report").

## Environment setup (do this first)
1. `node --version` must be v24 and `pnpm --version` 12.x; otherwise run `bash .claude/cloud-setup.sh`.
2. Docker: if `docker ps` fails, start the daemon: `(dockerd > /tmp/dockerd.log 2>&1 &)` and wait until `docker ps` works. Then `docker compose up -d postgres gotenberg` (add `mailpit` if you need to read emails in tests and the repo's e2e expects it; check how existing e2e read emails first).
3. Create `/tmp/devenv.sh` (never commit it) and source it in every shell command that runs pnpm/node:
```
export ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/yayatoh
export DATABASE_URL=postgres://app_user:devapp@localhost:5432/yayatoh
export MIGRATOR_DATABASE_URL=postgres://migrator:devmig@localhost:5432/yayatoh
export PLATFORM_READER_DATABASE_URL=postgres://platform_reader:devpr@localhost:5432/yayatoh
export JOBS_DATABASE_URL=$MIGRATOR_DATABASE_URL
export YAYATOH_DEV_AUTH=1
export BETTER_AUTH_SECRET=<openssl rand -hex 32>
export BETTER_AUTH_URL=http://localhost:3100
export DEV_PERSONA_PASSWORD=persona-dev-password
export APP_TOKEN_SECRET=<openssl rand -hex 32>
export FAKE_PAYMENTS_SECRET=<openssl rand -hex 32>
export LOCAL_KMS_KEY=<openssl rand -hex 32>
export GOTENBERG_URL=http://localhost:3300
export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
unset PAYMENTS_PROVIDER
```
   (Generate the random values once and write them literally into the file.) The environment may contain real Stripe test keys: never set `PAYMENTS_PROVIDER=stripe`, never call Stripe; all tests use the fake provider.
4. `pnpm install --frozen-lockfile && pnpm db:bootstrap && pnpm db:migrate && pnpm seed && pnpm --filter @yayatoh/worker staff -- --email omar@yayatoh.test --role admin`. Read `docs/local-development.md` if anything fails.
5. Never run `playwright install` (Chromium is preinstalled at /opt/pw-browsers/chromium).

## Rules
Read `CLAUDE.md` first — its non-negotiable rules apply (tenancy/RLS with FORCE and the NULLIF policy, `withTenant` only, allowlist serializers, the 10-step command pipeline via `tenantCommand`, module tiers and public exports only, tokens-only UI with no raw colours, next-intl in all 13 locales with Arabic RTL, logical CSS, 24px targets, an accessible alternative for any canvas/drag, integer money, timestamptz, no secrets, `/v1` additive only, `/api/v2` frozen). Then read `docs/roadmap.md` for your milestone, `docs/decisions.md`, relevant ADRs in `docs/adr/`, and existing `docs/specs/*/spec.md` for the house style.
- Services that need owner accounts go behind ports with fake adapters; log each in `docs/owner-inbox.md`.
- Legacy code is reference only; never copy Eventmie code.
- Schema: `tenantTable()` in the module's `src/schema.ts` → `pnpm db:generate` (never drizzle-kit push). CHECKs/FKs on EXISTING tables: `NOT VALID` then `VALIDATE CONSTRAINT` (edit the generated SQL). Hand-written SQL (SECURITY DEFINER functions, cross-module composite FKs, grants, triggers) goes in the generated migration; wrap it between `-- hand-written: begin` / `-- hand-written: end` comments and list every hand edit in your report — the orchestrator will renumber your migration when merging. Every new tenant table needs rows for both orgs in `createOrgFixture` (packages/testing/src/fixtures.ts) or the isolation suite fails.
- Messages: English in `apps/web/messages/en.json`, then translate the same keys into all 12 other locales yourself with valid ICU plurals per locale (Arabic zero/one/two/few/many/other; Russian one/few/many/other; ja/zh other). `apps/web/tests/messages.test.ts` enforces parity. Edit JSON with a script (ensure_ascii=False, indent=2, trailing newline).
- `pnpm test:int` recreates `yayatoh_test` with random role passwords → run `pnpm db:bootstrap` afterwards before e2e.
- Build apps for e2e with `pnpm --filter @yayatoh/web build` (and `--filter @yayatoh/admin build` if touched), NOT `pnpm build` (turbo drops dev env vars and the dev routes 404). Rebuild after every change before e2e (e2e runs `next start` on the built output).
- Never weaken, skip or delete tests or gates to get green.
- **Strict CSP (M1.14a):** pages are served with a nonce CSP that includes `style-src-attr 'none'`. Never use a `style={…}` prop or inline `<style>` in server-rendered markup: use Tailwind/tokens, `useCssomStyle` (`apps/web/src/lib/cssom-style.ts`) or `BrandSection`/`BrandLink` (`apps/web/src/components/brand-styled.tsx`) for dynamic colours, or set `el.style.*` in an effect. `apps/web/e2e/security.spec.ts` checks the headers. Public forms that can be abused use the M1.14 rate limiter (`limitAction` in `apps/web/src/server/rate-limit.ts`, policies in `@yayatoh/platform/security`); the device cookie is `yy_did`.
- Migrations are numbered up to `0075_*`; yours will be renumbered at merge, so don't worry about collisions.

## Tests first — end-to-end browser tests for EVERY feature and detail (the owner insists)
For each user-visible feature write Playwright tests (`apps/web/e2e/*.spec.ts`, projects 375/768/1280 run in parallel — make tests independent across projects and tolerant of a rerun on a used DB: unique names via `Date.now()`, per-project data via `test.info().project.name`): the happy path through the real UI; every validation error and its message; empty states; permission denials (hidden control AND refused direct URL/action for a lower role, e.g. viewer `jordan@lakeside.test`); success messages; persistence after reload; keyboard-only operation of everything interactive; `expectAccessible(page)` (axe) on every new screen and state; the Arabic RTL render (`/ar/...`) of new screens; the public/guest side where applicable. Plus unit tests for pure logic and integration tests (`packages/testing/tests/*.int.test.ts`) for commands/queries: permissions, tenant isolation, invariants, edge cases. Use `apps/web/e2e/helpers.ts` (signIn personas, expectAccessible) and follow existing specs' style.

## Gate before your final push (all must pass)
1. `pnpm verify` (lint → check:modules → typecheck → unit → integration)
2. `pnpm db:bootstrap`, rebuild web (+admin if touched), then run on all three projects: your new e2e specs, plus every existing spec that covers a page, route or module you changed (find them with grep). Run the WHOLE web suite (`cd apps/web && npx playwright test --reporter=line`) only if you changed shared infrastructure: the root/org layouts, navigation, auth/session, `proxy.ts`, the CSP, `helpers.ts`, seed data or fixtures used by other specs. The merge session and CI always run the whole suite, so that is where cross-feature breakage is caught. Run the admin suite if you touched admin. Fix real failures. If a failure is clearly pre-existing and unrelated, record the exact error in your report. (Owner asked for speed on 2026-09-29.)
3. Add your milestone section to `docs/specs/<milestone>/spec.md` (what was built, "Later"/"Not yet", Acceptance table mapping each criterion to its test file).

## Push early
Commit and push to `{BRANCH}` after every logical step (normal push), so a platform disconnect loses nothing.

## Report
Put the report in your final commit message body: what you built; files/modules touched; migration file name and every hand edit; message keys added; test counts (unit/int/e2e) and gate results; choices pending the owner; anything left open. Then push to `{BRANCH}` and stop.
