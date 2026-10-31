# Self-serve sign-up and online payment

`/signup` (no code) is the self-service page: pick a plan (Free, Starter, Pro, Agency; monthly or
yearly), verify the email, name the organization, pay online and land in onboarding. Enterprise
is the only plan with a form: "Talk to sales" opens the application form in a popup, and the
applications queue in the admin panel stays for Enterprise and demo requests. A link with
`?code=…` (an approved application or a staff signup code) still uses the invitation flow.

## How it flows

1. The page lists the live plans (`publicPlanTiers`): a plan is sold only when staff switched it
   on in **Plans & billing** and it has an active price for the interval. Anything else shows
   "Not on sale yet".
2. The person signs in with an emailed code (this verifies the email), then fills the account step.
3. `selfServeAction` checks: verified email, **open sign-up is on**, the `openSignup` rate limit,
   the human check. It creates the organization with `signUpOrganization` (open mode: the org
   starts `limited` until the onboarding checklist is done).
4. Free plan: the plan is assigned at once and the person opens the organization.
   Paid plan: the provider's hosted checkout starts (`startPlanCheckout`). Nothing about the plan
   changes yet.
5. The provider's webhook (`customer.subscription.*`, `entitlements.active_entitlement_summary.updated`)
   puts the organization on the plan (`applyBillingEventCommand`, signature-verified, deduplicated
   by event id). `/signup/welcome` polls `/api/signup/status` until the plan is active, then opens
   the organization.
6. Cancel or failure returns to `/signup/pay?org=…` ("Nothing was charged"): try again, or open the
   organization on its start plan.

## Admin switches

- **Open sign-up** (admin console, *Open sign-up*) must be **ON**, or `/signup` shows the closed
  page and the self-serve action refuses (`signup_closed`).
- **Plans & billing**: switch the plans on, with prices, for the plans you want sold.

## What the owner configures (nothing here was done by the build)

Railway, web service (and the worker, if it syncs the catalog):

| Variable | Value |
| --- | --- |
| `BILLING_ENABLED` | `1` |
| `BILLING_PROVIDER` | `stripe` |
| `STRIPE_SECRET_KEY` | the live secret (or restricted) key |
| `STRIPE_BILLING_WEBHOOK_SECRET` | the signing secret of the endpoint below |
| `NEXT_PUBLIC_APP_ORIGIN` | the public https origin of the web app (return addresses of the checkout) |
| `HUMAN_CHECK_PROVIDER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | the human check on the sign-up form |

Stripe:

- A **product per paid plan**, with metadata `plan_key` = `tier_starter`, `tier_pro`, `tier_agency`
  (and `sort_order`).
- **Recurring prices** on each, with lookup keys exactly `tier_starter_month_usd`,
  `tier_starter_year_usd`, `tier_pro_month_usd`, `tier_pro_year_usd`, `tier_agency_month_usd`,
  `tier_agency_year_usd`, and amounts equal to the ones in Plans & billing. (Free needs no product.)
- **Entitlement Features** whose lookup keys are the module keys, attached to the products as in
  the plan catalog (the plan modules arrive through the entitlement webhook).
- **Stripe Tax** switched on with the head-office address (the checkout uses automatic tax).
- A **webhook endpoint** `https://<web host>/api/webhooks/billing/stripe` with events
  `customer.subscription.created|updated|deleted|paused|resumed`,
  `entitlements.active_entitlement_summary.updated`, `product.*`, `price.*`, `entitlements.feature.*`.
- Then run the catalog sync once so Plans & billing mirrors Stripe, and switch the plans on.

Local testing uses `BILLING_PROVIDER=fake` with `FAKE_PAYMENTS_SECRET`: the checkout is the signed
dev page `/signup/pay/fake`, never available in production.
