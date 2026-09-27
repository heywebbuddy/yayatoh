'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  DsarEmail,
  type DsarSummary,
  dsarExportBulk,
  eraseSubjectCommand,
  findSubjectQuery,
} from '@yayatoh/privacy';
import { revalidatePath } from 'next/cache';
import { runBulkInline } from '@/server/bulk.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type FindState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | {
      readonly kind: 'found';
      readonly email: string;
      readonly found: boolean;
      readonly summary: DsarSummary;
    };

export type ExportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'started'; readonly operationId: string; readonly done: boolean };

export type EraseState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'erased'; readonly summary: Record<string, number> };

const code = (err: unknown) => {
  if (isDomainError(err)) return err.details?.field === 'confirm' ? 'confirm_mismatch' : err.code;
  throw err;
};

/** Find a person by email (M1.14c). The email is posted, never put in a URL. */
export async function findPersonAction(org: string, _prev: FindState, form: FormData): Promise<FindState> {
  const data = await loadConsole(org);
  const email = DsarEmail.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  try {
    const r = await executeQuery(findSubjectQuery, { email: email.data }, data.ctx, ports);
    return { kind: 'found', email: r.email, found: r.found, summary: r.summary };
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
}

/** Access request: the person's data as JSON through the bulk framework. */
export async function exportPersonAction(
  org: string,
  _prev: ExportState,
  form: FormData,
): Promise<ExportState> {
  const data = await loadConsole(org);
  const email = DsarEmail.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  try {
    const { operationId } = await executeCommand(
      dsarExportBulk.start,
      { selection: { filter: { email: email.data } }, params: { email: email.data, orgName: data.org.name } },
      data.ctx,
      ports,
    );
    const status = await runBulkInline(data.org.id, operationId);
    revalidatePath(`/o/${org}/privacy`);
    return { kind: 'started', operationId, done: status === 'done' };
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
}

/** Erasure: the email must be typed again. */
export async function erasePersonAction(org: string, _prev: EraseState, form: FormData): Promise<EraseState> {
  const data = await loadConsole(org);
  const email = DsarEmail.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  try {
    const r = await executeCommand(
      eraseSubjectCommand,
      { email: email.data, confirm: String(form.get('confirm') ?? '') },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/privacy`);
    return { kind: 'erased', summary: r.summary };
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
}
