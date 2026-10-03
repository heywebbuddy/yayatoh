import { activeAttendeeByEmailTx, activeEventContactsTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import type { EventDto } from '@yayatoh/events';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import {
  meetingSlots,
  meetings,
  networkBlocks,
  networkConnections,
  networkProfiles,
  networkSettings,
} from '../schema.ts';
import { eventOf } from '../state.ts';
import type { PersonRefDto } from './dto.ts';

export type ProfileRow = typeof networkProfiles.$inferSelect;
export type NetworkSettingsRow = typeof networkSettings.$inferSelect;

export const listed = (p: Pick<ProfileRow, 'optedIn' | 'hiddenAt'>) => p.optedIn && p.hiddenAt === null;

export const personRef = (p: ProfileRow): PersonRefDto => ({
  id: p.id,
  displayName: p.displayName,
  headline: p.headline,
  company: p.company,
});

export async function networkSettingsTx(tx: TenantTx, eventId: string): Promise<NetworkSettingsRow | null> {
  const [row] = await tx.select().from(networkSettings).where(eq(networkSettings.eventId, eventId));
  return row ?? null;
}

/** Attendees take part only in a published event whose organizer turned networking on. */
export async function openNetworkTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ ev: EventDto; settings: NetworkSettingsRow }> {
  const ev = await eventOf(tx, eventId);
  const settings = await networkSettingsTx(tx, eventId);
  if (ev.status !== 'published' || !settings?.enabled) throw new DomainError('not_found');
  return { ev, settings };
}

export interface Viewer {
  readonly ev: EventDto;
  readonly settings: NetworkSettingsRow;
  readonly contactId: string;
  readonly attendeeName: string;
  readonly profile: ProfileRow | null;
}

/**
 * The verified address's place at the event (the web app proved the address with an emailed code;
 * the command only ever trusts that proof, never a profile id from the browser). `forbidden`
 * (`not_attendee`) when the address holds no active place there.
 */
export async function viewerTx(tx: TenantTx, eventId: string, email: string, lock = false): Promise<Viewer> {
  const { ev, settings } = await openNetworkTx(tx, eventId);
  const who = await activeAttendeeByEmailTx(tx, eventId, email);
  if (!who)
    throw new DomainError('forbidden', 'No registration for this address', { reason: 'not_attendee' });
  const q = tx
    .select()
    .from(networkProfiles)
    .where(and(eq(networkProfiles.eventId, eventId), eq(networkProfiles.contactId, who.contactId)));
  const [profile] = await (lock ? q.for('update') : q);
  return { ev, settings, contactId: who.contactId, attendeeName: who.name, profile: profile ?? null };
}

/** The viewer's own listed profile: `invalid_state` (`not_opted_in` / `hidden`) otherwise. */
export function memberOf(v: Viewer): ProfileRow {
  if (!v.profile?.optedIn)
    throw new DomainError('invalid_state', 'Networking is off for you', { reason: 'not_opted_in' });
  if (v.profile.hiddenAt)
    throw new DomainError('invalid_state', 'Your profile is hidden', { reason: 'hidden' });
  return v.profile;
}

/** Profile ids either side of a block with `me`. */
export async function blockedWithTx(tx: TenantTx, me: string): Promise<Set<string>> {
  const rows = await tx
    .select({ blocker: networkBlocks.blockerId, blocked: networkBlocks.blockedId })
    .from(networkBlocks)
    .where(or(eq(networkBlocks.blockerId, me), eq(networkBlocks.blockedId, me)));
  return new Set(rows.map((r) => (r.blocker === me ? r.blocked : r.blocker)));
}

/** Of these profiles, the ones whose person still holds an active place at the event. */
export async function activeProfilesTx(tx: TenantTx, eventId: string, rows: readonly ProfileRow[]) {
  const active = await activeEventContactsTx(
    tx,
    eventId,
    rows.map((r) => r.contactId),
  );
  return rows.filter((r) => active.has(r.contactId));
}

/**
 * Another person as the viewer may see them: listed, still attending, no block either way. Else
 * `not_found` (a person who is not there and one who is hidden from you look the same).
 */
export async function visiblePersonTx(
  tx: TenantTx,
  me: ProfileRow,
  personId: string,
  lock = false,
): Promise<ProfileRow> {
  if (personId === me.id) throw new DomainError('not_found');
  const q = tx
    .select()
    .from(networkProfiles)
    .where(and(eq(networkProfiles.id, personId), eq(networkProfiles.eventId, me.eventId)));
  const [p] = await (lock ? q.for('update') : q);
  if (!p || !listed(p)) throw new DomainError('not_found');
  if ((await blockedWithTx(tx, me.id)).has(p.id)) throw new DomainError('not_found');
  if ((await activeProfilesTx(tx, me.eventId, [p])).length === 0) throw new DomainError('not_found');
  return p;
}

/**
 * Leaving the directory (opting out, being hidden by the organizer): requests still waiting are
 * withdrawn and meetings not yet held are cancelled, so tables free up. Accepted connections stay
 * (they come back if the person opts in again) but are never shown meanwhile.
 */
export async function leaveNetworkTx(tx: TenantTx, ctx: Ctx, profileId: string): Promise<void> {
  await tx
    .update(networkConnections)
    .set({ status: 'withdrawn', respondedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(networkConnections.status, 'pending'),
        or(eq(networkConnections.requesterId, profileId), eq(networkConnections.addresseeId, profileId)),
      ),
    );
  await cancelMeetingsTx(tx, ctx, or(eq(meetings.requesterId, profileId), eq(meetings.inviteeId, profileId)));
}

/** Cancel pending and accepted meetings (matching `where`) whose slot has not started. */
export async function cancelMeetingsTx(tx: TenantTx, ctx: Ctx, where: ReturnType<typeof or>): Promise<void> {
  const ahead = tx
    .select({ id: meetingSlots.id })
    .from(meetingSlots)
    .where(gt(meetingSlots.startsAt, ctx.now));
  await tx
    .update(meetings)
    .set({ status: 'cancelled', tableNo: null, respondedAt: ctx.now, updatedAt: ctx.now })
    .where(and(inArray(meetings.status, ['pending', 'accepted']), inArray(meetings.slotId, ahead), where));
}

/** Cut every tie between two people (a block or a report): requests, connection, meetings ahead. */
export async function severTx(tx: TenantTx, ctx: Ctx, a: string, b: string): Promise<void> {
  await tx
    .update(networkConnections)
    .set({ status: 'withdrawn', respondedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        inArray(networkConnections.status, ['pending', 'accepted']),
        sql`least(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = least(${a}::uuid, ${b}::uuid)`,
        sql`greatest(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = greatest(${a}::uuid, ${b}::uuid)`,
      ),
    );
  await cancelMeetingsTx(
    tx,
    ctx,
    or(
      and(eq(meetings.requesterId, a), eq(meetings.inviteeId, b)),
      and(eq(meetings.requesterId, b), eq(meetings.inviteeId, a)),
    ),
  );
}
