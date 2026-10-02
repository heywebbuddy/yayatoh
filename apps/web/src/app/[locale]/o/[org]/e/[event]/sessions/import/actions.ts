'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { type AgendaImportResultDto, agendaImportPreviewQuery, importAgendaCommand } from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What the agenda import form shows: the dry run or the applied result, or why the file failed. */
export interface AgendaImportState {
  readonly ok: boolean;
  /** A file-level problem (`agenda.import.fileError.*`) or a DomainError code. */
  readonly error: string | null;
  readonly result?: AgendaImportResultDto;
  /** The checked file's text, posted back by "Import" (the file input clears after a check). */
  readonly csv?: string;
  readonly fileName?: string;
  readonly stamp?: number;
}

const MAX_BYTES = 1_000_000;

function fail(err: unknown): AgendaImportState {
  if (!isDomainError(err)) throw err;
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return {
    ok: false,
    error: typeof reason === 'string' && err.code === 'validation_failed' ? reason : err.code,
    stamp: Date.now(),
  };
}

/** Step 1: dry run. Reads the uploaded file and reports each row; writes nothing. */
export async function checkAgendaImportAction(
  org: string,
  event: string,
  _prev: AgendaImportState,
  form: FormData,
): Promise<AgendaImportState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file', stamp: Date.now() };
  if (file.size > MAX_BYTES) return { ok: false, error: 'too_large', stamp: Date.now() };
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  const csv = await file.text();
  try {
    const result = await executeQuery(agendaImportPreviewQuery, { eventId: ev.id, csv }, data.ctx, ports);
    return { ok: true, error: null, result, csv, fileName: file.name.slice(0, 200), stamp: Date.now() };
  } catch (err) {
    return fail(err);
  }
}

/** Step 2: apply the checked file (the same text). Idempotent: the same file again changes nothing. */
export async function applyAgendaImportAction(
  org: string,
  event: string,
  prev: AgendaImportState,
  form: FormData,
): Promise<AgendaImportState> {
  const csv = String(form.get('csv') ?? '');
  if (!csv) return { ok: false, error: 'no_file', stamp: Date.now() };
  if (csv.length > MAX_BYTES) return { ok: false, error: 'too_large', stamp: Date.now() };
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  try {
    const result = await executeCommand(importAgendaCommand, { eventId: ev.id, csv }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/sessions`);
    return { ok: true, error: null, result, csv, fileName: prev.fileName, stamp: Date.now() };
  } catch (err) {
    return fail(err);
  }
}
