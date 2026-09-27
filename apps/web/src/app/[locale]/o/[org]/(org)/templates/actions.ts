'use server';

import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { createFromTemplateCommand, deleteTemplateCommand } from '@yayatoh/templates';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { CopyFormState } from '@/app/[locale]/o/[org]/e/[event]/copy/actions.ts';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
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
