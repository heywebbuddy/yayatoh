'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { claimContext, claimTicketCommand } from '@yayatoh/ticketing';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';

export type ClaimState = { readonly code: string | null };

/** Claim the ticket; the new holder lands on their tickets page (a holder magic link). */
export async function claimAction(token: string, _prev: ClaimState, form: FormData): Promise<ClaimState> {
  const c = await claimContext(token);
  if (!c) return { code: 'not_found' };
  let holderToken: string | null;
  try {
    ({ holderToken } = await executeCommand(
      claimTicketCommand,
      { claimId: c.id, name: String(form.get('name') ?? ''), email: String(form.get('email') ?? '') },
      c.ctx,
      ports,
    ));
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  const locale = await getLocale();
  redirect({ href: holderToken ? `/my-tickets/${holderToken}` : `/claim/${token}`, locale });
  return { code: null };
}
