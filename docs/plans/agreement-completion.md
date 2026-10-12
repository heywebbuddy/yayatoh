# Completing the Services Agreement (Kartik_Fixes)

Status of the work against the Yayatoh 2.0 Services Agreement (23 Sept 2026), started on 12 Oct 2026 after the agreement audit. All work is on the `Kartik_Fixes` branch; nothing here changes `main` or production until the owner says "go".

## Done in code (on `Kartik_Fixes`)

| Agreement item | What changed |
|---|---|
| Healthy test gate | The 47 test failures the branch had added are fixed: translations for the 12 other languages, database snapshots for migrations 0168–0170, the SDK, the webhook event list, route and readiness checks. Your fixes on the branch were kept; only the checks around them were updated. |
| §8 Check-in: name, phone and email lookup | Door staff can find a ticket holder by name, email or phone and check them in. Works **offline** in the scanner app (phone numbers travel only as salted hashes) and online on the event's On-site page. |
| §6 Dashboard | The tickets tile shows tickets handed on, tickets waiting to be handed on and registrations. The sponsor tile shows packages, deliverables, sponsored sessions and (owners only) sponsorship income. |
| §6/§8 Staff alerts | The scanner's staff alerts now follow the alert engine: same thresholds (capacity near at 95 %), and anything acknowledged or snoozed in the Command Center goes quiet on the devices too. |
| Staff sign-in email (live bug) | Admin-site sign-in codes, magic links and password resets now go through Amazon SES. Account notices (e.g. "account deleted") are emailed instead of only logged. |
| §5 Weddings | The wedding menu's "RSVP" and "Messages" open the real RSVP and invitation screens (no more "This area is being built"). The RSVP-deadline checklist item now ticks when a deadline is set. |
| §5/§9 Floor plans | VIP areas, rectangular (banquet) tables, single seats, object sizes, and a sections panel (name, mark VIP, assign rows and tables). |
| §5 Guest import | Downloadable templates for the guest list and the attendee import; the attendee import accepts Excel (.xlsx) as well as CSV. |
| §10 Event CRM | The engagement score is no longer a placeholder: it includes each event's polls, questions, feedback and enrollments (on the organization's own weights). |
| §3 White-label | Each event can have its own accent colour on its public page. The organization's own website shows its logo in the header. |
| §13 Google Sheets | The connector is rebuilt on the real Google Sheets API (it only worked against a test double before). |

## What only you can do (Phase 4: accounts and keys)

Nothing below can be done in code. Each item is a value you put in Doppler (`yayatoh` project, `prd` config; `staging` first if you have it). The names are in `docs/env-variables.md` §4–5.

1. **Email: Amazon SES.** Already live for sign-in mail. Add `SES_SNS_TOPIC_ARN` if you want bounce and delivery tracking.
2. **SMS: Twilio.** Account, a Messaging Service with US 10DLC registration, then `TWILIO_*` and `SMS_PROVIDER=twilio`.
3. **WhatsApp.** A Meta WhatsApp Business number (Cloud API) → `WHATSAPP_CLOUD_*` and `WHATSAPP_PROVIDER=cloud`; or your own gateway's documents so the gateway adapter can be finished.
4. **Payments: Stripe.** Test mode first (`sk_test_…`, webhook secrets, `PAYMENTS_PROVIDER=stripe` on staging only). Live keys only with your written approval.
5. **Webhooks: Svix.** `SVIX_API_KEY` turns customer webhooks on.
6. **Integrations: Nango.** `NANGO_SECRET_KEY`, then in Nango: Google Sheets, HubSpot, Salesforce and Zoom apps with their OAuth clients (Zoom needs Marketplace approval).
7. **PDFs (tickets, badges, reports): Gotenberg.** Already in the production compose file; check `GOTENBERG_URL` is set.
8. **Badge printing: PrintNode** account (optional; browser printing works without it).
9. **Gallery video upload: Cloudflare Stream** account (optional; YouTube/Vimeo links work without it).
10. **Billing plans.** Set prices in Admin → Plans, then `BILLING_ENABLED` when you want to charge organizers.

## Launch work (Phase 5)

1. **Staging copy** of production on the server (or a second small server), deployed from `Kartik_Fixes`, with the providers above in test mode.
2. **Full browser test run** there (Playwright), then a walk-through of each agreement flow: event → tickets → check-in; wedding; conference; marketing.
3. **Legacy data:** a masked copy of the Laravel database (`tools/legacy-mask`), migrated with `pnpm migrate:legacy`, totals reconciled.
4. **Backups:** a restore drill (`deploy/scripts/restore.sh`).
5. **Security and load:** the ZAP scan (`zap/run-baseline.sh`) and k6 load scripts against staging.
6. **Production:** deploy with `deploy.sh <commit>` (with your "go" at each step), then cut over from the old site (`docs/runbooks/cutover.md`).

## Outside the agreement

- **Mobile app.** The current App Store app calls the old `/api/v2`, which the new platform does not serve. It stops working when the old site is switched off unless the `/api/v2` bridge (ADR 0007) is built or a new app is made. Native apps are excluded from this agreement, so this needs your decision.
