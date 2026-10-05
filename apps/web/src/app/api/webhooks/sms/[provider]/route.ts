import { handleWebhook } from '@/server/delivery-webhooks.ts';

/** SMS status callbacks (Twilio, `?m=<message id>`, M3.5b); see `handleWebhook`. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleWebhook(req, 'sms', provider);
}
