# Runbooks v1 (M1.14d)

Step-by-step procedures for the people on call (roadmap §8.2: on-call is human; the owner is
primary with a contracted backup). Claude Code prepares and reviews runbooks and scripts; it never
runs production actions (CLAUDE.md → Safety). Every production step is run by the owner, or
approved by the owner step by step.

| Runbook | When |
|---|---|
| [deploy.md](deploy.md) | Every production deploy |
| [rollback.md](rollback.md) | A deploy made things worse |
| [restore-drill.md](restore-drill.md) | Monthly drill; a real database restore |
| [incident.md](incident.md) | Anything user-visible is broken or data may be exposed |
| [key-rotation.md](key-rotation.md) | Scheduled rotation, a leaked secret, a departing person |
| [webhook-replay.md](webhook-replay.md) | Payments or other provider events were missed or failed |
| [restore-terminated-org.md](restore-terminated-org.md) | An org was terminated by mistake and the platform owner approved restoring it |
| [front-door.md](front-door.md) | Coexistence: turning the front door on, moving routes between legacy and the new app, rolling back (M2.4) |

**Conventions**
- Commands are copy-paste ready and marked **(local/staging)** or **(production, owner)**.
- Anything that writes to production goes through a reviewed script in `tools/ops/` with a dry run.
- Times are UTC in logs and tickets; event times are discussed in the event's timezone.
- After any SEV1/SEV2, a post-incident review within 72 h (template in incident.md) and a PR that
  updates the runbook that was used.

**Still owner-only (docs/owner-inbox.md):** hosting accounts (Vercel, Neon, Fly, Upstash,
Cloudflare), the status page, paging (on-call rota tool), the off-account backup bucket and the
offline backup key.
