import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';

/** The event under the org's RLS, or `not_found` (foreign and unknown ids look the same). */
export async function eventOf(tx: TenantTx, eventId: string): Promise<EventDto> {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found');
  return ev;
}

export const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });
