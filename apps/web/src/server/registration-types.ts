import 'server-only';
import { executeQuery } from '@yayatoh/kernel';
import { listTicketTypesQuery, publicTicketTypes } from '@yayatoh/ticketing';
import type { loadEvent } from './console.ts';
import { ports } from './ports.ts';

/** A registration type as the forms builder and respondents pick it: an opaque id and a name. */
export interface RegistrationTypeOption {
  readonly id: string;
  readonly name: string;
}

/**
 * **Stand-in until M5.1a** (registration types, Wave 1 in parallel): the event's ticket types play
 * the registration types. The forms engine only sees opaque ids supplied here, so the Wave 2
 * wiring swaps these two functions for the registration module's types with no forms change.
 */
export async function consoleRegistrationTypes(
  data: Awaited<ReturnType<typeof loadEvent>>['data'],
  eventId: string,
): Promise<RegistrationTypeOption[]> {
  const types = await executeQuery(listTicketTypesQuery, { eventId }, data.ctx, ports);
  return types.filter((t) => t.archivedAt === null).map((t) => ({ id: t.id, name: t.name }));
}

/** The types a member of the public may pick on a published event (stand-in, see above). */
export async function publicRegistrationTypes(slug: string): Promise<RegistrationTypeOption[]> {
  const types = await publicTicketTypes(slug, new Date());
  return types.filter((t) => !t.isDonation).map((t) => ({ id: t.id, name: t.name }));
}
