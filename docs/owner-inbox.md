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
- [ ] **Name a translation owner** (M1.1). The 12 non-English locales are machine-drafted by Claude Code and need a native-speaker review, Arabic first. Tolgee is the planned workflow once accounts exist.
- [ ] **Review the M1.1 screens** in the CI `e2e-report` artifact (screenshots at 375/768/1280 in English and Arabic) or on the preview once Vercel exists.

## Phase 0 (M0.1–M0.4)
- [ ] **Accounts** (M0.1):
  - Vercel Pro, Neon, Fly.io, Upstash, Cloudflare (R2), AWS (SES, KMS), Doppler, Sentry, Axiom, Ably.
  - Until R2 exists, attendee exports (M1.8b) are stored in Postgres and expire after 7 days.
  - Twilio (SMS, and WhatsApp through Twilio) for M1.10. Until then, ticket links (M1.8d) go by email (console mailer until SES) or by copying the link.
  - Stripe test mode access for the platform account.
- [ ] **Confirm today's platform fee** (M1.5): the legacy commission % and any fixed per-ticket fee, per currency, and whether organizers absorb or pass it on by default. The new platform launches at 0% until this is set (`billing.fee_schedules`).
- [ ] **Ticket signing key encryption** (M1.5c, before launch): an AWS KMS key (or approve another KMS) for encrypting each org's ticket-signing private key. Development and CI use a local AES key (`LOCAL_KMS_KEY`) behind the `KeyVault` port; the local adapter is refused in production.
- [ ] **Sign-in providers** (M1.2f): Google OAuth client and Apple Sign in with Apple service ID + key for `app.yayatoh.com`; Cloudflare Turnstile site key.
- [ ] **Tenant domain** (M0.1): buy the tenant apex (e.g. `yayatoh.events`, availability unverified) and submit it to the Public Suffix List.
- [ ] **Platform Terms of Service and DPA texts** (M1.3a): the click-wrap records acceptances of versioned *draft* texts (`apps/web/src/content/platform-legal.ts`). Counsel provides the final wording (and translations if wanted); bumping the version in `PLATFORM_AGREEMENTS` asks every org to accept again. Label: `legal-copy`.
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
