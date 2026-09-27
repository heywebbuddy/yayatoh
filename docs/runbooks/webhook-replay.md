# Webhook replay

Provider webhooks (`/api/webhooks/stripe`, `/api/webhooks/fake`) are verified on the raw body and
deduplicated by provider event id (`payments.provider_events`), so **replaying is always safe**:
an event that was already applied is acknowledged and ignored.

## Symptoms
Orders stuck in "awaiting payment" after the buyer paid; payouts or disputes not updating; Stripe
dashboard shows failed deliveries; a burst of 400/429 on the webhook route.

## Steps
1. Check why deliveries failed: logs for the webhook route. 400 = signature (wrong or rotated
   secret → [key-rotation.md](key-rotation.md)); 429 = the forged-webhook limiter (only unsigned
   calls count, so real Stripe deliveries are never limited; if 429s appear for Stripe, check the
   secret first); 5xx = our bug (incident).
2. Fix the cause and deploy.
3. **(production, owner)** Stripe dashboard → Developers → Webhooks → the endpoint → failed events
   → *Resend*, or with the CLI: `stripe events resend <evt_id> --webhook-endpoint <we_id>`.
   Stripe retries failed deliveries automatically for 3 days; resend only what's older or urgent.
4. Verify: the orders move to Paid (organizer console), tickets are issued, the Activity log shows
   the provider event applications.
5. Reconcile: compare Stripe's successful payments for the window with orders paid in the
   window (reports → bookings search, filter "awaiting payment").

