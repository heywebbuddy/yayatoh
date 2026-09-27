'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { resubscribeCommand, unsubscribeCommand, unsubscribeRef } from '@yayatoh/notifications';
import { ports } from '@/server/ports.ts';

export type UnsubscribeState = { readonly unsubscribed: boolean; readonly code: string | null };

/** Unsubscribe (or subscribe again) from the page; the token is the only credential. */
export async function unsubscribeAction(
  token: string,
  prev: UnsubscribeState,
  form: FormData,
): Promise<UnsubscribeState> {
  const ref = await unsubscribeRef(token);
  if (!ref) return { ...prev, code: 'not_found' };
  const ctx = createCtx({ orgId: ref.orgId });
  const again = form.get('intent') === 'resubscribe';
  try {
    if (again) await executeCommand(resubscribeCommand, { token }, ctx, ports);
    else await executeCommand(unsubscribeCommand, { token, source: 'page' }, ctx, ports);
  } catch (err) {
    return { ...prev, code: isDomainError(err) ? err.code : 'internal' };
  }
  return { unsubscribed: !again, code: null };
}
