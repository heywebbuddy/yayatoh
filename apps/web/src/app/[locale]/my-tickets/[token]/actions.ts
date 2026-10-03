'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { setExhibitorEmailSharingCommand, withdrawLeadEmailCommand } from '@yayatoh/leads';
import {
  cancelHolderTransferCommand,
  giveTicketCommand,
  holderContext,
  startHolderTransferCommand,
} from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import type { ClaimLinkState } from '@/components/claim-link-form.tsx';
import type { SupportState } from '@/components/support-tools.tsx';
import { failure, success } from '@/server/form.ts';
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

/**
 * M3.10c: a holder transfers a ticket by name and email (agreeing to the ticket type's fee when it
 * has one). The recipient is emailed a claim link; the ticket stays the holder's until claimed.
 */
export async function holderTransferAction(
  token: string,
  ticketId: string,
  _prev: SupportState,
  form: FormData,
): Promise<SupportState> {
  const limit = await limitAction('holderLink', { identity: `link:${token}`, scope: 'transfer' });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const h = await holderContext(token);
  if (!h) return { ok: false, code: 'not_found' };
  const toName = String(form.get('toName') ?? '');
  try {
    await executeCommand(
      startHolderTransferCommand,
      {
        linkId: h.id,
        ticketId,
        toName,
        toEmail: String(form.get('toEmail') ?? ''),
        acceptFee: form.get('acceptFee') === 'yes',
      },
      h.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/my-tickets/${token}`);
  return { ...success(), name: toName.trim() };
}

/** M3.10c: the holder cancels their pending transfer before it is claimed. */
export async function cancelHolderTransferAction(
  token: string,
  transferId: string,
  _prev: SupportState,
  _form: FormData,
): Promise<SupportState> {
  const h = await holderContext(token);
  if (!h) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(cancelHolderTransferCommand, { linkId: h.id, transferId }, h.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/my-tickets/${token}`);
  return success();
}

/** M5.6b: the holder stops sharing their email with one exhibitor that scanned their badge. */
export async function withdrawLeadEmailAction(
  token: string,
  leadId: string,
  _prev: SupportState,
): Promise<SupportState> {
  const h = await holderContext(token);
  if (!h) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(withdrawLeadEmailCommand, { linkId: h.id, leadId }, h.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/my-tickets/${token}`);
  return success();
}

/** M5.6b: whether exhibitors who scan the holder's badge from now on receive their email. */
export async function setLeadSharingAction(
  token: string,
  share: boolean,
  _prev: SupportState,
): Promise<SupportState> {
  const h = await holderContext(token);
  if (!h) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(setExhibitorEmailSharingCommand, { linkId: h.id, share }, h.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/my-tickets/${token}`);
  return success();
}
