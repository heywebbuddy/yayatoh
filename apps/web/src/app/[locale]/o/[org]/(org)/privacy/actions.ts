'use server';

import { withTenant } from '@yayatoh/db';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { catchUpErasedMedia } from '@yayatoh/media';
import {
  cancelRequestCommand,
  DsarEmail,
  type DsarSummary,
  eraseSubjectCommand,
  exportSubjectCommand,
  findSubjectQuery,
  openRequestCommand,
  selfRequestAddressTx,
} from '@yayatoh/privacy';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { notifySelfRequester } from '@/server/privacy-request.ts';

export type FindState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | {
      readonly kind: 'found';
      readonly email: string;
      readonly found: boolean;
      readonly summary: DsarSummary;
      readonly openRequestId: string | null;
    };

export type OpenState = { readonly kind: 'idle' } | { readonly kind: 'error'; readonly code: string };

export type ExportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'done' };

export type EraseState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'done' };

export type CancelState = { readonly kind: 'idle' } | { readonly kind: 'error'; readonly code: string };

const code = (err: unknown) => {
  if (isDomainError(err)) return err.details?.field === 'confirm' ? 'confirm_mismatch' : err.code;
  throw err;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Find a person by email (M1.14c, M6.1c). The email is posted, never put in a URL. */
export async function findPersonAction(org: string, _prev: FindState, form: FormData): Promise<FindState> {
  const data = await loadConsole(org);
  const email = DsarEmail.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  try {
    const r = await executeQuery(findSubjectQuery, { email: email.data }, data.ctx, ports);
    return {
      kind: 'found',
      email: r.email,
      found: r.found,
      summary: r.summary,
      openRequestId: r.openRequestId,
    };
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
}

/** Open a request on the person's behalf, then go to it. */
export async function openRequestAction(org: string, _prev: OpenState, form: FormData): Promise<OpenState> {
  const data = await loadConsole(org);
  const email = DsarEmail.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  const kind = form.get('kind');
  if (kind !== 'access' && kind !== 'erasure') return { kind: 'error', code: 'kind_required' };
  let requestId: string;
  try {
    ({ requestId } = await executeCommand(openRequestCommand, { email: email.data, kind }, data.ctx, ports));
  } catch (err) {
    if (isDomainError(err) && err.code === 'conflict' && typeof err.details?.requestId === 'string')
      requestId = err.details.requestId;
    else return { kind: 'error', code: code(err) };
  }
  revalidatePath(`/o/${org}/privacy`);
  return redirect({ href: `/o/${org}/privacy/requests/${requestId}?opened=1`, locale: data.ctx.locale });
}

/** The address of a self-service request, to tell the person once it is done. */
async function selfAddress(data: Awaited<ReturnType<typeof loadConsole>>, requestId: string) {
  return withTenant(data.ctx, (tx) => selfRequestAddressTx(tx, data.ctx, requestId));
}

/** Fulfil an access request: the signed archive (step-up). */
export async function exportRequestAction(
  org: string,
  requestId: string,
  _prev: ExportState,
  _form: FormData,
): Promise<ExportState> {
  const data = await loadConsole(org);
  if (!UUID.test(requestId)) return { kind: 'error', code: 'not_found' };
  try {
    const to = await selfAddress(data, requestId);
    const r = await executeCommand(exportSubjectCommand, { requestId }, data.ctx, ports);
    if (to)
      await notifySelfRequester({
        kind: 'archive',
        to,
        orgId: data.org.id,
        orgSlug: org,
        requestId,
        until: r.archiveUntil,
      });
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
  revalidatePath(`/o/${org}/privacy`);
  revalidatePath(`/o/${org}/privacy/requests/${requestId}`);
  return { kind: 'done' };
}

/** Fulfil an erasure request: the address typed again, step-up, then the signed receipt. */
export async function eraseRequestAction(
  org: string,
  requestId: string,
  _prev: EraseState,
  form: FormData,
): Promise<EraseState> {
  const data = await loadConsole(org);
  if (!UUID.test(requestId)) return { kind: 'error', code: 'not_found' };
  try {
    const to = await selfAddress(data, requestId);
    await executeCommand(
      eraseSubjectCommand,
      { requestId, confirm: String(form.get('confirm') ?? '') },
      data.ctx,
      ports,
    );
    // Stored files go right away here (the worker's subscriber does the same from the outbox).
    await catchUpErasedMedia(data.org.id);
    if (to) await notifySelfRequester({ kind: 'receipt', to, orgId: data.org.id, orgSlug: org, requestId });
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
  revalidatePath(`/o/${org}/privacy`);
  revalidatePath(`/o/${org}/privacy/requests/${requestId}`);
  return { kind: 'done' };
}

/** Withdraw an open request, with a reason. */
export async function cancelRequestAction(
  org: string,
  requestId: string,
  _prev: CancelState,
  form: FormData,
): Promise<CancelState> {
  const data = await loadConsole(org);
  if (!UUID.test(requestId)) return { kind: 'error', code: 'not_found' };
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 3) return { kind: 'error', code: 'reason_required' };
  try {
    await executeCommand(cancelRequestCommand, { requestId, reason }, data.ctx, ports);
  } catch (err) {
    return { kind: 'error', code: code(err) };
  }
  revalidatePath(`/o/${org}/privacy`);
  return redirect({ href: `/o/${org}/privacy/requests/${requestId}?cancelled=1`, locale: data.ctx.locale });
}
