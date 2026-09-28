# orders (tier 4)

Orders, order items and checkout. Owns Postgres schema `orders`.

**Invariants**
- A large refund (≥ `LARGE_REFUND_MINOR` = 50,000 minor units, or the whole order; threshold pending owner confirmation) needs a recent step-up; `startRefund` checks it after computing the amount (M1.2c).
- Lifecycle (`domain/lifecycle.ts`, roadmap §5.2): reserved → awaiting_payment → paid, with payment_failed, expired and cancelled. Changes use `UPDATE … WHERE status = ANY(from)`.
- `paid` is set only from a verified, deduplicated provider event, a zero-total order, or an audited staff action — never from the browser.
- Totals and the fee schedule are **snapshotted** on the order and its items; later price or fee changes never alter an order.
- Holds last 10 minutes (+5 when payment starts); the sweeper releases expired holds.
- Guest orders are managed through a random `manage_token`; only its SHA-256 hash is stored.
- **Dates (M1.4b):** a multi-date event sells one date per order (`orders.occurrence_id`, required when the event has dates). The date's row is locked, then its capacity is checked against live tickets for it plus tickets in orders still holding stock (`claimOccurrenceTx`); checkout and the box office both use it.
- **Refund policy (M1.6e):** one policy per event (`refund_policies`); discretionary refunds (`requested_by_customer`, `goodwill`) follow it, evaluated in the event's timezone inside `orders.startRefund`; the platform minimum (cancellation, long postponement) and duplicates/fraud never do. Refunding outside it is only `orders.startPolicyOverrideRefund` (owner/admin, note, audited).
- **Checkout risk (M1.6e):** the server action assesses the risk port before `startCheckout`; a block never creates an order; a review is recorded in `risk_review`.
- **Guest email verification (M1.5f):** `guest_challenges` and `guest_sessions` are global (listed in `GLOBAL_TABLES`; app_user only, no platform_reader). They store HMACs of codes, magic links, browser states and session tokens, never the secrets. A code is 6 random digits, works once, for 10 minutes, and locks after 5 wrong tries (outcomes are returned, not thrown, so the count commits); a new code retires the address's older ones and is refused within 30 s of the last. Magic links work once, for 15 minutes, only in the browser whose state cookie asked for them. Sends and checks count against the M1.14 limiter (`guestCode`, `guestVerify`) per device and per address.
- **Attendee sessions** are separate from organizer (Better Auth) sessions, bound to the host that issued them and to one org's site (or the marketplace, null scope). Listing across orgs goes only through `orders.order_refs_by_email` (ids only) and then each org's RLS.
- **Manage links:** reissuing replaces both the hash and the ciphertext (the old link stops at once), is audited and emits `order.manage_link_reissued@1`; "email me my links" emits `order.links_requested@1` with order ids only, the same for any address. Events never carry tokens or addresses.
