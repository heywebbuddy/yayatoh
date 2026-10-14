import { guestSnapshotQuery, recordGuestArrivalsCommand } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { withTenant } from '@yayatoh/db';
import { publicGiving } from '@yayatoh/donations';
import { findEventTx } from '@yayatoh/events';
import { type CommandPorts, type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';

/**
 * The card-saving entry at guest check-in (M4.8e on M4.4b's check-in; batch 3j merge): while the
 * event takes gifts online (a connected account and an open campaign, P4-9), the event's card page
 * opened from check-in (`?src=checkin`), with its QR path. Null otherwise. The door apps' guest
 * check-in and the day-of page show it right after a guest arrives.
 */
export async function checkinCardEntry(
  orgId: string,
  eventId: string,
): Promise<{ url: string; size: number; d: string } | null> {
  const giving = await publicGiving(orgId, eventId);
  if (!giving.available || giving.campaigns.length === 0) return null;
  const event = await withTenant(
    createCtx({ orgId, actor: { type: 'system', name: 'donations.card' } }),
    (tx) => findEventTx(tx, eventId),
  );
  if (!event) return null;
  // The locale-neutral address: the phone's own language decides the page's (proxy).
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const url = `${origin}/events/${event.slug}/card?src=checkin`;
  return { url, ...qrPath(url) };
}

/**
 * The guest snapshot of the device's event (M4.4b): names, party labels and tables for check-in by
 * name or party, the guest kiosk and the A–Z board, offline too; an allowlist with no contact
 * detail, meal or private answer. While the event takes gifts, the card-saving code shown after a
 * guest arrives rides along. `GET /api/scan/guests` and `GET /v1/staff/events/{eventId}/guests`.
 */
export async function guestSnapshotFor(ctx: Ctx, eventId: string, ports: CommandPorts<TenantTx>) {
  const snapshot = await executeQuery(guestSnapshotQuery, { eventId }, ctx, ports);
  const card = ctx.orgId ? await checkinCardEntry(ctx.orgId, eventId) : null;
  return { ...snapshot, card };
}

/** The device's guest check-ins (offline ones too): idempotent per check-in, first wins. */
export function recordGuestArrivals(ctx: Ctx, input: unknown, ports: CommandPorts<TenantTx>) {
  return executeCommand(recordGuestArrivalsCommand, input as never, ctx, ports);
}
