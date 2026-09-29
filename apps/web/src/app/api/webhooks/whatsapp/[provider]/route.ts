import { metaChallenge, whatsappVerifyToken } from '@yayatoh/notifications';
import { handleWebhook } from '@/server/delivery-webhooks.ts';

/** WhatsApp statuses and inbound keywords (Cloud API or the owner's gateway, M3.5b). */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleWebhook(req, 'whatsapp', provider);
}

/** Meta's subscription check: the challenge back, only with our verify token. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const token = provider === 'cloud' ? whatsappVerifyToken(process.env) : null;
  const challenge = token ? metaChallenge(token, req.url) : null;
  if (!challenge) return new Response(null, { status: token ? 403 : 404 });
  return new Response(challenge, { headers: { 'content-type': 'text/plain' } });
}
