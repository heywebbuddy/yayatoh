import { handlePaymentWebhook } from '@/server/webhooks.ts';

/** Fake-provider webhook (dev/preview/CI); see `handlePaymentWebhook`. */
export function POST(req: Request) {
  return handlePaymentWebhook(req, 'fake');
}
