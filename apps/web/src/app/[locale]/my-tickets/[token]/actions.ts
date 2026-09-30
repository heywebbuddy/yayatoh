'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { giveTicketCommand, holderContext } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import type { ClaimLinkState } from '@/components/claim-link-form.tsx';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/** A holder passes one of their tickets on: a claim link (emailed when an address is given). */
export async function giveTicketAction(
  token: string,
  ticketId: string,
  _prev: ClaimLinkState,
  form: FormData,
): Promise<ClaimLinkState> {
  const email = String(form.get('email') ?? '').trim();
  // Passing a ticket on can email a stranger: limit per device and per holder link.
  const limit = await limitAction('holderLink', { identity: `link:${token}`, scope: 'give' });
  if (!limit.allowed) return { kind: 'error', code: 'rate_limited' };
  const h = await holderContext(token);
  if (!h) return { kind: 'error', code: 'not_found' };
  try {
    const r = await executeCommand(
      giveTicketCommand,
      { linkId: h.id, ticketId, recipientEmail: email || undefined },
      h.ctx,
      ports,
    );
    revalidatePath(`/my-tickets/${token}`);
    return { kind: 'link', token: r.token, emailed: Boolean(email) };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}
