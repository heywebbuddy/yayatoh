# U9 before/after screenshots

The "before" shots come from the build branch plus batch 3i and U1; the "after" shots come from `agent/u9`. Each set is light and dark, at 1280 and 390 px. File names: `{before|after}-{screen}-{theme}-{width}.jpg`. The "after" shots were taken on the e2e database, so the lists hold test codes.

| Screen | What to look at |
|---|---|
| `coupons` (after only; the page is new) | One list of org coupons and event promo codes, with type, events, discount, uses against the limit, per-buyer limit, validity and status. The add-coupon form is below it. On phones, each row is a card. |
| `settings` | Default currency: a 3-letter text box (before) vs the CurrencyPicker with symbol and name (after). |
| `create-event` | The new Currency field, which defaults to the org currency. |
| `wizard` | Step 1 is unchanged; the currency picker is on step 3, next to the first pass. |
| `event-details` (after only) | The new Currency section: read-only with its reason, because the Open House already has orders. |
| `tickets-orders` | The promo section links to the org's Coupons list. |
| `checkout` | Public event page; the promo code box also takes org coupons. |
