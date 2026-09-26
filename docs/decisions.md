# Decision log

Owner decisions override everything else (see CLAUDE.md precedence). Newest first. Open decisions are listed in roadmap §12.

| Date | Decision | Detail | Roadmap |
|---|---|---|---|
| 2026-09-26 | **Build in Claude Code cloud sessions** | GitHub repo `Pani-Digital-Services-LLC/yayatoh`; legacy mirrored to `yayatoh-legacy`; cloud environment per `docs/cloud-environment.md` | §9 |
| 2026-09-26 | **Mobile apps planned, not built in this build** | Current store apps keep working through the `/api/v2` facade with no sunset. Staff features go in the Scan PWA; guest features in mobile-first web plus Wallet passes | §8.3 |
| 2026-09-26 | **Legacy security holes fixed by the owner's current developer** | Claude Code provides the fix list (`docs/legacy/M0.0-security-hotfix.md`) and re-audits the result | M0.0 |
| 2026-09-26 | **Payments keep today's hybrid model** | Connected organizers: direct charge + application fee (organizer is merchant of record). Unconnected: platform charge + separate charges & transfers (transfer at release). Replaces the earlier "Yayatoh MoR for everyone" choice | §5.3 |
| 2026-09-26 | One codebase for both sites | yayatoh.com and abc.yayatoh.com deploy from `abc-web` with separate DBs and settings | §1.4 |
| 2026-09-26 | Keep current per-ticket fee model at launch | Plans and entitlements are modeled from day one; subscriptions switch on later (M6.6) | §4.5, M6.6 |
| 2026-09-26 | Expansion order after parity + migration | Command Center + marketing → weddings & galas → conference/enterprise | §8 |
| 2026-09-26 | Tenant sites on a separate apex | e.g. `{slug}.yayatoh.events`; `abc.yayatoh.com` stays as a custom domain | §4.2 |
| 2026-09-26 | Hosting: recommendation accepted by default | Vercel + Fly.io worker + Neon + Upstash + R2 + AWS SES/KMS (confirm as D1) | §3.6 |
| 2026-09-26 | Builder is Claude Code; owner is product owner | Small verifiable increments; humans own accounts, stores, DNS, legal, go/no-go | §9 |
