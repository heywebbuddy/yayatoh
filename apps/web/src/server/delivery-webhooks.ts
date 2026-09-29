import 'server-only';
import {
  fakeDeliveryAdapter,
  fakeDeliverySecret,
  fakeWebhookAdapter,
  handleProviderWebhook,
  helpReply,
  liveWebhookAdapter,
  type ProviderWebhookAdapter,
  type WebhookChannel,
} from '@yayatoh/notifications';
import { tooManyRequests } from '@yayatoh/platform/security';
import { ports } from '@/server/ports.ts';
import { limitRequest } from '@/server/rate-limit.ts';
import { appOrigin } from '@/server/tenant-return.ts';

/**
 * Provider webhooks (M1.10d, M3.5b): `/api/webhooks/{email|sms|whatsapp}/{provider}`. Only live
 * providers answer (SES, Twilio, the WhatsApp Cloud API and the owner's gateway, chosen by config
 * names); the fake email provider answers everywhere except production unless explicitly chosen.
 * Anything else is a 404.
 */
export function webhookAdapter(channel: WebhookChannel, provider: string): ProviderWebhookAdapter | null {
  if (channel === 'email' && provider === 'fake') {
    if (process.env.VERCEL_ENV === 'production' && process.env.EMAIL_PROVIDER !== 'fake') return null;
    const secret = fakeDeliverySecret();
    return secret ? fakeWebhookAdapter(fakeDeliveryAdapter(secret)) : null;
  }
  return liveWebhookAdapter(channel, provider, process.env);
}

/**
 * The URL the provider called, on our public origin (Twilio signs it, query included): the
 * path and query of the request under `BETTER_AUTH_URL`, never a Host header.
 */
function publicUrl(req: Request): string {
  const u = new URL(req.url);
  return `${appOrigin().replace(/\/$/, '')}${u.pathname}${u.search}`;
}

const TWIML = { 'content-type': 'text/xml; charset=utf-8' };
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A provider's webhook: verified on the raw body, then recorded (deliveries deduplicated by the
 * provider's event id; keywords once per message). Failed verifications are rate-limited per
 * source (M1.14a) so forgers get a 429; signed deliveries are never limited. Twilio's inbound
 * messages get TwiML back (the HELP reply).
 */
export async function handleWebhook(
  req: Request,
  channel: WebhookChannel,
  provider: string,
): Promise<Response> {
  const adapter = webhookAdapter(channel, provider);
  if (!adapter) return new Response(null, { status: 404 });
  const raw = await req.text();
  const out = await handleProviderWebhook(
    adapter,
    { rawBody: raw, headers: req.headers, url: publicUrl(req) },
    ports,
  );
  if (!out.ok) {
    const decision = await limitRequest(req, 'webhookAbuse', { scope: `${channel}-${provider}` });
    if (!decision.allowed) return tooManyRequests(decision);
    return new Response(null, { status: 400 });
  }
  if (adapter.name === 'twilio' && new URL(req.url).pathname.endsWith('/inbound')) {
    // Where people get help (`MESSAGING_HELP_URL`, pending the owner; else the app's home page).
    const helpUrl = process.env.MESSAGING_HELP_URL || appOrigin();
    const help = out.help ? `<Message>${xml(helpReply(out.help.sender, helpUrl))}</Message>` : '';
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${help}</Response>`, {
      headers: TWIML,
    });
  }
  // The M1.10d counts (email endpoints answer exactly these); texts add fallbacks and keywords;
  // `confirmed` only when an SNS subscription was confirmed.
  const r = out.result;
  return Response.json({
    recorded: r?.recorded ?? 0,
    duplicate: r?.duplicate ?? 0,
    unknown: r?.unknown ?? 0,
    suppressed: r?.suppressed ?? 0,
    ...(channel === 'email' ? {} : { fellBack: r?.fellBack ?? 0, keywords: r?.keywords ?? 0 }),
    ...(out.confirmed ? { confirmed: true } : {}),
  });
}
