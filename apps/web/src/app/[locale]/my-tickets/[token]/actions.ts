'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { giveTicketCommand, holderContext } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import type { ClaimLinkState } from '@/components/claim-link-form.tsx';
import { ports } from '@/server/ports.ts';

/** A holder passes one of their tickets on: a claim link (emailed when an address is given). */
export async function giveTicketAction(
  token: string,
  ticketId: string,
  _prev: ClaimLinkState,
  form: FormData,
): Promise<ClaimLinkState> {
  const h = await holderContext(token);
  if (!h) return { kind: 'error', code: 'not_found' };
  const email = String(form.get('email') ?? '').trim();
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
