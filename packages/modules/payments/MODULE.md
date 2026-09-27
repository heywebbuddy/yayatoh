# payments (tier 3)

The `PaymentProvider` port and provider-event bookkeeping. Owns Postgres schema `payments`.

**Invariants**
- A new payout destination (an account connected; later, a bank change reported by the provider) waits **24 h** before any transfer goes to it (`destination_hold_until`, roadmap §10); the owners are emailed through `payouts.destination_changed@1`. Payout set-up and continuing onboarding are step-up commands (M1.2c).
- Every side effect with a provider carries an idempotency key; provider webhooks are verified on the **raw body** and deduplicated by provider event id (`provider_events` unique per org × provider × event id).
- Two funds flows (roadmap §5.3): `organizer_mor` (direct charge on the connected account + application fee) and `platform_mor` (platform charge; separate charges & transfers, transfer at release). The flow is recorded on every order.
- Until the owner's Stripe account exists, the `fake` provider runs in dev/preview/CI only. It is refused when `VERCEL_ENV=production`.
