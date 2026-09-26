# Running Claude Code in the cloud for this repo

Cloud sessions (Claude Code on the web, [claude.ai/code](https://claude.ai/code)) build this project. Each milestone lane runs as its own session on its own branch and opens a pull request. See roadmap §9.

## One-time setup (owner)

### 1. Install the Claude GitHub App
1. Open https://github.com/apps/claude and click **Install** (or **Configure**).
2. Choose the **Pani-Digital-Services-LLC** organization.
3. Grant access to **only selected repositories**: `yayatoh` and `yayatoh-legacy`.

This lets cloud sessions clone and push to these private repos, and lets Auto-fix respond to CI failures on PRs.

### 2. Create the cloud environment
At claude.ai/code, open **Environments** → **New environment**, name it `yayatoh`, and fill in the fields below.

**Setup script.** Paste the contents of [`.claude/cloud-setup.sh`](../.claude/cloud-setup.sh). It installs Node 24 and pnpm, and pre-pulls Postgres 18, Redis and Mailpit for tests.

**Network access.** Choose **Custom**, keep the trusted defaults, and add:

```
api.neon.tech
*.neon.tech
api.vercel.com
*.vercel.app
api.stripe.com
files.stripe.com
*.upstash.io
rest.ably.io
realtime.ably.io
api.svix.com
*.sentry.io
api.axiom.co
nodejs.org
```

**Environment variables.** Use test and development values only; production keys never go here. Add them when each milestone needs them.

| Variable | Needed from | Value |
|---|---|---|
| `STRIPE_SECRET_KEY` | M1.5 | `sk_test_…` (test mode only) |
| `STRIPE_WEBHOOK_SECRET` | M1.5 | Test webhook secret |
| `NEON_API_KEY` | M0.5 | Creates a Neon branch per PR |
| `DATABASE_URL` | M0.5 | Leave unset; sessions use the local Docker Postgres by default |

On Pro/Max plans, store secret values as **API credentials**, not plain variables.

### 3. Local-only work (never in cloud sessions)
- Masking production database dumps, and migration rehearsals on real data.
- Testing the current store apps on real phones.
- Anything that needs interactive login, SSH or production credentials.

## How sessions are used
- **Start a lane:** from claude.ai/code, pick the `yayatoh` environment and repo, then give the milestone ID, e.g. "Implement M0.5 per docs/roadmap.md".
- **Run in parallel:** one session per lane, each on its own branch, with at most 3 lanes at once (roadmap §9).
- **Stop rules:** sessions stop when idle, so they commit and push often. Load tests and nightly suites run in GitHub Actions, not in sessions.
- **Config:** only repo files reach the cloud — `CLAUDE.md`, `.claude/settings.json`, `.claude/` skills, agents and commands, and `.mcp.json`. User-level `~/.claude` settings do not.

## Known limits
- **Size:** each session VM has 4 vCPU, 16 GB RAM and 30 GB disk.
- **Command timeouts:** 2 minutes by default, 10 minutes maximum. Raise them with `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` in the environment if test suites need it.
- **Repo host:** GitHub only. The legacy GitLab repo is mirrored to `Pani-Digital-Services-LLC/yayatoh-legacy`, with secrets redacted.
