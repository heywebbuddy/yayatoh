# Local development

1. **Tooling:** Node 24 and pnpm 12 (`corepack enable`). In cloud sessions run `.claude/cloud-setup.sh`.
2. **Services:** `docker compose up -d` starts Postgres 18, Redis 7 and Mailpit (UI on http://localhost:8025).
3. **Install:** `pnpm install`.
4. **Environment:** copy `.env.example` to `.env` (git-ignored) and fill in local values:
   - `ADMIN_DATABASE_URL` — the compose superuser on the `yayatoh` database, e.g. `postgres://postgres:<LOCAL_POSTGRES_PASSWORD>@localhost:5432/yayatoh`.
   - `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `PLATFORM_READER_DATABASE_URL` — the same host and database with users `app_user`, `migrator` and `platform_reader` and passwords you choose. `pnpm db:bootstrap` creates the roles with those passwords.
   - `JOBS_DATABASE_URL` — locally, the migrator URL.
5. **Database:** `pnpm db:bootstrap && pnpm db:migrate && pnpm seed`.
6. **Run:** `pnpm dev`.
7. **Gate:** `pnpm verify` before every PR.

Integration tests don't need step 4: they create a throwaway `yayatoh_test` database with random role passwords from `ADMIN_DATABASE_URL`, which defaults to the compose service. They refuse to run against any host other than `localhost` or `postgres`.

**Never** point any variable at production. Development uses masked snapshots only (CLAUDE.md → Safety).

**Note:** database roles are cluster-wide. `pnpm test:int` resets the role passwords to random values, so run `pnpm db:bootstrap` again before `pnpm dev` afterwards. The alternative is a second Postgres container for tests (`ADMIN_DATABASE_URL` pointing at it).
