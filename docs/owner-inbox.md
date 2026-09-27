# Owner inbox

These are tasks only the owner (or their developer, accountant or lawyer) can do. Claude Code keeps this list current. Each task names the milestone that is blocked until it's done.

## Now
- [ ] **M0.0 security fixes.** Hand `docs/legacy/M0.0-security-hotfix.md` to your Laravel developer.
  - P0 items within 24–48 h: forged social login, forged payment webhooks, account takeover, leaked order numbers and private info, secret rotation, killing magic-login tokens.
- [ ] **Rotate the secrets committed in the legacy repo:** `APP_KEY`, Pusher key/secret/app ID, the staging DB credentials, and the Flutterwave sandbox keys.
- [ ] **Review damage after the fixes.** Check for forged-payment bookings, unexpected email or role changes, and scraping in the access logs.
- [ ] **Tell ABC** to change the venue Wi-Fi password and parking codes exposed through `private_info`.
- [x] **Install the Claude GitHub App** on `Pani-Digital-Services-LLC`, for the `yayatoh` and `yayatoh-legacy` repos only. See `docs/cloud-environment.md` §1.
- [x] **Create the `yayatoh` cloud environment** at claude.ai/code. See `docs/cloud-environment.md` §2.

## Design
- [ ] (Optional) License NB International Pro + NB International Mono Pro (Neubau) for the exact Superpower typeface. Until then the app uses Geist / Geist Mono (ADR 0018).
- [ ] **Reports: confirm two defaults** (M1.12, label: `payments`):
  - Net revenue is shown to owners, admins and finance members only (`finance:read`); managers and viewers see gross sales and counts. Bookings CSV export needs `attendees:export` (buyer contact data). Change either if you want other roles to see them.
  - "Complimentary" means a paid order with a zero total (free passes, 100 % codes). Legacy bulk comp codes arrive with the ELT; tell us if the legacy report counted anything else as complimentary.
- [ ] **Staff list and console** (M1.3e, decision D10): send the list of people who should be platform staff and their role (admin, support or finance). They are added with the worker CLI (`pnpm --filter @yayatoh/worker staff -- --email … --role …`). Also confirm the staff console (`admin.yayatoh.com`) may stay English-only; its strings are ready for translation if not. Hosting it needs a second Vercel project. Label: `auth`.
- [ ] **Name a translation owner** (M1.1). The 12 non-English locales are machine-drafted by Claude Code and need a native-speaker review, Arabic first. Tolgee is the planned workflow once accounts exist.
- [ ] **Review the M1.1 screens** in the CI `e2e-report` artifact (screenshots at 375/768/1280 in English and Arabic) or on the preview once Vercel exists.

## Security, privacy and ops readiness (M1.14)
- [ ] **Confirm the rate limits** (pending owner; `packages/platform/src/security/rate-limit.ts`): sign-in 10 per device / 20 per email / 300 per IP per 10–15 min; emailed codes 5 per device and per email; checkout starts 20 per device, 600 per IP per 10 min; holder links 10 per device; forged webhooks 30 per IP. Shared IPs (venues) only meet the generous per-IP ceilings.
- [ ] **Upstash Redis** for the rate limiter (label: `infra`): create a database, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Doppler/Vercel. Until then counters live in Postgres (`platform.rate_limits`).
- [ ] **WAF and BotID** (label: `infra`): Vercel Firewall managed rules on the production project, rate rules for `/api/auth/*` and `/api/webhooks/*`, and Vercel BotID (or Cloudflare Turnstile keys, already listed under M1.2f) on sign-in and checkout. Queue-it or a waiting room for on-sales above a few thousand buyers (load test: docs/ops/security-testing.md).
- [ ] **Backups** (label: `infra`, `db-migration`): Neon PITR retention ≥ 7 days on production; a **separate** backup account with a bucket that has Object Lock; generate the offline `age` key pair (keep the private key offline) and give Claude Code the public key; schedule `tools/ops/offsite-dump.sh` nightly. Then run a restore drill on staging with a masked production-size snapshot and record it in docs/runbooks/restore-drill.md (acceptance: RTO ≤ 1 h).
- [ ] **Status page, paging and the on-call rota**: pick a status page and paging tool (e.g. Better Stack), name the contracted backup, fill in the rota in docs/runbooks/incident.md, and connect the SLO alerts in docs/ops/slos.md once Axiom/Sentry exist.
- [ ] **Retention defaults** (pending owner; `packages/modules/privacy/src/retention.ts`): attendee PII 24 months after the event and check-in logs 12 months (roadmap), plus proposals: abandoned checkouts lose buyer details after 30 days, holder links deleted 30 days after expiry, unclaimed claim links lose the address after 90 days. Paid orders keep buyer details for the 7-year payment record.
- [ ] **Access-log archive**: the platform access log is purged after 12 months only once an off-account WORM archive exists; then set `ACCESS_LOG_ARCHIVED=1` on the worker.
- [ ] **Privacy notice, sub-processor list and DPA** (label: `legal-copy`): counsel reviews the drafts at `/privacy` and `/sub-processors` (texts in `apps/web/messages/*.json` → `privacyNotice`, `subprocessors`; list in `apps/web/src/content/sub-processors.ts`) and the DPA draft; provide the privacy contact address; confirm the 30-day notice for sub-processor changes. Translations are machine drafts.
- [ ] **Staging security runs** before M2.1: `bash zap/run-baseline.sh https://<staging>` and k6 at 3× expected peak (`k6/`); decide on an external pen test.
- [ ] **HSTS preload**: HSTS (2 years, includeSubDomains) is sent on https; decide whether to submit the apex to the preload list (hard to undo).
- [ ] **Accessibility**: NVDA and VoiceOver passes and the VPAT 2.5 (roadmap §10).

## Phase 0 (M0.1–M0.4)
- [ ] **Accounts** (M0.1):
  - Vercel Pro, Neon, Fly.io, Upstash, Cloudflare (R2), AWS (SES, KMS), Doppler, Sentry, Axiom, Ably.
  - Until R2 exists, attendee exports (M1.8b) and bookings exports (M1.12c, up to 50 000 rows) are stored in Postgres (`platform.files`) and expire after 7 days. Moving them to R2 needs the Cloudflare account, an R2 bucket per environment and an API token (label: `infra`).
  - Twilio (SMS, and WhatsApp through Twilio) for M1.10. Until then, ticket links (M1.8d) go by email (console mailer until SES) or by copying the link.
  - Stripe test mode access for the platform account. **Keys added to the cloud environment (2026-09-27); the adapter is built (M1.5e).** Still needed:
    - Network access: allow `api.stripe.com`, `connect.stripe.com` and `files.stripe.com` in the environment (currently denied), then start a new session and run `PAYMENTS_PROVIDER=stripe pnpm --filter @yayatoh/payments stripe:smoke`.
    - Connect enabled on the platform account (Standard-equivalent accounts: full dashboard, the organizer pays fees and carries losses).
    - Two webhook endpoints on the preview/staging URL, both posting to `/api/webhooks/stripe`: a **platform** endpoint and a **Connect** endpoint ("events on connected accounts"), each with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated` (Connect). Their signing secrets go in `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (Doppler/Vercel for deployments). Then set `PAYMENTS_PROVIDER=stripe` on that deployment. Label: `payments`.
- [ ] **Confirm today's platform fee** (M1.5): the legacy commission % and any fixed per-ticket fee, per currency, and whether organizers absorb or pass it on by default. The new platform launches at 0% until this is set (`billing.fee_schedules`).
- [ ] **Ticket signing key encryption** (M1.5c, before launch): an AWS KMS key (or approve another KMS) for encrypting each org's ticket-signing private key. Development and CI use a local AES key (`LOCAL_KMS_KEY`) behind the `KeyVault` port; the local adapter is refused in production.
- [ ] **Sign-in providers** (M1.2f): Google OAuth client and Apple Sign in with Apple service ID + key for `app.yayatoh.com`; Cloudflare Turnstile site key.
- [ ] **Tenant domain** (M0.1): buy the tenant apex (e.g. `yayatoh.events`, availability unverified) and submit it to the Public Suffix List.
  Custom domains (M1.3d) run on a fake hosting provider until then: the Vercel adapter needs a Vercel API token scoped to the web project, the project id, and wildcard DNS for the tenant apex (`*.{apex}` → Vercel). Set `TENANT_APEX` once the name is bought. Label: `infra`.
- [ ] **Platform Terms of Service and DPA texts** (M1.3a): the click-wrap records acceptances of versioned *draft* texts (`apps/web/src/content/platform-legal.ts`). Counsel provides the final wording (and translations if wanted); bumping the version in `PLATFORM_AGREEMENTS` asks every org to accept again. Label: `legal-copy`.
- [ ] **Ledger role in production** (M1.6a): the production role runbook must create the NOLOGIN role `ledger_writer` and grant it to `migrator` (as `pnpm db:bootstrap` does locally), before the M1.6 migrations run. Label: `db-migration`, `payments`.
- [ ] **Counsel and Stripe questions** (M0.1):
  - Hybrid payments model.
  - Sales and admissions tax for platform-charged orders.
  - 1099.
  - FTC all-in pricing.
  - Organizer agreement.
  - Stripe's holding limit for funds on unconnected organizers.
- [ ] **Legacy data access** (M0.2–M0.4):
  - Nightly database dumps for yayatoh.com and abc.yayatoh.com, masked before use.
  - 90 days of access logs.
  - Read-only SSH.
  - The Stripe restricted read key.
  - Search Console access.
  - The stock Eventmie Pro 3.0.0 package, from your Classiebit/CodeCanyon license.
- [ ] **Mobile app source** (M0.3): the React Native repo, for the contract and pinning audit only; no app build.
- [ ] **ABC dates** (M0.2): ABC 2026 wrap-up date, plus ABC 2027 dates and on-sale plans.
- [ ] **Store listing fixes** (M1.15, metadata only):
  - Move the iOS privacy URL off `staging.yayatoh.com`.
  - Correct the privacy labels.
  - Resolve the ABC "In-App Purchases" flag.
