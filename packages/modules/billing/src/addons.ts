import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, eq } from 'drizzle-orm';
import { addons, eventAddons } from './schema.ts';

/** Event add-ons modeled now so a price switches on later with no code change (P4-4, P5-11). */
export const EVENT_ADDON_KEYS = ['conference_pack'] as const;
export type EventAddonKey = (typeof EVENT_ADDON_KEYS)[number];

export interface EventAddon {
  readonly key: EventAddonKey;
  readonly source: 'beta_free' | 'purchase' | 'override';
  /** Per-event limits the owning module enforces (a missing key = no limit). */
  readonly quotas: Readonly<Record<string, number>>;
}

/** The add-on's catalog row (global reference data). */
async function catalogTx(tx: TenantTx, key: EventAddonKey) {
  const [row] = await tx.select().from(addons).where(eq(addons.key, key));
  if (!row) throw new DomainError('internal', `Add-on missing from the catalog: ${key}`);
  return row;
}

/** The add-on as active for an event, or null when it is not. */
export async function eventAddonTx(
  tx: TenantTx,
  eventId: string,
  key: EventAddonKey,
): Promise<EventAddon | null> {
  const [row] = await tx
    .select()
    .from(eventAddons)
    .where(and(eq(eventAddons.eventId, eventId), eq(eventAddons.addonKey, key)));
  if (!row) return null;
  const cat = await catalogTx(tx, key);
  return { key, source: row.source as EventAddon['source'], quotas: cat.quotas };
}

/**
 * Make sure the add-on is active for the event (idempotent), inside the caller's transaction.
 * Free in beta (catalog price null): activated on first use and recorded as `beta_free`. Once the
 * catalog carries a price, a new event needs a purchase first (M6.6 / D22): `payment_required`.
 * Events activated before keep it.
 */
export async function ensureEventAddonTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  key: EventAddonKey,
): Promise<EventAddon> {
  const active = await eventAddonTx(tx, eventId, key);
  if (active) return active;
  const cat = await catalogTx(tx, key);
  if (cat.priceMinor !== null)
    throw new DomainError('invalid_state', 'This add-on must be purchased for the event first', {
      reason: 'addon_purchase_required',
      addon: key,
    });
  await tx
    .insert(eventAddons)
    .values({ orgId: requireOrg(ctx), eventId, addonKey: key, source: 'beta_free', priceMinor: 0 })
    .onConflictDoNothing();
  return { key, source: 'beta_free', quotas: cat.quotas };
}
