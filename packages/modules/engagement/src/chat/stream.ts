import { withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, requireOrg } from '@yayatoh/kernel';
import { parseRealtimeChannel, realtimeChannelName } from '@yayatoh/platform';
import { chatInboxIdTx } from './attendee.ts';
import { boothInboxTx } from './exhibitor.ts';
import { BOOTH_CHAT_CHANNEL, CHAT_CHANNEL } from './realtime.ts';

/**
 * Who may attach to a chat inbox (M5.8b). The web app's stream routes call these after proving
 * the caller (an address verified with an emailed code; a live exhibitor portal session); the
 * channel is always the caller's own inbox in the org the route resolved, worked out here under
 * that org's RLS. A request naming any other channel (another person, another org) is refused.
 */
const readCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'engagement.chat' } });

/** An attendee's own chat inbox at an event, or null (not a listed member there). */
export async function attendeeChatChannel(
  orgId: string,
  eventId: string,
  email: string,
): Promise<string | null> {
  const id = await withTenant(readCtx(orgId), (tx) => chatInboxIdTx(tx, eventId, email));
  return id ? realtimeChannelName(CHAT_CHANNEL, orgId, eventId, id) : null;
}

/** The signed-in exhibitor's booth chat inbox, or null. `ctx` is the portal principal's. */
export async function exhibitorChatChannel(ctx: Ctx): Promise<string | null> {
  const orgId = requireOrg(ctx);
  const own = await withTenant(ctx, (tx) => boothInboxTx(tx, ctx));
  return own ? realtimeChannelName(BOOTH_CHAT_CHANNEL, orgId, own.eventId, own.exhibitorId) : null;
}

/**
 * May a caller whose own inbox is `own` attach to `requested`? Only to exactly that channel: a
 * well-formed chat inbox in the same org, event and inbox. Everything else is refused.
 */
export function chatAttachAllowed(own: string | null, requested: string): boolean {
  if (!own) return false;
  const a = parseRealtimeChannel(own);
  const b = parseRealtimeChannel(requested);
  return Boolean(
    a &&
      b &&
      b.scope === 'inbox' &&
      a.orgId === b.orgId &&
      a.eventId === b.eventId &&
      a.inboxId === b.inboxId &&
      a.topic === b.topic,
  );
}
