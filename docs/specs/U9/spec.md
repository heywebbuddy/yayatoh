# U9 — Org-wide coupons and currencies

Approved plan: `docs/plans/ux-review-1.md` (decisions UX-5 and UX-6, row U9). Brief: `docs/agent-briefs/u9.md`. Touches **payments** (pricing at checkout): fake provider only, money in integer minor units.

## What was built

### Org-wide coupons (UX-5)
- **Schema** (`ticketing`, migration `0123_wide_punisher.sql`):
  - `ticketing.coupons`: one code per org; `percent` (basis points) or `amount` (minor units plus a currency); `scope` `all` or `events` with `event_ids`; `max_redemptions` (total), `per_buyer_limit`, `redeemed_count`, `starts_at`/`ends_at`, `active`. CHECKs mirror the promo-code ones, plus: an amount carries a currency and a percentage doesn't; `events` scope names at least one event.
  - `ticketing.coupon_redemptions`: one row per order that took a coupon (`order_id`, `event_id`, `buyer_contact_id`, `released_at`).
  - `orders.orders.coupon_id`, with a hand-written FK to `ticketing.coupons`. `promo_code` keeps the code as typed, as for event codes.
- **Checkout** (`resolveCodeTx`, `claimCouponTx`): the code box tries store credit first (M3.10c), then the event's own promo code, then an org coupon.
  - A coupon must be active, inside its window, have total uses left, apply to the event and, for an amount, be in the event's currency. Otherwise the buyer gets `promo_invalid`, which never says which condition failed.
  - It is priced exactly like a promo code: per ticket, off the face price, before fees, never on donations.
  - The use is claimed with a conditional UPDATE, which never exceeds the total and locks the coupon row. The per-buyer count is then read under that lock, so two checkouts racing for a buyer's last use can't both win.
  - The buyer is their CRM contact, one per email address. That is why the per-buyer limit survives a change in letter case, and contact merges move the uses (`ticketingContactOwner`).
  - A hold that lapses, or an unpaid invoice that is voided, gives the use back. A late payment takes it again if one is left.
- **One code per org:** a coupon can't reuse an event promo code's code, and an event can't reuse a coupon's code.
- **Commands and queries:** `ticketing.createCoupon`, `ticketing.setCouponActive` (`events:write`, audited), `ticketing.listCoupons` and `ticketing.listOrgPromoCodes` (`events:read`).
- **Console:** **Coupons** (`/o/{org}/coupons`, in the org nav after Support macros) shows one table of org coupons and every event's promo codes. Columns: type, events, discount, uses against the limit, per-buyer limit, validity in the org's time zone and status, with Pause/Resume for both kinds. The add-coupon form below uses:
  - U1 `Select` for the type and scope
  - `CurrencyPicker` for an amount, defaulting to the org currency
  - `Combobox` (multiple) for the events
  - `DateTimePicker` in the org zone for the start and expiry

  The event's Tickets & Orders page links to it. The checkout explains the per-buyer limit (`checkout.couponBuyerLimit`).

### Currencies (UX-6)
- **Org default:** Settings → General's currency field is the `CurrencyPicker` (it was a 3-letter text box). The label is now "Default currency".
- **Per-event currency at creation:** the create-event form and step 3 of the guided wizard have a `CurrencyPicker` that defaults to the org currency. The wizard's first-pass price label and parsing follow the choice.
- **Locked after the first sale:**
  - `events.setEventCurrency` (`events:write`, audited, emits `event.updated@1` with `fields: ['currency']`) and the event Details page's Currency section.
  - The database holds the lock. Every order references `(org_id, event_id, currency)` → `events.events(org_id, id, currency)` (unique index `events_org_id_currency_key`). A currency change therefore fails once any order exists, including one racing the change; the command maps that to `invalid_state` / `currency_locked`.
  - Ticket types and promo codes follow the event's currency through `ON UPDATE CASCADE` FKs, so the event's prices are always in its currency. Amounts keep their minor units.
  - The Details page shows the picker read-only, with the reason, once the event has an order.
- **Totals never mix currencies:** an order can't be in a currency other than its event's (FK). Checkout already prices from the event's ticket types. Reports already group money by currency, event currency first (`gatherFactsTx`, `inCur`). So no report needed a change.

### Fix carried into U1's components
- `Combobox` had `options = []` / `selectedOptions = []` defaults, a new array each render, feeding an effect that set state. Any re-render (here, a server action's response) looped until React gave up (error #185). They are now stable module-level empty arrays. The e2e for the coupon form covers it.

## Later / not yet
- **Coupons for ticket types across events:** a coupon applies to every ticket type of its events. Choosing passes across events can come later.
- **Editing a coupon** (value, limits, dates): today you pause it and add a new one, as for event promo codes.
- **Other per-event money tables:** donation campaigns, sponsorship packages and similar don't follow a currency change. They are made after the event exists and are rare before the first sale.
- **Lock on any order:** the lock starts with the first order of any status, including an abandoned checkout that expired. See the owner inbox.

## Acceptance
| Criterion | Test |
|---|---|
| A coupon applies only to its events | `packages/testing/tests/coupons.int.test.ts` ("a chosen-events coupon applies only to its events", "an amount coupon applies only to events in its currency") |
| …within its limits (total, per buyer) | `coupons.int.test.ts` ("30 concurrent checkouts never take a 3-use coupon more than 3 times (the last use)", "one buyer racing for their last use gets it once") |
| …and dates | `coupons.int.test.ts` ("unknown, inactive, not-yet-started and ended coupons are all just not valid") |
| Released uses come back | `coupons.int.test.ts` ("an expired hold gives back both the use and the buyer's share") |
| One code per org; permissions; isolation | `coupons.int.test.ts` (last two tests); isolation suite (fixture rows for both orgs) |
| The event currency cannot change after a sale | `packages/testing/tests/event-currency.int.test.ts` ("is locked once an order exists", "a change racing checkouts never leaves an order in another currency than its event") |
| Totals never mix currencies | `event-currency.int.test.ts` (racing test asserts orders, ticket types and event agree; "is chosen at creation and checkout charges in it") |
| E2E: create an org coupon and redeem it at checkout | `apps/web/e2e/coupons-currency.spec.ts` ("an org coupon is made on the Coupons page, redeemed at checkout and counted") |
| E2E: create an event in another currency | `coupons-currency.spec.ts` ("an event is created in another currency…", "the guided wizard takes a currency…") |
| Keyboard only | `coupons-currency.spec.ts` ("keyboard only: a coupon is added without the mouse"; the currency change uses `pickWithKeyboard` and Enter) |
| axe in both themes | `expectAccessibleBothModes` on Coupons (empty form, list, errors), event Details, the wizard step and Settings |
| RTL | `coupons-currency.spec.ts` (`/ar/…/coupons` and `/ar/…/details`) |
| Viewer | `coupons-currency.spec.ts` ("a viewer sees the list but cannot add or pause"; the viewer gets no Save currency) |
| Screenshots | `docs/ux/screenshots/u9/` (before and after; light and dark; 1280 and 390 px) |
