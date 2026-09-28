# payments (tier 3)

The `PaymentProvider` port and provider-event bookkeeping. Owns Postgres schema `payments`.

**Invariants**
- Every side effect with a provider carries an idempotency key; provider webhooks are verified on the **raw body** and deduplicated by provider event id (`provider_events` unique per org × provider × event id).
- Two funds flows (roadmap §5.3): `organizer_mor` (direct charge on the connected account + application fee) and `platform_mor` (platform charge; separate charges & transfers, transfer at release). The flow is recorded on every order.
- Until the owner's Stripe account exists, the `fake` provider runs in dev/preview/CI only. It is refused when `VERCEL_ENV=production`.
- **Reconciliation (M1.6e):** one run per org and UTC day (`reconciliation_runs`, unique), differences as items matched by the ledger reference both sides share; runs are recorded only by the platform; resolving needs `finance:reconcile` and a note. Every provider write the platform makes is tagged with `metadata.yayatoh_ref` (its idempotency key) and `orgId`.
- **Evidence (M1.6e):** the organizer's statement and exclusions are saved while the dispute is open; submission is recorded once, after the provider accepted it.
