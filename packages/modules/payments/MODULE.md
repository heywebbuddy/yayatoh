# payments (tier 3)

The `PaymentProvider` port and provider-event bookkeeping. Owns Postgres schema `payments`.

**Invariants**
- A new payout destination (an account connected; later, a bank change reported by the provider) waits **24 h** before any transfer goes to it (`destination_hold_until`, roadmap §10); `payouts.destination_changed@1` tells the owners at once (`payments.destination-changed`: in-app and email, through the notifications core). Payout set-up and continuing onboarding are step-up commands (M1.2c).
- Every side effect with a provider carries an idempotency key; provider webhooks are verified on the **raw body** and deduplicated by provider event id (`provider_events` unique per org × provider × event id).
- Two funds flows (roadmap §5.3): `organizer_mor` (direct charge on the connected account + application fee) and `platform_mor` (platform charge; separate charges & transfers, transfer at release). The flow is recorded on every order.
- Until the owner's Stripe account exists, the `fake` provider runs in dev/preview/CI only. It is refused when `VERCEL_ENV=production`.
- **Reconciliation (M1.6e):** one run per org and UTC day (`reconciliation_runs`, unique), differences as items matched by the ledger reference both sides share; runs are recorded only by the platform; resolving needs `finance:reconcile` and a note. Every provider write the platform makes is tagged with `metadata.yayatoh_ref` (its idempotency key) and `orgId`.
- **Evidence (M1.6e):** the organizer's statement and exclusions are saved while the dispute is open; submission is recorded once, after the provider accepted it.
- **Dispute deadline alerts (M3.10c):** `payments.alertDisputeDeadlines` (system only; worker hourly, dev route in dev/CI) raises `payments.dispute_deadline_approaching@1` once per level for open disputes: level 1 at three days before the evidence deadline, level 2 at one day (`deadline_alert_level`, raised under a row lock with `WHERE level < new`). `payments.dispute-deadline-notifier` tells owners, admins and finance (in-app + email) until the M3.2b alert engine consumes the event.
