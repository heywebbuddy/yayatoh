'use server';

import {
  isEventMode,
  resetWidgetLayoutCommand,
  saveWidgetLayoutCommand,
  setModeOverrideCommand,
} from '@yayatoh/command-center';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { commandCenterCtx } from '@/server/command-center.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface LayoutResult {
  readonly ok: boolean;
  readonly code: string | null;
}

const failed = (err: unknown): LayoutResult => ({
  ok: false,
  code: isDomainError(err) ? err.code : 'internal',
});

/** Save the member's own widget order and hidden widgets for this event (M3.2a). */
export async function saveLayoutAction(
  org: string,
  event: string,
  order: string[],
  hidden: string[],
): Promise<LayoutResult> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(saveWidgetLayoutCommand, { eventId: ev.id, order, hidden }, data.ctx, ports);
    return { ok: true, code: null };
  } catch (err) {
    return failed(err);
  }
}

export async function resetLayoutAction(org: string, event: string): Promise<LayoutResult> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(resetWidgetLayoutCommand, { eventId: ev.id }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/command-center`);
    return { ok: true, code: null };
  } catch (err) {
    return failed(err);
  }
}

/** Set the mode by hand, or back to automatic (`mode` = `auto`). Audited by the command. */
export async function setModeAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const raw = String(form.get('mode') ?? '');
  if (raw !== 'auto' && !isEventMode(raw)) return { ok: false, code: 'validation_failed', fields: ['mode'] };
  try {
    await executeCommand(
      setModeOverrideCommand,
      { eventId: ev.id, mode: raw === 'auto' ? null : raw },
      await commandCenterCtx(data.ctx),
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/command-center`);
    return { ok: true, code: null, stamp: Date.now() };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
