'use server';

import {
  FRAUD_NOTE_MAX,
  FRAUD_NOTE_MIN_DISMISS,
  resolveFraudSignalCommand,
  setDetectionSettingsCommand,
} from '@yayatoh/checkin';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type SignalActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly status: 'acknowledged' | 'dismissed' }
  | {
      readonly kind: 'error';
      readonly code: string;
      /** `note`: a dismissal without a reason (kept, so the person can fix it). */
      readonly field?: 'note';
      readonly note: string;
    };

/**
 * Acknowledge (someone is on it) or dismiss (not a problem, with a reason) one of the event's
 * signals: the fraud list and the order timeline share it (M1.9e). Audited by the command, which
 * also refuses members without `events:write` (viewers see no buttons, and are refused here too).
 */
export async function resolveSignalAction(
  org: string,
  event: string,
  signalId: string,
  _prev: SignalActionState,
  form: FormData,
): Promise<SignalActionState> {
  const { data, event: ev } = await loadEvent(org, event);
  const status = form.get('status') === 'dismissed' ? 'dismissed' : 'acknowledged';
  const note = String(form.get('note') ?? '').trim();
  if (status === 'dismissed' && note.length < FRAUD_NOTE_MIN_DISMISS)
    return { kind: 'error', code: 'validation_failed', field: 'note', note };
  try {
    await executeCommand(
      resolveFraudSignalCommand,
      { eventId: ev.id, signalId, status, ...(note ? { note: note.slice(0, FRAUD_NOTE_MAX) } : {}) },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    return { kind: 'done', status };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal', note };
  }
}

export type DetectionFormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly seq: number }
  | { readonly kind: 'error'; readonly code: string; readonly field: string | null; readonly seq: number };

const whole = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
};

export async function saveDetectionAction(
  org: string,
  event: string,
  prev: DetectionFormState,
  form: FormData,
): Promise<DetectionFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const seq = (prev.kind === 'idle' ? 0 : prev.seq) + 1;
  const maxScansPerMinute = whole(form.get('maxScansPerMinute'));
  const maxTravelKmh = whole(form.get('maxTravelKmh'));
  if (!(maxScansPerMinute >= 2 && maxScansPerMinute <= 600))
    return { kind: 'error', code: 'validation_failed', field: 'maxScansPerMinute', seq };
  if (!(maxTravelKmh >= 1 && maxTravelKmh <= 200))
    return { kind: 'error', code: 'validation_failed', field: 'maxTravelKmh', seq };
  try {
    await executeCommand(
      setDetectionSettingsCommand,
      { eventId: ev.id, maxScansPerMinute, maxTravelKmh },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/onsite`, 'layout');
    return { kind: 'saved', seq };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal', field: null, seq };
  }
}
