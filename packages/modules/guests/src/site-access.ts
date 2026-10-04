import type { TenantTx } from '@yayatoh/db';
import { appTokenSecret } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { siteAccessValid } from './domain/site.ts';
import { sites } from './schema.ts';

/**
 * M4.5b: may a visitor holding `access` (their guest-site cookie) see the event's guest pages?
 * Only while the event's site is published and the proof matches its current password version,
 * so the gallery behind the site locks with it. In the caller's transaction (the gallery
 * module's public commands and queries); reads nothing but the site row.
 */
export async function guestSiteAccessTx(
  tx: TenantTx,
  eventId: string,
  access: string | null | undefined,
): Promise<'open' | 'locked' | 'unpublished'> {
  const [row] = await tx
    .select({ id: sites.id, status: sites.status, passwordVersion: sites.passwordVersion })
    .from(sites)
    .where(eq(sites.eventId, eventId));
  if (row?.status !== 'published') return 'unpublished';
  return siteAccessValid(access, row.id, row.passwordVersion, appTokenSecret()) ? 'open' : 'locked';
}

/** The event's guest-site address (for links from the gallery console), or null before one exists. */
export async function guestSiteCodeTx(tx: TenantTx, eventId: string): Promise<string | null> {
  const [row] = await tx.select({ code: sites.code }).from(sites).where(eq(sites.eventId, eventId));
  return row?.code ?? null;
}
