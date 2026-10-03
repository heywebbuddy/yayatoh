# Local development

1. **Tooling:** Node 24 and pnpm 12 (`corepack enable`). In cloud sessions run `.claude/cloud-setup.sh`.
2. **Services:** `docker compose up -d` starts Postgres 18, Redis 7, Mailpit (UI on http://localhost:8025) and Gotenberg for ticket PDFs (set `GOTENBERG_URL=http://localhost:3300`).
3. **Install:** `pnpm install`.
4. **Environment:** copy `.env.example` to `.env` (git-ignored) and fill in local values:
   - `ADMIN_DATABASE_URL` — the compose superuser on the `yayatoh` database, e.g. `postgres://postgres:<LOCAL_POSTGRES_PASSWORD>@localhost:5432/yayatoh`.
   - `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `PLATFORM_READER_DATABASE_URL` — the same host and database with users `app_user`, `migrator` and `platform_reader` and passwords you choose. `pnpm db:bootstrap` creates the roles with those passwords.
   - `JOBS_DATABASE_URL` — locally, the migrator URL.
   - `BETTER_AUTH_SECRET`, `APP_TOKEN_SECRET` (each at least 32 characters, e.g. `openssl rand -hex 32`), `BETTER_AUTH_URL=http://localhost:3000`.
   - For the dev persona sign-in (`/dev/login`): `YAYATOH_DEV_AUTH=1` and `DEV_PERSONA_PASSWORD`.
5. **Database:** `pnpm db:bootstrap && pnpm db:migrate && pnpm seed`.
6. **Run:** load the file into your shell, then start everything: `set -a; . ./.env; set +a; pnpm dev`.
   `pnpm dev` runs turbo with `--env-mode=loose`, so every app sees your shell's variables (turbo's default strict mode passes only declared ones, and the worker and API then stopped with `JOBS_DATABASE_URL is not set`). Builds stay strict. The Next apps also read their own `.env.local`.

   What each process needs to start:

   | Process | Required | Optional (defaults) |
   |---|---|---|
   | web (:3000), admin (:3001) | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_TOKEN_SECRET`; admin also `PLATFORM_READER_DATABASE_URL` | `BETTER_AUTH_URL`, `ADMIN_AUTH_URL` (`http://localhost:3001`), `GOTENBERG_URL`, `LOCAL_KMS_KEY` |
   | worker | `JOBS_DATABASE_URL`, `DATABASE_URL`, `PLATFORM_READER_DATABASE_URL`, `APP_TOKEN_SECRET`, `NEXT_PUBLIC_APP_ORIGIN` (`http://localhost:3000`, for links in emails) | `GOTENBERG_URL` (badge PDFs stay queued without it), `FAKE_PAYMENTS_SECRET`, `LOCAL_KMS_KEY` |
   | API (:4000) | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_TOKEN_SECRET` | `API_PUBLIC_URL` (`http://localhost:4000`), `NEXT_PUBLIC_APP_ORIGIN`, `BETTER_AUTH_URL` |

   Personas on `/dev/login`: the org members sign in to their org; Nia Newcomer has no organization yet (sign-up and onboarding); Omar Ops is Yayatoh staff, whose card opens the admin console sign-in on :3001 (run `pnpm --filter @yayatoh/worker staff -- --email omar@yayatoh.test --role admin` once).
7. **Gate:** `pnpm verify` before every PR.

**Legacy migration (M2.2b):** `pnpm migrate:legacy:demo` generates a synthetic legacy dataset (both instances) and migrates it into your database as `migrator`; the web e2e global setup runs it too, so `LOCAL_KMS_KEY` must be set when you run Playwright. See `docs/runbooks/legacy-migration.md` for real (masked) dumps.

Integration tests don't need step 4: they create a throwaway `yayatoh_test` database with random role passwords from `ADMIN_DATABASE_URL`, which defaults to the compose service. They refuse to run against any host other than `localhost` or `postgres`.

**Never** point any variable at production. Development uses masked snapshots only (CLAUDE.md → Safety).

**Note:** database roles are cluster-wide. `pnpm test:int` resets the role passwords to random values, so run `pnpm db:bootstrap` again before `pnpm dev` afterwards. The alternative is a second Postgres container for tests (`ADMIN_DATABASE_URL` pointing at it).
