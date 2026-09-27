'use server';

import {
  createCheckpointCommand,
  enrollDeviceCommand,
  type ScanOutcomeDto,
  scanTicketCommand,
  setCheckpointArchivedCommand,
  setDeviceStateCommand,
  undoAdmissionCommand,
} from '@yayatoh/checkin';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type ScanState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'outcome'; readonly outcome: ScanOutcomeDto; readonly seq: number }
  | { readonly kind: 'error'; readonly code: string; readonly seq: number };

export async function scanAction(
  org: string,
  event: string,
  prev: ScanState,
  form: FormData,
): Promise<ScanState> {
  const { data, event: ev } = await loadEvent(org, event);
  const seq = (prev.kind === 'idle' ? 0 : prev.seq) + 1;
  try {
    const outcome = await executeCommand(
      scanTicketCommand,
      {
        eventId: ev.id,
        code: String(form.get('code') ?? ''),
        // One id per submitted scan, so a double-submitted form is not reported as a duplicate.
        clientScanId: String(form.get('scanId') ?? '') || undefined,
        checkpointId: String(form.get('checkpointId') ?? '') || undefined,
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/onsite`);
    return { kind: 'outcome', outcome, seq };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal', seq };
  }
}

export async function undoAction(org: string, event: string, admissionId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(undoAdmissionCommand, { eventId: ev.id, admissionId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/onsite`);
}

export type EnrollState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'enrolled'; readonly label: string; readonly token: string }
  | { readonly kind: 'error'; readonly code: string };

/** The token is shown once, here; only its hash is stored. */
export async function enrollDeviceAction(
  org: string,
  event: string,
  _prev: EnrollState,
  form: FormData,
): Promise<EnrollState> {
  const { data } = await loadEvent(org, event);
  const label = String(form.get('label') ?? '').trim();
  try {
    const r = await executeCommand(enrollDeviceCommand, { label }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/onsite`);
    return { kind: 'enrolled', label, token: r.token };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function deviceStateAction(
  org: string,
  event: string,
  deviceId: string,
  action: 'revoke' | 'wipe',
): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(setDeviceStateCommand, { deviceId, action }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/onsite`);
}

export type CheckpointFormState = { readonly ok: boolean; readonly code: string | null };

export async function createCheckpointAction(
  org: string,
  event: string,
  _prev: CheckpointFormState,
  form: FormData,
): Promise<CheckpointFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createCheckpointCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        kind: form.get('kind') === 'zone' ? 'zone' : 'entrance',
        ticketTypeIds: form.get('kind') === 'zone' ? form.getAll('ticketTypeIds').map(String) : [],
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/onsite`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function checkpointArchivedAction(
  org: string,
  event: string,
  checkpointId: string,
  archived: boolean,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(
    setCheckpointArchivedCommand,
    { eventId: ev.id, checkpointId, archived },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/e/${event}/onsite`);
}
