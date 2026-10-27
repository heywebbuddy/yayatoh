import 'server-only';
import {
  chatInboxQuery,
  lobbyQuery,
  myConnectionsQuery,
  myMeetingsQuery,
  networkHomeQuery,
  networkingEvent,
} from '@yayatoh/engagement';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import type { GuestOrderDto } from '@yayatoh/orders';
import { attendeeEvents } from '@/lib/attendee.ts';
import { ports } from './ports.ts';

export interface AttendeeNetworkingEvent {
  readonly eventId: string;
  readonly slug: string;
  readonly name: string;
  readonly optedIn: boolean;
  readonly meetings: boolean;
  readonly lobby: boolean;
  readonly waiting: {
    readonly connections: number;
    readonly meetings: number;
    readonly chats: number;
    readonly lobby: number;
  };
}

/**
 * The attendee's events with networking open, with what waits for them (requests, meetings,
 * unread chats and lobby messages). The address is the portal's verified identity.
 */
export async function loadAttendeeNetworking(
  orders: readonly GuestOrderDto[],
  email: string,
): Promise<AttendeeNetworkingEvent[]> {
  const now = new Date();
  const events = attendeeEvents(orders.filter((o) => o.endsAt > now && o.status !== 'refunded'));
  const out: AttendeeNetworkingEvent[] = [];
  for (const o of events) {
    const info = await networkingEvent(o.orgId, o.eventId);
    if (!info) continue;
    const ctx = createCtx({ orgId: o.orgId });
    const at = { eventId: o.eventId, email };
    try {
      const home = await executeQuery(networkHomeQuery, at, ctx, ports);
      const optedIn = Boolean(home.profile?.optedIn && !home.profile.hidden);
      if (!optedIn) {
        out.push({
          eventId: o.eventId,
          slug: info.slug,
          name: info.name,
          optedIn,
          meetings: home.meetingsEnabled,
          lobby: false,
          waiting: { connections: 0, meetings: 0, chats: 0, lobby: 0 },
        });
        continue;
      }
      const [c, m, chats, lobby] = await Promise.all([
        executeQuery(myConnectionsQuery, at, ctx, ports),
        executeQuery(myMeetingsQuery, at, ctx, ports),
        executeQuery(chatInboxQuery, at, ctx, ports),
        executeQuery(lobbyQuery, at, ctx, ports),
      ]);
      out.push({
        eventId: o.eventId,
        slug: info.slug,
        name: info.name,
        optedIn,
        meetings: home.meetingsEnabled,
        lobby: lobby.enabled,
        waiting: {
          connections: c.incoming.length,
          meetings: m.incoming.length,
          chats: chats.conversations.reduce((n, x) => n + x.unread, 0),
          lobby: lobby.unread,
        },
      });
    } catch (err) {
      // Not registered with this address, or networking just closed: nothing to show.
      if (!isDomainError(err)) throw err;
    }
  }
  return out;
}
