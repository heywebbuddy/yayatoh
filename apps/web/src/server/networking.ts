import 'server-only';
import {
  myConnectionsQuery,
  myMeetingsQuery,
  type NetworkHomeDto,
  networkHomeQuery,
  networkingEvent,
} from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import { type Ctx, createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { normalizeGuestEmail } from '@yayatoh/orders';
import { cache } from 'react';
import { classifyHost } from '@/lib/hosts.ts';
import { currentGuestSession, guestHost } from './guest.ts';
import { ports } from './ports.ts';
import { ownAuthSession } from './session.ts';

/**
 * Networking in the web app (M5.8a). An attendee is the address they proved with an emailed code
 * (the M1.5f "My tickets" sign-in on this host), or their own account's verified address; the
 * engagement module turns that into their place at the event. The org and event come from the
 * event's public slug, never from the form. Networking pages live on the marketplace (and app)
 * host; an org's own site links there.
 */
export interface NetworkTarget {
  readonly orgId: string;
  readonly eventId: string;
  readonly slug: string;
  readonly eventName: string;
  /** The event's IANA zone: slots and meetings render in it. */
  readonly timeZone: string;
}

/** The published event behind a slug with networking turned on, else null (a 404). */
export const networkTarget = cache(async (slug: string): Promise<NetworkTarget | null> => {
  const { host } = await guestHost();
  if (classifyHost(host) === 'tenant') return null;
  const t = await checkoutTarget(slug);
  const ev = t ? await networkingEvent(t.orgId, t.eventId) : null;
  if (!t || !ev) return null;
  return { ...t, slug, eventName: ev.name, timeZone: ev.timeZone };
});

/** The address this browser proved (a guest session on this host, or a verified account). */
export const networkEmail = cache(async (): Promise<string | null> => {
  const guest = await currentGuestSession(null);
  if (guest) return guest.email;
  const own = await ownAuthSession();
  return own?.user.emailVerified && own.user.email ? normalizeGuestEmail(own.user.email) : null;
});

/** Attendees act as the public: the module checks their place at the event in every command. */
export const attendeeCtx = (t: NetworkTarget): Ctx => createCtx({ orgId: t.orgId });

/** The locale-neutral networking paths of an event. */
export const networkPath = (slug: string, rest = '') => `/events/${slug}/network${rest}`;

export type NetworkPage =
  | { readonly kind: 'sign_in'; readonly target: NetworkTarget }
  | { readonly kind: 'not_attendee'; readonly target: NetworkTarget }
  | { readonly kind: 'opt_in'; readonly target: NetworkTarget; readonly home: NetworkHomeDto }
  | {
      readonly kind: 'member';
      readonly target: NetworkTarget;
      readonly home: NetworkHomeDto;
      readonly at: { readonly eventId: string; readonly email: string };
      readonly ctx: Ctx;
      /** Requests waiting for this person's answer (the tab counts). */
      readonly waiting: { readonly connections: number; readonly meetings: number };
    };

/**
 * Where a visitor stands on an event's networking pages: not signed in, signed in with an address
 * that holds no place there, registered but not opted in (or hidden), or a member. Null: a 404.
 */
export async function loadNetworkPage(slug: string): Promise<NetworkPage | null> {
  const target = await networkTarget(slug);
  if (!target) return null;
  const email = await networkEmail();
  if (!email) return { kind: 'sign_in', target };
  const ctx = attendeeCtx(target);
  const at = { eventId: target.eventId, email };
  let home: NetworkHomeDto;
  try {
    home = await executeQuery(networkHomeQuery, at, ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'forbidden') return { kind: 'not_attendee', target };
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  }
  if (!home.profile?.optedIn || home.profile.hidden) return { kind: 'opt_in', target, home };
  const [c, m] = await Promise.all([
    executeQuery(myConnectionsQuery, at, ctx, ports),
    executeQuery(myMeetingsQuery, at, ctx, ports),
  ]);
  return {
    kind: 'member',
    target,
    home,
    at,
    ctx,
    waiting: { connections: c.incoming.length, meetings: m.incoming.length },
  };
}
