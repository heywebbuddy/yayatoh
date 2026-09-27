'use server';

import { getUsersByIds } from '@yayatoh/auth';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { AUDIT_EXPORT_COLUMNS, auditExportBulk, auditLogQuery } from '@yayatoh/platform';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resolveActivityFilter } from './filters.ts';

/** Export what the Activity filters match as CSV (M1.14b), through the bulk framework. */
export async function exportActivityAction(org: string, form: FormData): Promise<void> {
  const locale = await getLocale();
  const data = await loadConsole(org);
  const sp = {
    actor: String(form.get('actor') ?? ''),
    action: String(form.get('action') ?? ''),
    from: String(form.get('from') ?? ''),
    to: String(form.get('to') ?? ''),
  };
  const { filter, values } = resolveActivityFilter(sp, data.org.timezone);
  const qs = new URLSearchParams(Object.entries(values).filter(([, v]) => v));
  const back = `/o/${org}/activity${qs.size ? `?${qs}&` : '?'}`;
  const t = await getTranslations();
  let operationId: string;
  try {
    // Display names for the people in this org's log (the file is read outside the app).
    const { actors } = await executeQuery(auditLogQuery, { limit: 1 }, data.ctx, ports);
    const userIds = actors.filter((a) => a.startsWith('user:')).map((a) => a.slice(5));
    const people = await getUsersByIds(userIds);
    const actorNames = Object.fromEntries(
      userIds.flatMap((id) => {
        const p = people.get(id);
        return p ? [[`user:${id}`, p.name.slice(0, 200)]] : [];
      }),
    );
    ({ operationId } = await executeCommand(
      auditExportBulk.start,
      {
        selection: { filter },
        params: {
          headers: Object.fromEntries(AUDIT_EXPORT_COLUMNS.map((c) => [c, t(`activity.columns.${c}`)])),
          timeZone: data.org.timezone,
          actorNames,
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return redirect({ href: `${back}exportError=${isDomainError(err) ? err.code : 'internal'}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${back}op=${operationId}`, locale });
}
