# Self-serve sign-up and online payment

`/signup` (no code) is the self-service page: pick a plan (Free, Starter, Pro, Agency; monthly or
yearly), verify the email, name the organization, pay online and land in onboarding. Enterprise
is the only plan with a form: "Talk to sales" opens the application form in a popup, and the
applications queue in the admin panel stays for Enterprise and demo requests. A link with
`?code=…` (an approved application or a staff signup code) still uses the invitation flow.

## How it flows

1. The page lists the live plans (`publicPlanTiers`): a plan is sold only when staff switched it
   on in **Plans & billing** and it has an active price for the interval. Anything else shows
   "Not on sale yet" (or "Coming soon" while online payment is off).
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

## What the person sees when something is not switched on

| Situation | What `/signup` does |
| --- | --- |
| `BILLING_ENABLED` off on the web service | Paid plans show "Coming soon" with a note and a "Talk to sales" button. Free still works. A paid sign-up that is sent anyway is refused **before** any organization is created (`billing_off`, logged as `selfServeSignup: billing_off`). |
| Billing on, but no paid plan is on sale | The same note. Staff fix it in the admin console. |
| A plan is not on sale | The card says "Not on sale yet" and cannot be picked. |
| `?plan=` unknown (for example `?plan=gold`) | The picker opens with a notice and **no plan selected**; nothing is created. `starter` and `tier_starter` both work (also `pro`, `agency`, `free`; `white_label` means Agency). |
| The checkout cannot be started after the organization exists | The error is logged as one JSON line (`selfServeSignup: checkout_failed`, with org, plan, interval, provider and message) and the person lands on "We could not start the payment" with a retry. |

After sign-up the person always lands on `/signup/welcome` first (for a paid plan, once the payment
is confirmed by the webhook). It says the next step is two-step verification and offers the button;
nothing redirects by itself.

## Admin switches

- **Open sign-up** (admin console, *Open sign-up*) must be **ON**, or `/signup` shows the closed
  page and the self-serve action refuses (`signup_closed`).
- **Plans & billing**: after a catalog sync every plan is a draft. Click **Put on sale** on each
  plan you want sold (Free, Starter, Pro, Agency): it switches the plan and all of its priced
  prices on in one step, with the same checks as the editor (with Stripe, the plan must match its
  product, prices and features, or the click is refused with "provider mismatch").

## What the owner configures (nothing here was done by the build)

Railway, **web** service (and the **worker** for the catalog sync):

| Variable | Service | Value |
| --- | --- | --- |
| `BILLING_ENABLED` | web, worker, admin | `1` (without it paid plans show "Coming soon", no webhook is accepted, no catalog sync runs) |
| `BILLING_PROVIDER` | web, worker, admin | `stripe` (default is `fake`, which production refuses) |
| `STRIPE_SECRET_KEY` | web, worker, admin | the live secret (or restricted) key; a restricted key needs Checkout, Customers, Prices, Products, Entitlements (read) and Tax settings |
| `STRIPE_BILLING_WEBHOOK_SECRET` | web (worker and admin too if they verify) | the signing secret (`whsec_…`) of the endpoint below |
| `NEXT_PUBLIC_APP_ORIGIN` | web | the public https origin of the web app; the checkout sends people back to `<origin>/signup/welcome` and `<origin>/signup/pay` (falls back to `BETTER_AUTH_URL`) |
| `HUMAN_CHECK_PROVIDER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | web | the human check on the sign-up form |
| `FAKE_PAYMENTS_SECRET` | local and CI only | not for production |

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
- Then run the catalog sync once (the worker does it hourly) so Plans & billing mirrors Stripe, and click **Put on sale** on each plan.

Local testing uses `BILLING_PROVIDER=fake` with `FAKE_PAYMENTS_SECRET`: the checkout is the signed
dev page `/signup/pay/fake`, never available in production.
