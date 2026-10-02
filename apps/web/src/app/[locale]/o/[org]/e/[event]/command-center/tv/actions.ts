'use server';

import { createDisplayLinkCommand, revokeDisplayLinkCommand } from '@yayatoh/command-center';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type DisplayLinkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'created'; readonly label: string; readonly token: string; readonly seq: number }
  | { readonly kind: 'error'; readonly code: string; readonly field?: 'label'; readonly seq: number };

/** Create a TV display link (M3.3a); its token is shown once, here. */
export async function createDisplayLinkAction(
  org: string,
  event: string,
  prev: DisplayLinkState,
  form: FormData,
): Promise<DisplayLinkState> {
  const seq = (prev.kind === 'idle' ? 0 : prev.seq) + 1;
  const { data, event: ev } = await loadEvent(org, event, 'commandCenter');
  const label = String(form.get('label') ?? '').trim();
  if (label.length === 0 || label.length > 60)
    return { kind: 'error', code: 'validation_failed', field: 'label', seq };
  try {
    const r = await executeCommand(createDisplayLinkCommand, { eventId: ev.id, label }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/command-center/tv`);
    return { kind: 'created', label: r.label, token: r.token, seq };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal', seq };
  }
}

/** Turn a display link off: the screen showing it stops at its next refresh. */
export async function revokeDisplayLinkAction(org: string, event: string, linkId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'commandCenter');
  await executeCommand(revokeDisplayLinkCommand, { eventId: ev.id, linkId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/command-center/tv`);
}
