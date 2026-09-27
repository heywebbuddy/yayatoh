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
- [ ] **`/v1` API choices, pending owner** (M1.13, labels: `auth`, `tenancy`, `mobile-contract`). Built with these defaults; say if any should change:
  - **D21 (public API exposure):** the roadmap default "private until M6.3" is applied as: no public developer portal, partner OAuth or outbound webhooks until M6.3; owners and admins can create org API keys in the console now (Settings → API keys), and the reference is at `/v1/docs`.
  - **Org selection** is a path segment, `/v1/orgs/{org}/…`, checked against the key's org or the user's membership, instead of the `Yayatoh-Org` header in roadmap §6.1 (the tenancy rules forbid taking the tenant from a header).
  - **API keys** are org-owned tenant rows (hashed, scoped, revocable) rather than the Better Auth api-key plugin's user-bound keys. A key keeps working if its creator leaves; revoke it then.
  - **Mobile sessions** are Better Auth's 14-day sliding sessions used as bearer tokens. The 15-minute JWT with rotating refresh families (§6.1) is planned before a mobile build ships.
  - **Step-up** (re-enter password or 2FA) before creating a key is not enforced yet: no step-up flow exists in the web app so far.
  - **TypeScript SDK** uses openapi-typescript + openapi-fetch instead of `@hey-api/openapi-ts` (smaller, no generated runtime). Swift/Kotlin use openapi-generator configs, run locally only.
- [ ] **Rate limits in production** (M1.13): an Upstash Redis database (account under Accounts) for the `/v1` token buckets; until then limits are per server instance (in memory). Label: `infra`.
- [ ] **Golden HARs for the `/api/v2` facade** (M1.13, M1.15): record the Yayatoh and ABC store builds against the legacy API (login → browse → buy → ticket → scan, organizer screens) so the frozen facade can be built and diffed. The facade is not built yet. Label: `mobile-contract`.
- [ ] **Messaging providers** (M1.10, labels: `infra`, `legal-copy`). The notifications core is built behind ports; every channel runs on a fake until these exist (dev/CI write to the dev mailbox at `/dev/mailbox`; production leaves messages queued rather than pretending):
  - **Amazon SES:** production access (out of the sandbox), the `mail.yayatoh.com` domain with Easy DKIM, a custom MAIL FROM and a DMARC record, and a configuration set for bounce/complaint events. Credentials go in Doppler.
  - **Twilio:** toll-free number verification and 10DLC (brand + campaign) — see Phase 0 accounts.
  - **Meta business verification** for WhatsApp (utility templates only in the US, decision D16).
  - **Push:** a Firebase service account (FCM HTTP v1) and an APNs auth key (.p8, key id, team id, bundle ids) for the existing apps; VAPID keys for web push.
  - **Confirm three defaults:** quiet hours 21:00–08:00 in the recipient's timezone also apply to non-urgent email (reminders, announcements, guest emails), not only SMS; the staff "pause messaging" switch holds everything except transactional mail (tickets, refunds, invitations, ticket links, replies the customer asked for); email templates use the platform's escaped-HTML templates instead of React Email (the worker runs TypeScript without a JSX step).
- [ ] **Multi-date events: confirm the defaults (pending owner)** (M1.4b, label: `tenancy`). Claude Code chose these; say if any should change:
  - **Access dates stay separate from dates.** A ticket for a date (occurrence) admits only around that date; access dates (M1.5 multi-day passes) still name the calendar days a pass admits within the event. Both rules apply when both are set. Tickets without a date (guest list, imports, passes sold before an event got dates) admit on every date.
  - **Cancelling a date never refunds automatically.** The console shows how many tickets it sold and links to the orders; its tickets stop admitting and it stops selling.
  - **Recurrence rules are expanded when saved** (daily / weekly on chosen weekdays / monthly on a day, until a date or a count; at most 366 dates per event and 5 years ahead). The rule itself is not stored, so a schedule can't be "extended" later: add another schedule instead. Monthly on the 31st skips shorter months (RFC 5545).
  - **Series pages list upcoming public events only** (unlisted events are left out).
  - **Duplicate and templates copy** the event settings, live ticket types (nothing sold, valid for every date), checkout questions, the floor plan (as a draft, with its price categories and organizer blocks) and the series. They **never** copy orders, tickets, attendees, check-ins, payouts, promo codes, dates or guest seat assignments.
- [ ] **Events content and access: confirm the M1.4c–d defaults** (pending owner; label: `tenancy`). Each is implemented as described and easy to change:
  - **Private info is for ticket holders only.** Holders see it on their order page or holder link, never publicly. Legacy also showed it to "code-joined" attendees who had no ticket (the event-code portal). Say if code holders without a ticket should see it too.
  - **Category list.** 16 platform categories: the six seen on yayatoh.com (Arts & culture, Education & classes, Social gatherings, Business & seminars, Charity, Travel & leisure) plus Community, Family, Food & drink, Health & wellness, Music, Nightlife, Religion & spirituality, Sports & fitness, Technology and Other. Send the final list and how legacy categories map to it.
  - **Access-code "uses" count unlocks,** once per visitor device, not purchases. Someone who already unlocked keeps access after the limit is reached, until the code expires or is deactivated.
  - **Private events stay a 404** at their address; invited guests enter their code at `/events/{slug}/unlock` (shown on the Access page), which looks the same for any address. Say if you would rather show the code form at the event address itself (simpler to share, but it reveals that a private event exists there).
  - **The online join link appears 30 minutes before the start** by default (per event, 0–1440) and until the event ends.
  - **Short links:** 7 characters from an unambiguous alphabet, and one custom link per event. Legacy `short_url` values will be imported as custom links (ELT).
  - **Venues are org-owned for now.** The platform-managed, claimable venue profiles from research/37 come with M1.11 / M6.14.
- [ ] **Spam protection on public forms** (M1.4c–d): the venue quote form uses a honeypot and hourly per-device and per-email limits, and access codes allow 10 failed tries per device per 15 minutes. Both switch to Cloudflare Turnstile plus Upstash rate limits once those accounts exist (see Sign-in providers and Accounts below). Label: `infra`.
- [ ] **Staff list and console** (M1.3e, decision D10): send the list of people who should be platform staff and their role (admin, support or finance). They are added with the worker CLI (`pnpm --filter @yayatoh/worker staff -- --email … --role …`). Also confirm the staff console (`admin.yayatoh.com`) may stay English-only; its strings are ready for translation if not. Hosting it needs a second Vercel project. Label: `auth`.
- [ ] **Marketplace defaults** (M1.11, decision D13, pending owner): built as the roadmap recommends. New orgs are **not** listed until they switch "List my public events on the Yayatoh marketplace" on (Public site page); weddings and private events are never listed; no marketplace fee. Existing yayatoh.com organizers are to be enrolled by the migration (ELT) so their listings stay public. Confirm, or say which orgs should differ.
- [ ] **Search Console and legacy URL list** (M1.11 acceptance): Search Console access for yayatoh.com (the top-URL list and the "200 or 308" check), and the frozen list of legacy root organizer URLs (`/{organisation_url}`) to load into `legacy_redirects`. Lighthouse and the Rich Results Test run against a deployed preview (Vercel project pending). Label: `infra`.
- [ ] **Name a translation owner** (M1.1). The 12 non-English locales are machine-drafted by Claude Code and need a native-speaker review, Arabic first. Tolgee is the planned workflow once accounts exist.
- [ ] **Review the M1.1 screens** in the CI `e2e-report` artifact (screenshots at 375/768/1280 in English and Arabic) or on the preview once Vercel exists.

## Phase 0 (M0.1–M0.4)
- [ ] **Accounts** (M0.1):
  - Vercel Pro, Neon, Fly.io, Upstash, Cloudflare (R2), AWS (SES, KMS), Doppler, Sentry, Axiom, Ably.
  - Until R2 exists, attendee exports (M1.8b) and bookings exports (M1.12c, up to 50 000 rows) are stored in Postgres (`platform.files`) and expire after 7 days. Moving them to R2 needs the Cloudflare account, an R2 bucket per environment and an API token (label: `infra`).
  - Twilio (SMS) for M1.10: **start toll-free verification and the 10DLC brand/campaign now** (weeks of lead time). WhatsApp stays on your own template gateway (`whatsapp.panitechnologies.com`) as legacy does; send its API docs and credentials. Until then all messages go to the dev mailbox (see the M1.10 entry below); ticket links (M1.8d) can also be copied.
  - Stripe test mode access for the platform account. **Keys added to the cloud environment (2026-09-27); the adapter is built (M1.5e).** Still needed:
    - Network access: allow `api.stripe.com`, `connect.stripe.com` and `files.stripe.com` in the environment (currently denied), then start a new session and run `PAYMENTS_PROVIDER=stripe pnpm --filter @yayatoh/payments stripe:smoke`.
    - Connect enabled on the platform account (Standard-equivalent accounts: full dashboard, the organizer pays fees and carries losses).
    - Two webhook endpoints on the preview/staging URL, both posting to `/api/webhooks/stripe`: a **platform** endpoint and a **Connect** endpoint ("events on connected accounts"), each with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated` (Connect). Their signing secrets go in `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (Doppler/Vercel for deployments). Then set `PAYMENTS_PROVIDER=stripe` on that deployment. Label: `payments`.
- [ ] **Confirm today's platform fee** (M1.5): the legacy commission % and any fixed per-ticket fee, per currency, and whether organizers absorb or pass it on by default. The new platform launches at 0% until this is set (`billing.fee_schedules`).
- [ ] **Ticket signing key encryption** (M1.5c, before launch): an AWS KMS key (or approve another KMS) for encrypting each org's ticket-signing private key. Development and CI use a local AES key (`LOCAL_KMS_KEY`) behind the `KeyVault` port; the local adapter is refused in production.
- [ ] **Sign-in providers** (M1.2f): Google OAuth client and Apple Sign in with Apple service ID + key for `app.yayatoh.com`; Cloudflare Turnstile site key.
  - **Turnstile is also the seat finder's challenge** (M1.7e): past 30 lookups a minute from one device, guests are asked to pass it instead of being blocked. Create a Turnstile widget (managed mode) for the web hosts and put its keys in `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` with `HUMAN_CHECK_PROVIDER=turnstile` (Doppler/Vercel). Until then dev, preview and CI use a fake checkbox; production without the keys has no challenge, so an over-limit device waits a minute.
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
- [ ] **Card data in the legacy database (urgent, PCI):** the legacy app saves full card numbers, expiry, CVC and cardholder name for failed checkouts in `failed_bookings.payment_method` (and session payloads can carry them). Storing CVCs is never allowed. Ask your Laravel developer to stop writing it (M0.0), purge the column and old sessions, and check with Stripe/your acquirer whether a PCI incident report is needed. Generated guest passwords are also stored in plain text in `notifications.data` and queued jobs. The abc.yayatoh.com dump you uploaded on 2026-09-27 contains this data: consider deleting it from this environment and wherever else copies were made. Label: `payments`, `legal-copy`.
- [ ] **Mask the legacy dumps yourself** (M2.2a): follow `docs/runbooks/legacy-export.md` for both instances and send only `masked.sql.gz` + `mask-report.json`. Keep `mask.key` and the raw dumps in the encrypted `legacy-ref` store.
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
