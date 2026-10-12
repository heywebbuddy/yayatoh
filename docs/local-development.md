# Local development

## Requirements

- Node.js 24 or later
- pnpm 12.6.0 (`corepack enable` or `npx pnpm@12.6.0`)
- Docker Desktop with Compose
- Doppler CLI, authenticated to the team that owns the `yayatoh` project

## Configure secrets

Store the environment variables for the desired environment in the Doppler project and config. Do not paste an entire `.env` file into one secret value; use Doppler's import flow so each `NAME=value` line becomes its own secret.

Run commands with the selected config injected into the process:

```powershell
doppler run --project yayatoh --config dev -- pnpm dev
```

To run a setup command with the same config, use the same prefix, for example:

```powershell
doppler run --project yayatoh --config dev -- pnpm db:bootstrap
doppler run --project yayatoh --config dev -- pnpm db:migrate
```

Choose the Doppler project and config that match the environment you intend to use. Never copy secret values into this document or commit them to the repository.

To use the email settings from `yayatoh/prd` while retaining the local service and database values in the root `.env.local`, run:

```powershell
doppler run --project yayatoh --config prd -- node tools/run-local-dev.cjs
```

The launcher applies `.env.local` overrides explicitly, retains Doppler's SES settings, and verifies that all database connections point to localhost. Restart this command after changing Doppler settings.

## Start local dependencies

Create a local `.env` from `.env.example` for Docker Compose values such as `LOCAL_POSTGRES_PASSWORD`, then start the local services:

```powershell
docker compose up -d
```

The compose stack provides PostgreSQL with pgvector, Redis, Gotenberg, and Mailpit. Confirm the containers are healthy with `docker compose ps`.

## Install and run

```powershell
pnpm install
pnpm db:bootstrap
pnpm db:migrate
pnpm dev
```

When using Doppler for the app process, replace the last command with the `doppler run` command above. The monorepo's `dev` script starts the workspace applications through Turbo. Check each app's package scripts and startup output for its local URL and any additional setup it requires.

## Useful commands

```powershell
pnpm test
pnpm typecheck
pnpm lint
docker compose logs -f
docker compose down
```
