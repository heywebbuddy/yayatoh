'use server';

import {
  assignTemplateCommand,
  type BadgeDesign,
  cancelBatchCommand,
  createTemplateCommand,
  deleteTemplateCommand,
  saveTemplateCommand,
  setDefaultTemplateCommand,
  startBatchCommand,
} from '@yayatoh/badges';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { SaveBadgeResult } from '@/components/badge-designer.tsx';
import type { ProgramFormState } from '@/components/program-form.tsx';
import type { StepUpActionResult } from '@/components/step-up.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { runBatchInline } from '@/server/badges.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const page = (org: string, event: string) => `/o/${org}/e/${event}/badges`;
const done = (org: string, event: string) => revalidatePath(page(org, event), 'layout');

export async function createTemplateAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  let id: string;
  try {
    ({ id } = await executeCommand(
      createTemplateCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        size: String(form.get('size') ?? '') as never,
        copyFromId: String(form.get('copyFromId') ?? '') || null,
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  // Straight into the designer.
  return redirect({ href: `${page(org, event)}/${id}`, locale: await getLocale() });
}

export async function saveTemplateAction(
  org: string,
  event: string,
  templateId: string,
  input: { name: string; design: BadgeDesign; baseVersion: number },
): Promise<SaveBadgeResult> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    const r = await executeCommand(
      saveTemplateCommand,
      { eventId: ev.id, templateId, name: input.name, design: input.design, baseVersion: input.baseVersion },
      data.ctx,
      ports,
    );
    done(org, event);
    return { ok: true, version: r.version };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    return { ok: false, code: err.code, ...(typeof reason === 'string' ? { reason } : {}) };
  }
}

export async function setDefaultAction(
  org: string,
  event: string,
  templateId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    await executeCommand(setDefaultTemplateCommand, { eventId: ev.id, templateId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteTemplateAction(
  org: string,
  event: string,
  templateId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    await executeCommand(deleteTemplateCommand, { eventId: ev.id, templateId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function assignAction(
  org: string,
  event: string,
  ticketTypeId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    await executeCommand(
      assignTemplateCommand,
      { eventId: ev.id, ticketTypeId, templateId: String(form.get('templateId') ?? '') || null },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/**
 * Start a batch PDF (idempotent per request key: the form carries one, so a double submit or a
 * resend after step-up returns the same batch), run it for a few seconds here, then show it.
 */
export async function startBatchAction(
  org: string,
  event: string,
  form: FormData,
): Promise<StepUpActionResult> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  let batchId: string;
  try {
    ({ id: batchId } = await executeCommand(
      startBatchCommand,
      {
        eventId: ev.id,
        requestKey: String(form.get('requestKey') ?? ''),
        sort: String(form.get('sort') ?? 'last_name') as never,
        ticketTypeIds: form.getAll('ticketTypeIds').map(String),
        locale,
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'step_up_required') return { code: err.code };
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    return redirect({
      href: `${page(org, event)}?batchError=${typeof reason === 'string' ? reason : err.code}#batch-heading`,
      locale,
    });
  }
  await runBatchInline(data.org.id, batchId);
  done(org, event);
  redirect({ href: `${page(org, event)}?batch=${batchId}#batch-heading`, locale });
}

export async function cancelBatchAction(org: string, event: string, batchId: string): Promise<void> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    await executeCommand(cancelBatchCommand, { eventId: ev.id, batchId }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return redirect({ href: `${page(org, event)}?batchError=${err.code}#batch-heading`, locale });
  }
  done(org, event);
  redirect({ href: `${page(org, event)}?batch=${batchId}#batch-heading`, locale });
}
