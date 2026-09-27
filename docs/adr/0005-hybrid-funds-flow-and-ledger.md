# ADR 0005 — Hybrid funds flow (`organizer_mor` / `platform_mor`), double-entry ledger, daily reconciliation

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §5.3)

## Context
- The first plan made Yayatoh merchant of record for everyone.
- The code audit showed today's hybrid model: connected organizers get direct charges plus an application fee; unconnected organizers are charged on the platform and settled by hand.
- The owner decided to keep the hybrid model (decision log 2026-09-26, roadmap §1.4).

## Decision
- One `PaymentProvider` port, two funds flows. The flow is chosen per org and recorded on every order as `funds_flow`.
- **`organizer_mor`** (connected organizers):
  - Direct charge on the organizer's connected account (`Stripe-Account` header), with `application_fee_amount` = platform fee + admin tax.
  - Stripe pays the organizer on the connected account's own schedule.
  - Refunds happen on the connected account; `refund_application_fee` follows the policy engine.
  - Disputes and losses are the organizer's. Receipt: "Sold by {Org}".
- **`platform_mor`** (unconnected organizers):
  - PaymentIntent on the platform account.
  - **Separate charges & transfers (SCT), with the transfer at release** (release tiers: Standard, Trusted, New / high-risk).
  - Refund before transfer: refund the platform charge. Refund after transfer: refund the charge **and** create an explicit transfer reversal (`POST /v1/transfers/{id}/reversals`).
  - **`reverse_transfer` does not apply to SCT** (it applies only to destination charges). If a reversal fails, the org gets a `receivable`.
  - Receipt: "Sold by Pani Digital Services, LLC (Yayatoh) on behalf of {Org}".
- **Ledger:** double-entry, posted only through `ledger.post_journal` (SECURITY DEFINER, owner `ledger_writer`). Each journal balances to zero per currency and has a unique idempotency key. Entries are immutable; corrections are reversing entries.
- Money is integer minor units. Fees are deterministic from the order's fee snapshot.
- **Daily three-way reconciliation:** ledger vs Stripe balance transactions vs transfers. Drift raises an alert.
- Provider webhooks are verified on the raw body and deduplicated by provider event ID.

## Alternatives
- **Yayatoh MoR for everyone.** Replaced by the owner decision.
- **Organizer MoR for everyone.** Rejected: unconnected organizers exist today.
- **Destination charges.** Not chosen for `platform_mor`; SCT allows transfer at release.

## Consequences
- Connected organizers keep their commercial terms. Unconnected organizers move from manual to automated settlement; open `commissions` become owner-signed opening balances.
- Every migrated payment records its `charge_model` so refunds route correctly.
- Platform-held funds must stay within Stripe's holding limit (UNVERIFIED; confirm in M0.1).
- Counsel items (sales tax, 1099, money transmission, ASC 606, FTC all-in pricing, organizer agreement) gate live money in M1.6.
- Release tiers, reserves and fee-refund policy are open owner decision D3.

## Revisit when
- Counsel or Stripe answers change the `platform_mor` shape.
- International events come into scope (`organizer_mor` is the reserved seam).
