# marketing (tier 5)

Marketing: tracked links, click tracking and order attribution (M3.8a). Campaigns (M3.6b) and journeys (M3.7a) will join this module and create their links through `createTrackedLinkTx`. Owns Postgres schema `marketing`.

**Invariants**
- **Open-redirect proof.** A tracked link's destination is a *path* on the host that served `/r/{code}`, never a URL. `destinationProblem` validates it when the link is created (and a CHECK constraint again in the database); `redirectTarget` builds the Location from the request's own origin and throws if it would leave it.
- **Tenancy.** Codes are global (`tracking_links_code_key`) and resolve only through the SECURITY DEFINER `marketing.tracked_link_target(code)` (allowlisted columns, live orgs, events with a public page). On a tenant host only the host's org's links resolve; the org of a click always comes from the link, never from the request.
- **Signed click id.** The click id is the uuidv7 of the `link_clicks` row; `yyc=<id>~<hmac>` (HMAC-SHA256 under `APP_TOKEN_SECRET`, purpose-bound) goes in the destination URL and the 24-hour `yy_click` cookie. `verifyClickToken` rejects forged, altered, expired and future tokens. A tampered token is ignored, never an error.
- **No PII in the click log.** Only keyed hashes of the IP address and the `yy_did` device cookie (`pseudonym`), no user agent, no referrer. Bots (user agents), HEAD requests and rate-limited floods (`trackedClick` policy) still get the redirect but no click row and no click id.
- **Attribution.** One record per order (`attributions_org_order_key`), written by `attributeOrderCommand` right after the order is created (the checkout hook). Clicks count when they are for the order's event and inside the org's window (default 30 days, 1–90, pending owner) before the order; first touch is the earliest, last touch the latest. Without a click, the UTM values the buyer landed with (`yy_utm` cookie, first and last) give a `utm` record. The records keep the window they were made with.
- **Reports** count sold orders only (paid, partially refunded, refunded) through the orders module's `orderOutcomesTx` facts; revenue is the gross order total per currency in integer minor units (refunds are not netted, as in M1.12's gross). Conversion is last-touch orders per click.
- **Permissions.** Reading links and reports: `marketing:read` (owners, admins, managers, marketing, finance, viewers). Creating links and changing the window: `marketing:write`. Entitlement: `marketing`. An order's attribution record: `orders:read`.
- **Touch paths (M6.2b).** With each attribution record, `attributeOrderCommand` writes the order's
  touch path (`attribution_touches`): every counting click (at most 50: the first and the latest
  49) with its link's UTM values and campaign, or the first and last landings (`utm`, or `referral`
  for a landing from another site: the landing capture turns a foreign `Referer` host into
  `source = host, medium = referral`; only the host is kept). It emits `marketing.order_attributed@1`
  (ids only). `eventTouchPathsTx` serves the paths to the analytics warehouse; records made before
  M6.2b fall back to their first and last touch.
