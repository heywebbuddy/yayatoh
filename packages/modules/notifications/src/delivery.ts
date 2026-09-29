import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '@yayatoh/crm';
import { withoutTenant } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextDeliveryState, SOFT_BOUNCE_WINDOW_MS, suppressionFor } from './delivery-rules.ts';
import { fallbackTx } from './fallback.ts';
import { decryptParams } from './notifier.ts';
import { evaluateComplaintRateTx } from './policy/console.ts';
import { type ProviderWebhookAdapter, WebhookVerificationError } from './providers/types.ts';
import { addressSuppressions, messageEvents, messages } from './schema.ts';

/**
 * Provider delivery reports (M1.10d): delivered, bounced (hard/soft), complained. A webhook adapter
 * verifies the provider's signature on the raw body and turns the delivery into these events; the
 * web endpoint resolves each event's org from our message id and records them with
 * `recordDeliveryEventsCommand` (deduplicated by the provider's event id). The SES (SNS
 * signatures), Twilio (`X-Twilio-Signature`) and WhatsApp adapters live in `providers/` (M3.5b);
 * the fake adapter below is what development, preview and CI use.
 */
export const DeliveryEvent = z.object({
  /** The provider's event id (deduplication key). */
  id: z.string().min(1).max(255),
  type: z.enum(['delivered', 'bounced', 'complained']),
  bounceType: z.enum(['hard', 'soft']).nullable().default(null),
  /** Our message id (sent to providers as the idempotency key / message tag). */
  messageId: z.uuid(),
  providerMessageId: z.string().max(500).nullable().default(null),
  recipient: z.string().max(320).nullable().default(null),
  detail: z.string().max(500).nullable().default(null),
  occurredAt: z.coerce.date(),
});
export type DeliveryEvent = z.infer<typeof DeliveryEvent>;

export interface DeliveryWebhookAdapter {
  readonly name: string;
  /** Throws when the signature (or timestamp) does not check out. */
  verify(rawBody: string, headers: Headers): DeliveryEvent[];
}

export const FAKE_DELIVERY_SIGNATURE_HEADER = 'x-fake-email-signature';
/** Deliveries signed longer ago than this are refused (replays). */
export const DELIVERY_SIGNATURE_TOLERANCE_S = 300;

const FakeBody = z.object({ events: z.array(DeliveryEvent).min(1).max(100) });

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

/** The fake provider's webhook secret: its own, or derived from APP_TOKEN_SECRET (dev/CI). */
export function fakeDeliverySecret(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.FAKE_EMAIL_WEBHOOK_SECRET) return env.FAKE_EMAIL_WEBHOOK_SECRET;
  if (env.APP_TOKEN_SECRET) return hmac(env.APP_TOKEN_SECRET, 'notifications.fake-delivery-webhook');
  return null;
}

/** Sign fake delivery events like a provider would (`t=<unix>,v1=<hex HMAC of "t.body">`). */
export function signFakeDeliveryEvents(
  secret: string,
  events: ReadonlyArray<Partial<DeliveryEvent> & Pick<DeliveryEvent, 'type' | 'messageId'>>,
  now = new Date(),
): { body: string; signature: string } {
  const body = JSON.stringify({
    events: events.map((e) => ({
      id: e.id ?? `fakeeml_${randomUUID()}`,
      bounceType: null,
      providerMessageId: null,
      recipient: null,
      detail: null,
      ...e,
      occurredAt: (e.occurredAt ?? now).toISOString(),
    })),
  });
  const t = Math.floor(now.getTime() / 1000);
  return { body, signature: `t=${t},v1=${hmac(secret, `${t}.${body}`)}` };
}

/** The fake provider's webhook: HMAC-SHA256 over the timestamp and the raw body, 5 minutes' tolerance. */
export function fakeDeliveryAdapter(
  secret: string,
  now: () => Date = () => new Date(),
): DeliveryWebhookAdapter {
  return {
    name: 'fake',
    verify(rawBody, headers) {
      const header = headers.get(FAKE_DELIVERY_SIGNATURE_HEADER) ?? '';
      const parts = new Map(
        header.split(',').map((p) => {
          const i = p.indexOf('=');
          return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
        }),
      );
      const t = Number(parts.get('t'));
      const sig = parts.get('v1') ?? '';
      if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(sig)) throw new Error('malformed signature');
      if (Math.abs(now().getTime() / 1000 - t) > DELIVERY_SIGNATURE_TOLERANCE_S)
        throw new Error('signature outside the tolerance window');
      const a = Buffer.from(sig, 'hex');
      const b = Buffer.from(hmac(secret, `${t}.${rawBody}`), 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid signature');
      return FakeBody.parse(JSON.parse(rawBody)).events;
    },
  };
}

/** The fake provider behind the generic webhook pipeline (M3.5b). */
export function fakeWebhookAdapter(adapter: DeliveryWebhookAdapter): ProviderWebhookAdapter {
  return {
    name: 'fake',
    async verify(req) {
      try {
        return { events: adapter.verify(req.rawBody, req.headers), inbound: [] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        throw new WebhookVerificationError(
          /tolerance/.test(msg) ? 'replayed' : /malformed/.test(msg) ? 'malformed' : 'invalid',
          msg,
        );
      }
    },
  };
}

/** The org a message belongs to (SECURITY DEFINER `notifications.message_org`), or null. */
export async function orgOfMessage(messageId: string): Promise<string | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from notifications.message_org(${messageId}::uuid)`),
  );
  return rows[0]?.org_id ?? null;
}

const RecordOutput = z.object({
  recorded: z.int(),
  duplicate: z.int(),
  unknown: z.int(),
  suppressed: z.int(),
  /** The complaint rate went over the limit and optional messaging paused (M3.5a). */
  autoPaused: z.boolean(),
  /** Undelivered texts handed to their category's next channel (M3.5b fallback chains). */
  fellBack: z.int(),
});

/**
 * Record verified delivery events for this org's messages (the webhook, a platform actor). Each
 * provider event is kept once (`(org, provider, provider event id)`); the message's delivery state
 * moves (the worst news wins); hard bounces, complaints and repeated soft bounces put the address
 * on the suppression list, which the dispatcher honours for every category.
 */
export const recordDeliveryEventsCommand = tenantCommand({
  name: 'notifications.recordDeliveryEvents',
  input: z.object({
    provider: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    events: z.array(DeliveryEvent).min(1).max(100),
  }),
  output: RecordOutput,
  entitlement: null,
  permission: 'platform:notifications.delivery_events',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const out = { recorded: 0, duplicate: 0, unknown: 0, suppressed: 0, autoPaused: false, fellBack: 0 };
    let complaints = 0;
    let bounces = 0;
    for (const e of input.events) {
      const [msg] = await tx.select().from(messages).where(eq(messages.id, e.messageId)).for('update');
      // A signed event must still name one of our sends: the provider's id has to match.
      const ids = msg?.providerMessageId?.split(',') ?? [];
      if (!msg) {
        out.unknown += 1;
        continue;
      }
      if (msg.status !== 'sent' || (e.providerMessageId && !ids.includes(e.providerMessageId))) {
        out.unknown += 1;
        continue;
      }
      const inserted = await tx
        .insert(messageEvents)
        .values({
          orgId,
          messageId: msg.id,
          provider: input.provider,
          providerEventId: e.id,
          type: e.type,
          bounceType: e.type === 'bounced' ? (e.bounceType ?? 'hard') : null,
          detail: e.detail,
          occurredAt: e.occurredAt,
        })
        .onConflictDoNothing()
        .returning({ id: messageEvents.id });
      const row = inserted[0];
      if (!row) {
        out.duplicate += 1;
        continue;
      }
      out.recorded += 1;
      if (e.type === 'complained') complaints += 1;
      if (e.type === 'bounced') bounces += 1;
      const fact = {
        type: e.type,
        bounceType: e.type === 'bounced' ? (e.bounceType ?? 'hard') : null,
        occurredAt: e.occurredAt,
      };
      await tx
        .update(messages)
        .set({
          delivery: nextDeliveryState(msg.delivery, fact),
          deliveryAt: e.occurredAt,
          updatedAt: ctx.now,
        })
        .where(eq(messages.id, msg.id));

      // A text that never arrived (M3.5b): the category's next channel gets it, once (its row
      // shares the dedupe key, and this event is recorded once).
      if ((msg.channel === 'sms' || msg.channel === 'whatsapp') && e.type === 'bounced') {
        const next = await fallbackTx(tx, orgId, msg, 'undelivered', ctx.now);
        if (next?.created) out.fellBack += 1;
      }
      if (msg.channel === 'push') continue;
      let address: string | null = null;
      if (msg.channel === 'email') {
        const email = msg.recipientEmail ?? e.recipient;
        address = email?.includes('@') ? normalizeEmail(email) : null;
      } else {
        const phone = (await decryptParams(orgId, msg.paramsCiphertext))._phone;
        address = typeof phone === 'string' && /^\+[0-9]{6,15}$/.test(phone) ? phone : null;
      }
      if (!address) continue;
      const history =
        e.type === 'bounced' && fact.bounceType === 'soft'
          ? await tx
              .select({
                type: messageEvents.type,
                bounceType: messageEvents.bounceType,
                occurredAt: messageEvents.occurredAt,
              })
              .from(messageEvents)
              .innerJoin(
                messages,
                and(eq(messages.orgId, messageEvents.orgId), eq(messages.id, messageEvents.messageId)),
              )
              .where(
                and(
                  ne(messageEvents.id, row.id),
                  gte(messageEvents.occurredAt, new Date(e.occurredAt.getTime() - SOFT_BOUNCE_WINDOW_MS)),
                  msg.channel === 'email'
                    ? sql`lower(btrim(${messages.recipientEmail})) = ${address}`
                    : eq(messages.id, msg.id),
                ),
              )
          : [];
      const reason = suppressionFor(
        fact,
        history.map((h) => ({
          type: h.type as 'delivered' | 'bounced' | 'complained',
          bounceType: h.bounceType as 'hard' | 'soft' | null,
          occurredAt: h.occurredAt,
        })),
      );
      if (!reason) continue;
      const s = await tx
        .insert(addressSuppressions)
        .values({ orgId, channel: msg.channel, addressNorm: address, reason, messageId: msg.id })
        .onConflictDoNothing()
        .returning({ id: addressSuppressions.id });
      out.suppressed += s.length;
    }
    if (complaints > 0) out.autoPaused = await evaluateComplaintRateTx(tx, ctx, emit);
    // Batch 3d merge: new bounces or complaints from a provider webhook (M3.5b) re-evaluate the
    // alert engine's deliverability rule (M3.2b) at once instead of at its next sweep. Counts only.
    if (bounces + complaints > 0)
      emit({
        type: 'messaging.delivery_problems',
        version: 1,
        aggregateType: 'organization',
        aggregateId: orgId,
        payload: { orgId, provider: input.provider, bounced: bounces, complained: complaints },
      });
    return out;
  },
  audit: (input, r) => ({
    action: 'notifications.delivery_events',
    targetType: 'provider',
    targetId: input.provider,
    data: { ...r },
  }),
});
