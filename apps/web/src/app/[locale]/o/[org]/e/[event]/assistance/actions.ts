'use server';

import { addNoteCommand, assignCommand, updateCommand } from '@yayatoh/assistance';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type AssistanceActionState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'done';
      readonly op: 'take' | 'assign' | 'start' | 'resolve' | 'cancel' | 'note';
      readonly seq: number;
    }
  | { readonly kind: 'error'; readonly code: string; readonly field?: string };

const OPS = ['take', 'assign', 'start', 'resolve', 'cancel', 'note'] as const;
type Op = (typeof OPS)[number];

/**
 * Work one help request from the console (M3.3b): take it, give it to a staff member, start,
 * resolve or cancel it, or add a note. The commands refuse viewers (`assistance:manage`); the
 * page shows them no controls either.
 */
export async function assistanceAction(
  org: string,
  event: string,
  requestId: string,
  _prev: AssistanceActionState,
  form: FormData,
): Promise<AssistanceActionState> {
  const { data, event: ev } = await loadEvent(org, event, 'assistance');
  const op = String(form.get('op') ?? '') as Op;
  if (!OPS.includes(op)) return { kind: 'error', code: 'validation_failed' };
  const ref = { eventId: ev.id, requestId };
  try {
    if (op === 'take') await executeCommand(assignCommand, { ...ref, assignee: 'me' }, data.ctx, ports);
    else if (op === 'assign') {
      const assignee = String(form.get('assignee') ?? '');
      if (!assignee) return { kind: 'error', code: 'validation_failed', field: 'assignee' };
      await executeCommand(assignCommand, { ...ref, assignee }, data.ctx, ports);
    } else if (op === 'note') {
      const body = String(form.get('body') ?? '').trim();
      if (!body) return { kind: 'error', code: 'validation_failed', field: 'body' };
      await executeCommand(addNoteCommand, { ...ref, body }, data.ctx, ports);
    } else await executeCommand(updateCommand, { ...ref, action: op }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = (err.details as { field?: string } | undefined)?.field;
    return { kind: 'error', code: err.code, ...(field ? { field } : {}) };
  }
  revalidatePath(`/o/${org}/e/${event}/assistance`);
  return { kind: 'done', op, seq: Date.now() };
}
