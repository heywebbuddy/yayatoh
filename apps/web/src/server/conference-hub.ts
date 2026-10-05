import 'server-only';
import { liveSessionIds, networkingOpen } from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg, orderByManageToken } from '@yayatoh/orders';
import { appTokenSecret } from '@yayatoh/platform';
import { type ConferenceHubDto, conferenceHubQuery, signFeedToken } from '@yayatoh/registration';
import { ports } from './ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The registrant's badge: their admission ticket's signed code (the Scan PWA reads it, M5.5a). */
export interface HubBadge {
  readonly code: string;
  readonly shortCode: string;
  readonly serial: number;
  readonly holderName: string;
  readonly typeName: string;
}

export interface ConferenceHub {
  readonly orgId: string;
  readonly hub: ConferenceHubDto;
  readonly badge: HubBadge | null;
  /** Sessions whose polls and Q&A are on (M5.7a), when the event's public pages exist. */
  readonly liveSessionIds: ReadonlySet<string>;
  /** Networking is on and the event is public (M5.8a). */
  readonly networking: boolean;
  /** The signed calendar feed path (no origin). */
  readonly feedPath: string | null;
}

/** The hub's path: the order's manage link, then the registrant (locale prefix added by Link). */
export function hubHref(token: string, registrantId: string | null, view?: string): string {
  const q = new URLSearchParams();
  if (registrantId) q.set('registrant', registrantId);
  if (view && view !== 'today') q.set('view', view);
  const s = q.toString();
  return `/orders/${token}/hub${s ? `?${s}` : ''}`;
}

/**
 * Everything the conference hub shows (M5.10a), from the order's manage link: the registration
 * module's allowlisted hub, the registrant's badge code, which sessions have live polls and Q&A,
 * whether networking is on, and the signed calendar feed link. Null for a wrong link, an order
 * without registration, or the module off (a 404).
 */
export async function loadConferenceHub(
  token: string,
  registrant?: string | null,
): Promise<ConferenceHub | null> {
  const orgId = await manageTokenOrg(token);
  if (!orgId) return null;
  const wanted = registrant && UUID.test(registrant) ? registrant : null;
  let hub: ConferenceHubDto;
  try {
    hub = await executeQuery(
      conferenceHubQuery,
      { token, registrantId: wanted },
      createCtx({ orgId }),
      ports,
    );
  } catch (err) {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  }
  const order = hub.registrantId ? await orderByManageToken(token) : null;
  const ticket = order?.tickets.find((t) => t.id === hub.registrantId && t.status === 'active');
  const typeName = new Map(order?.items.map((i) => [i.ticketTypeId, i.name]) ?? []);
  const target = await checkoutTarget(hub.eventSlug);
  const isPublic = target?.orgId === orgId && target.eventId === hub.eventId;
  const [live, networking] = isPublic
    ? await Promise.all([liveSessionIds(orgId, hub.eventId), networkingOpen(orgId, hub.eventId)])
    : [[] as string[], false];
  return {
    orgId,
    hub,
    badge: ticket
      ? {
          code: ticket.code,
          shortCode: ticket.shortCode,
          serial: ticket.serial,
          holderName: ticket.holderName,
          typeName: typeName.get(ticket.ticketTypeId) ?? '',
        }
      : null,
    liveSessionIds: new Set(live),
    networking,
    feedPath: hub.registrantId
      ? `/api/calendar/${signFeedToken({ orgId, registrantId: hub.registrantId, version: hub.feedVersion }, appTokenSecret())}.ics`
      : null,
  };
}

/** Whether an order's page links to the conference hub: it has a registrant (M5.10a). */
export async function hasConferenceHub(token: string): Promise<boolean> {
  const orgId = await manageTokenOrg(token);
  if (!orgId) return false;
  try {
    const hub = await executeQuery(
      conferenceHubQuery,
      { token, registrantId: null },
      createCtx({ orgId }),
      ports,
    );
    return hub.registrantId !== null;
  } catch (err) {
    if (isDomainError(err)) return false;
    throw err;
  }
}
