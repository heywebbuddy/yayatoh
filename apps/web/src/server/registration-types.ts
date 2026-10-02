import 'server-only';
import { checkoutTarget } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { publicRegistration, registrationTypeRefsQuery } from '@yayatoh/registration';
import type { loadEvent } from './console.ts';
import { ports } from './ports.ts';

/** A registration type as the forms builder and respondents pick it: an opaque id and a name. */
export interface RegistrationTypeOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The event's registration types (M5.1a, `RegistrationTypeRef`) for the form builder: every live
 * type, so pages and questions can be limited to any of them. The forms engine only sees their
 * ids (batch 3e wiring; the ticket-type stand-in is gone).
 */
export async function consoleRegistrationTypes(
  data: Awaited<ReturnType<typeof loadEvent>>['data'],
  eventId: string,
): Promise<RegistrationTypeOption[]> {
  const refs = await executeQuery(registrationTypeRefsQuery, { eventId }, data.ctx, ports);
  return refs.map((t) => ({ id: t.id, name: t.name }));
}

/**
 * The types a member of the public may start the form as: the event's live types this person is
 * eligible for (M5.1a eligibility: open types, or a type of their email's domain once the email
 * is known) that offer a pass. Code-only types are picked on the registration page, not here.
 */
export async function publicRegistrationTypes(
  slug: string,
  email: string | null = null,
): Promise<RegistrationTypeOption[]> {
  const target = await checkoutTarget(slug);
  if (!target) return [];
  const offer = await publicRegistration(target.orgId, target.eventId, { email });
  return offer.types.map((t) => ({ id: t.id, name: t.name }));
}
