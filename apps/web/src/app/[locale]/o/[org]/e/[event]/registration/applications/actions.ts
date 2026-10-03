'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  decideRegistrantCommand,
  registrationDecideBulk,
  removeReasonTemplateCommand,
  saveReasonTemplateCommand,
  substituteRegistrantCommand,
} from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f-]{36}$/;
const path = (org: string, event: string) => `/o/${org}/e/${event}/registration/applications`;

/** Approve or deny one registrant from the drawer, with a typed reason or a template. */
export async function decideAction(
  org: string,
  event: string,
  registrantId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const decision = form.get('decision') === 'deny' ? 'deny' : 'approve';
  const templateId = String(form.get('templateId') ?? '');
  try {
    await executeCommand(
      decideRegistrantCommand,
      {
        eventId: ev.id,
        registrantId,
        decision,
        reason: textOrNull(form, 'reason'),
        templateId: UUID.test(templateId) ? templateId : null,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

/**
 * Bulk approve or deny (one resumable operation): the selected rows, or every pending (or
 * approved) registrant matching the type filter. Runs inline for a few seconds; the worker
 * finishes bigger ones. Back to the queue with the operation's progress.
 */
export async function bulkDecideAction(org: string, event: string, form: FormData): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const locale = await getLocale();
  const decision = form.get('decision') === 'deny' ? 'deny' : 'approve';
  const templateId = String(form.get('templateId') ?? '');
  const status = String(form.get('f_status') ?? 'pending');
  const typeId = String(form.get('f_type') ?? '');
  const keep = new URLSearchParams();
  if (status) keep.set('status', status);
  if (UUID.test(typeId)) keep.set('type', typeId);
  const ids = form
    .getAll('ids')
    .map(String)
    .filter((id) => UUID.test(id));
  const all = form.get('scope') === 'all';
  let operationId: string;
  try {
    if (!all && ids.length === 0) throw Object.assign(new Error('none'), { none: true });
    ({ operationId } = await executeCommand(
      registrationDecideBulk.start,
      {
        eventId: ev.id,
        selection: all
          ? {
              filter: {
                status: status === 'approved' ? 'approved' : 'pending',
                registrationTypeId: UUID.test(typeId) ? typeId : null,
              },
            }
          : { ids },
        params: {
          decision,
          reason: textOrNull(form, 'reason'),
          templateId: UUID.test(templateId) ? templateId : null,
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = (err as { none?: boolean }).none ? 'nothing_selected' : failure(err).code;
    keep.set('bulkError', code ?? 'internal');
    return redirect({ href: `${path(org, event)}?${keep}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  keep.set('op', operationId);
  return redirect({ href: `${path(org, event)}?${keep}`, locale });
}

export async function saveTemplateAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  try {
    await executeCommand(
      saveReasonTemplateCommand,
      {
        eventId: ev.id,
        decision: form.get('decision') === 'approve' ? 'approve' : 'deny',
        label: String(form.get('label') ?? ''),
        body: String(form.get('body') ?? ''),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

export async function removeTemplateAction(
  org: string,
  event: string,
  templateId: string,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  try {
    await executeCommand(removeReasonTemplateCommand, { eventId: ev.id, templateId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

/** The organizer replaces a confirmed registrant (their ticket moves to the new person). */
export async function substituteAction(
  org: string,
  event: string,
  registrantId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const fields = [...(name ? [] : ['name']), ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [] : ['email'])];
  if (fields.length) return { ok: false, code: 'validation_failed', fields };
  try {
    await executeCommand(
      substituteRegistrantCommand,
      { eventId: ev.id, registrantId, name, email },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}
