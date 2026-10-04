'use server';

import { createEventCommand } from '@yayatoh/events';
import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import {
  copyStarterCommand,
  createEventTemplateCommand,
  createFromTemplateCommand,
  deleteTemplateCommand,
  duplicateTemplateCommand,
  isStarterKey,
  setTemplateArchivedCommand,
  starterEventInput,
} from '@yayatoh/templates';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { CopyFormState } from '@/app/[locale]/o/[org]/e/[event]/copy/actions.ts';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** A new draft event from a template (a name and a start in the template's timezone). */
export async function createFromTemplateAction(
  org: string,
  templateId: string,
  timezone: string,
  _prev: CopyFormState,
  form: FormData,
): Promise<CopyFormState> {
  const data = await loadConsole(org);
  const startsAt = String(form.get('startsAt') ?? '').trim();
  if (!startsAt) return { ok: false, code: 'validation_failed', field: 'startsAt' };
  let slug: string;
  try {
    const e = await executeCommand(
      createFromTemplateCommand,
      {
        templateId,
        name: String(form.get('name') ?? '').trim(),
        startsAt: zonedTimeToUtc(startsAt, timezone),
      },
      data.ctx,
      ports,
    );
    slug = e.slug;
  } catch (err) {
    if (isDomainError(err)) {
      const issue = Array.isArray(err.details?.issues)
        ? (err.details.issues[0] as { path?: string } | undefined)
        : undefined;
      const field = typeof err.details?.field === 'string' ? err.details.field : issue?.path;
      return field ? { ok: false, code: err.code, field } : { ok: false, code: err.code };
    }
    if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message))
      return { ok: false, code: 'validation_failed', field: 'startsAt' };
    throw err;
  }
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/e/${slug}`, locale: await getLocale() });
}

export async function deleteTemplateAction(org: string, templateId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteTemplateCommand, { templateId }, data.ctx, ports);
  revalidatePath(`/o/${org}/templates`);
}

/**
 * M4.2a: a new draft event from a starter template (Wedding, Gala): the profile presets the
 * modules, navigation and onboarding checklist. A name and a start in the org's timezone.
 */
export async function createFromStarterAction(
  org: string,
  starter: string,
  _prev: CopyFormState,
  form: FormData,
): Promise<CopyFormState> {
  const data = await loadConsole(org);
  if (!isStarterKey(starter)) return { ok: false, code: 'not_found' };
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) return { ok: false, code: 'validation_failed', field: 'name' };
  const startsAt = String(form.get('startsAt') ?? '').trim();
  if (!startsAt) return { ok: false, code: 'validation_failed', field: 'startsAt' };
  let slug: string;
  try {
    const e = await executeCommand(
      createEventCommand,
      starterEventInput(starter, {
        name,
        startsAt: zonedTimeToUtc(startsAt, data.org.timezone),
        timezone: data.org.timezone,
        currency: data.org.currency,
      }),
      data.ctx,
      ports,
    );
    slug = e.slug;
  } catch (err) {
    if (isDomainError(err)) {
      const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
      return field ? { ok: false, code: err.code, field } : { ok: false, code: err.code };
    }
    if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message))
      return { ok: false, code: 'validation_failed', field: 'startsAt' };
    throw err;
  }
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/e/${slug}/setup-guide`, locale: await getLocale() });
}

/** Try `name`, then "name 2", "name 3"…, while the org already has a template by that name. */
async function withFreeName<T>(name: string, create: (name: string) => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await create(n === 1 ? name : `${name.slice(0, 115)} ${n}`);
    } catch (err) {
      if (n >= 20 || !isDomainError(err) || err.code !== 'conflict') throw err;
    }
  }
}

const editPage = async (org: string, id: string, flag?: string) =>
  redirect({ href: `/o/${org}/templates/${id}${flag ? `?${flag}=1` : ''}`, locale: await getLocale() });

/** U6: a new template from scratch (profile and settings); its contents follow on the next page. */
export async function createTemplateAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const hours = Number(String(form.get('hours') ?? '').trim() || '0');
  const minutes = Number(String(form.get('minutes') ?? '').trim() || '0');
  let id: string;
  try {
    const t = await executeCommand(
      createEventTemplateCommand,
      {
        name: String(form.get('name') ?? ''),
        description: textOrNull(form, 'description'),
        profile: String(form.get('profile') ?? ''),
        timezone: String(form.get('timezone') ?? ''),
        currency: String(form.get('currency') ?? ''),
        durationMinutes: hours * 60 + minutes,
      },
      data.ctx,
      ports,
    );
    id = t.id;
  } catch (err) {
    const f = failure(err);
    // Hours and minutes are one value on the server.
    return f.fields?.includes('durationMinutes') ? { ...f, fields: [...f.fields, 'duration'] } : f;
  }
  revalidatePath(`/o/${org}/templates`);
  return editPage(org, id, 'created');
}

/** U6: copy a read-only starter into "Your templates" and open it. */
export async function copyStarterAction(org: string, starter: string): Promise<void> {
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!isStarterKey(starter)) return;
  const copy = await withFreeName(t(`starters.${starter}.name`), (name) =>
    executeCommand(
      copyStarterCommand,
      { starter, name, timezone: data.org.timezone, currency: data.org.currency },
      data.ctx,
      ports,
    ),
  );
  revalidatePath(`/o/${org}/templates`);
  return editPage(org, copy.id, 'copied');
}

/** U6: a copy of a template ("Name (copy)") opened for editing. */
export async function duplicateTemplateAction(org: string, templateId: string, name: string): Promise<void> {
  const data = await loadConsole(org);
  const t = await getTranslations();
  const copy = await withFreeName(t('copy.copyName', { name }).slice(0, 120), (n) =>
    executeCommand(duplicateTemplateCommand, { templateId, name: n }, data.ctx, ports),
  );
  revalidatePath(`/o/${org}/templates`);
  return editPage(org, copy.id, 'duplicated');
}

/** U6: archive (out of every picker) or restore a template. */
export async function setTemplateArchivedAction(
  org: string,
  templateId: string,
  archived: boolean,
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(setTemplateArchivedCommand, { templateId, archived }, data.ctx, ports);
  revalidatePath(`/o/${org}/templates`);
  revalidatePath(`/o/${org}/templates/${templateId}`);
}
