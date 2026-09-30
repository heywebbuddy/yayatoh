import { handlePaymentWebhook } from '@/server/webhooks.ts';

/**
 * Stripe webhook (M1.5e): the platform endpoint and the Connect endpoint (events from connected
 * accounts) both post here; each has its own signing secret. See `handlePaymentWebhook`.
 */
export function POST(req: Request) {
  return handlePaymentWebhook(req, 'stripe');
}
