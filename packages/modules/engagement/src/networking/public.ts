import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { eventOf } from '../state.ts';
import { networkSettingsTx } from './state.ts';

const readCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'engagement.public' } });

/**
 * Whether an event's networking is on (M5.8a), for the public event page's link. A switch only:
 * nothing about any person.
 */
export async function networkingOpen(orgId: string, eventId: string): Promise<boolean> {
  return withTenant(readCtx(orgId), async (tx) => (await networkSettingsTx(tx, eventId))?.enabled ?? false);
}

/**
 * The public basics of a published event whose networking is on (its name and time zone, for the
 * networking pages' header before anyone signs in); null otherwise.
 */
export async function networkingEvent(
  orgId: string,
  eventId: string,
): Promise<{ name: string; timeZone: string } | null> {
  return withTenant(readCtx(orgId), async (tx) => {
    const s = await networkSettingsTx(tx, eventId);
    if (!s?.enabled) return null;
    const ev = await eventOf(tx, eventId).catch(() => null);
    return ev?.status === 'published' ? { name: ev.name, timeZone: ev.timezone } : null;
  });
}
