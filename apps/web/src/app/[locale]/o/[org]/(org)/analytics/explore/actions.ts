'use server';

import { deleteViewCommand, saveViewCommand } from '@yayatoh/analytics';
import { executeCommand } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { explorerQuery, parseExplorer } from '@/server/explorer.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const field = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === 'string' ? v : undefined;
};

/** Save the explorer's current choice as one of the member's views (M6.2b). */
export async function saveViewAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  const sp = Object.fromEntries(
    ['measure', 'dim', 'model', 'range', 'view', 'from', 'to', 'event'].map((k) => [k, field(form, k)]),
  );
  // The money check happens in the command (finance only), so parse as if allowed.
  const { choice } = parseExplorer(sp, true);
  let id: string;
  try {
    const v = await executeCommand(
      saveViewCommand,
      {
        name: field(form, 'name') ?? '',
        measure: choice.measure,
        dimension: choice.dimension,
        model: choice.model,
        granularity: choice.granularity,
        range: choice.range,
        from: choice.range === 'custom' ? (choice.from ?? null) : null,
        to: choice.range === 'custom' ? (choice.to ?? null) : null,
        eventId: choice.eventId ?? null,
      },
      data.ctx,
      ports,
    );
    id = v.id;
  } catch (err) {
    return failure(err);
  }
  redirect({
    href: `/o/${org}/analytics/explore?${explorerQuery(choice)}&done=saved&v=${id}`,
    locale: await getLocale(),
  });
  return { ok: true, code: null };
}

export async function deleteViewAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(deleteViewCommand, { viewId: field(form, 'viewId') ?? '' }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  redirect({ href: `/o/${org}/analytics/explore?done=deleted`, locale: await getLocale() });
  return { ok: true, code: null };
}
