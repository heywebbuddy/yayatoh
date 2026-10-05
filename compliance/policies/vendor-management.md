# Vendor management policy

**Status: draft, pending owner.** SOC 2: CC9.2, CC6.4.

## Rules
1. Every vendor that stores or processes customer data is listed below with its purpose, data
   and assurance, and is added only with the owner's approval.
2. Before onboarding, the owner collects the vendor's SOC 2 Type II (or ISO 27001) report and
   signs a DPA; yearly afterwards.
3. Sub-processor changes are announced to organizers 30 days ahead (roadmap §10).
4. Services that need owner accounts sit behind ports with fake adapters in development and CI,
   so no build session holds vendor credentials.
5. Vendors are reviewed yearly: still needed, assurance current, access minimal.

## Inventory (from ADR 0004 and roadmap §3.6; owner to confirm)
| Vendor | Purpose | Customer data | Assurance to collect |
|---|---|---|---|
| Vercel | Web, API and staff console hosting | In transit | SOC 2 Type II |
| Neon | Postgres | Yes | SOC 2 Type II |
| Fly.io | Worker, Gotenberg | In transit | SOC 2 Type II |
| AWS | SES email, KMS, S3 Object Lock (audit WORM) | Yes | SOC 2 Type II |
| Cloudflare | R2, Images, DNS | Yes (media) | SOC 2 Type II |
| Upstash | Redis (rate limits, cache) | Minimal | SOC 2 Type II |
| Ably | Realtime (later) | Event channels | SOC 2 Type II |
| Stripe | Payments | Payment data (SAQ A) | PCI DSS AoC, SOC 2 |
| Doppler | Secrets | Secrets | SOC 2 Type II |
| Sentry, Axiom | Errors, logs | Scrubbed telemetry | SOC 2 Type II |
| Twilio | SMS | Phone numbers | SOC 2 Type II |
| Vanta | Compliance automation | Evidence bundles (no customer data) | SOC 2 Type II |
| GitHub | Source, CI | None | SOC 2 Type II |

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
