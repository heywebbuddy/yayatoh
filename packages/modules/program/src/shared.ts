import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { DomainError, type DomainEvent } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { exhibitors, speakers, sponsors } from './schema.ts';

/** The event under the org's RLS, or `not_found` (foreign and unknown ids look the same). */
export async function eventOf(tx: TenantTx, eventId: string): Promise<EventDto> {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found');
  return ev;
}

export const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

/** Program rows that own images (M1.4h): speaker photos, exhibitor and sponsor logos. */
export const PROGRAM_OWNER_KINDS = ['speaker', 'exhibitor', 'sponsor'] as const;
export type ProgramOwnerKind = (typeof PROGRAM_OWNER_KINDS)[number];

/** `program.speaker_deleted@1` etc.: the payload names the org, event and row. */
export function programOwnerDeleted(kind: ProgramOwnerKind, eventId: string, id: string): DomainEvent {
  return {
    type: `program.${kind}_deleted`,
    version: 1,
    aggregateType: `program_${kind}`,
    aggregateId: id,
    payload: { kind, eventId, id },
  };
}

/**
 * The event and name of a speaker, exhibitor or sponsor under the org's RLS, or null (another
 * org's and unknown ids look the same). Media checks image owners with it.
 */
export async function programOwnerTx(
  tx: TenantTx,
  kind: ProgramOwnerKind,
  id: string,
): Promise<{ eventId: string; name: string } | null> {
  const table = kind === 'speaker' ? speakers : kind === 'exhibitor' ? exhibitors : sponsors;
  const [row] = await tx
    .select({ eventId: table.eventId, name: table.name })
    .from(table)
    .where(eq(table.id, id));
  return row ?? null;
}
