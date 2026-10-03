import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantQuery } from '@yayatoh/platform';
import { sessionDoorFactsTx } from '@yayatoh/program';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkpoints, VIRTUAL_CHECKPOINT_KIND, virtualAttendance } from './schema.ts';

/**
 * M6.9a: the virtual checkpoint. The virtual module (same tier) emits `virtual.attended@1` for a
 * ticket's first counted minute of a session's stream; this subscriber checks the ticket in at
 * the session's virtual checkpoint, creating that checkpoint on first use. Once per ticket and
 * checkpoint (unique key), so a replayed or duplicated event changes nothing. Ids only.
 */
const Attended = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  sessionId: z.uuid(),
  ticketId: z.uuid(),
  at: z.iso.datetime(),
});

/** Checkpoint names are unique per event: "Online · {session}", shortened to fit. */
export function virtualCheckpointName(title: string, attempt = 0): string {
  const suffix = attempt === 0 ? '' : ` (${attempt + 1})`;
  const base = `Online · ${title}`.slice(0, 120 - suffix.length).trim();
  return `${base}${suffix}`;
}

/** The session's virtual checkpoint, created if it has none yet. Null for an unknown session. */
export async function virtualCheckpointTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  sessionId: string,
): Promise<string | null> {
  const find = async () => {
    const [c] = await tx
      .select({ id: checkpoints.id })
      .from(checkpoints)
      .where(and(eq(checkpoints.sessionId, sessionId), eq(checkpoints.kind, VIRTUAL_CHECKPOINT_KIND)));
    return c?.id ?? null;
  };
  const found = await find();
  if (found) return found;
  const [facts] = await sessionDoorFactsTx(tx, [sessionId]);
  if (!facts || facts.eventId !== eventId) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = virtualCheckpointName(facts.title, attempt);
    const [taken] = await tx
      .select({ id: checkpoints.id })
      .from(checkpoints)
      .where(and(eq(checkpoints.eventId, eventId), eq(checkpoints.name, name)));
    if (taken) continue;
    await tx
      .insert(checkpoints)
      .values({ orgId, eventId, sessionId, name, kind: VIRTUAL_CHECKPOINT_KIND })
      .onConflictDoNothing();
    return find();
  }
  throw new DomainError('conflict', 'No free name for the virtual checkpoint');
}

export function virtualAttendanceSubscriber() {
  return defineSubscriber({
    name: 'checkin.virtual-attendance',
    events: ['virtual.attended@1'],
    handle: async (tx, event) => {
      const p = Attended.parse(event.payload);
      const checkpointId = await virtualCheckpointTx(tx, p.orgId, p.eventId, p.sessionId);
      if (!checkpointId) return;
      await tx
        .insert(virtualAttendance)
        .values({
          orgId: p.orgId,
          eventId: p.eventId,
          checkpointId,
          sessionId: p.sessionId,
          ticketId: p.ticketId,
          firstAt: new Date(p.at),
        })
        .onConflictDoNothing();
    },
  });
}

export const VirtualCheckpointDto = z.object({
  checkpointId: z.uuid(),
  sessionId: z.uuid(),
  name: z.string(),
  /** Tickets checked in here (counts only, never who). */
  checkedIn: z.number().int().nonnegative(),
});
export type VirtualCheckpointDto = z.infer<typeof VirtualCheckpointDto>;

/** An event's virtual checkpoints with their check-in counts (stream setup and the console). */
export const virtualCheckpointsQuery = tenantQuery({
  name: 'checkin.virtualCheckpoints',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(VirtualCheckpointDto),
  entitlement: 'checkin',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    requireOrg(ctx);
    const rows = await tx
      .select({
        checkpointId: checkpoints.id,
        sessionId: checkpoints.sessionId,
        name: checkpoints.name,
        checkedIn: sql<number>`(select count(*)::int from ${virtualAttendance} va where va.checkpoint_id = ${checkpoints.id})`,
      })
      .from(checkpoints)
      .where(and(eq(checkpoints.eventId, input.eventId), eq(checkpoints.kind, VIRTUAL_CHECKPOINT_KIND)))
      .orderBy(checkpoints.name);
    return rows.flatMap((r) => (r.sessionId ? [{ ...r, sessionId: r.sessionId }] : []));
  },
});
