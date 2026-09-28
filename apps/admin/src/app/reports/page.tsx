import { Alert, Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { messagingReports } from '@/server/messaging-reports.ts';
import { requireStaff } from '@/server/staff.ts';
import { reviewReportAction } from './actions.ts';

/**
 * Messaging reports (M1.10d): conversations organizers or their contacts reported to Yayatoh.
 * Open ones first; each shows the reporter's side, reason and note and an allowlisted excerpt of
 * the conversation, with resolve / dismiss and a note for the record (audited in the org).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string; error?: string; report?: string }>;
}) {
  const staff = await requireStaff('reports');
  const sp = await searchParams;
  const status = sp.status === 'closed' ? 'closed' : 'open';
  const t = await getTranslations('reports');
  const rows = await messagingReports(staff, status);
  const noteError = (id: string) =>
    sp.report === id && (sp.error === 'note_required' || sp.error === 'note_too_long');
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const tab = (s: 'open' | 'closed') => (
    <Link
      href={s === 'open' ? '/reports' : '/reports?status=closed'}
      aria-current={status === s ? 'page' : undefined}
      className="inline-flex min-h-10 items-center rounded-pill border border-zinc-200 px-4 text-body aria-[current=page]:border-ink aria-[current=page]:font-medium"
    >
      {t(`tabs.${s}`)}
    </Link>
  );
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('tabsLabel')} className="flex gap-2">
        {tab('open')}
        {tab('closed')}
      </nav>
      <div aria-live="polite">
        {sp.done === 'resolved' || sp.done === 'dismissed' ? (
          <Alert tone="info" title={t(`done.${sp.done}`)} />
        ) : null}
        {sp.error ? (
          <Alert
            title={
              ['note_required', 'note_too_long', 'already_reviewed', 'not_found'].includes(sp.error)
                ? t(`errors.${sp.error}`)
                : t('errors.other', { code: sp.error })
            }
          />
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t(`empty.${status}`)} description={t('emptyDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3">
                <article aria-labelledby={`report-${r.id}`} className="flex flex-col gap-3">
                  <h2 id={`report-${r.id}`} className="text-section">
                    {t('heading', { org: r.orgName, reason: t(`reasons.${r.reason}`) })}
                  </h2>
                  <p className="text-caption text-zinc-600">
                    {t('meta', { reporter: t(`reporter.${r.reporter}`), at: when.format(r.createdAt) })}{' '}
                    <Link href={`/tenants/${r.orgId}`} className="underline">
                      {t('tenantLink', { slug: r.orgSlug })}
                    </Link>
                  </p>
                  {r.note ? (
                    <p className="text-body">
                      <span className="text-zinc-600">{t('note')}</span> {r.note}
                    </p>
                  ) : null}
                  <section aria-label={t('excerpt')} className="flex flex-col gap-2">
                    <h3 className="text-caption text-zinc-600">{t('excerpt')}</h3>
                    {r.excerpt.length === 0 ? (
                      <p className="text-caption text-zinc-500">{t('noMessages')}</p>
                    ) : (
                      <ol className="flex list-none flex-col gap-2 p-0">
                        {r.excerpt.map((m) => (
                          <li
                            key={`${m.at.toISOString()}-${m.from}`}
                            className="rounded-card border border-zinc-100 bg-zinc-50 px-3 py-2"
                          >
                            <p className="text-caption text-zinc-600">
                              {t(`from.${m.from}`)} · {when.format(m.at)}
                              {m.announcement ? ` · ${t('announcement')}` : ''}
                            </p>
                            <p className="text-body whitespace-pre-wrap">{m.text}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                  {r.status === 'open' ? (
                    <form
                      action={reviewReportAction.bind(null, r.orgId, r.id)}
                      className="flex flex-col gap-2"
                      aria-label={t('reviewLabel')}
                    >
                      <label htmlFor={`note-${r.id}`} className="text-caption text-zinc-600">
                        {t('reviewNote')}
                      </label>
                      <textarea
                        id={`note-${r.id}`}
                        name="note"
                        rows={2}
                        maxLength={1000}
                        aria-invalid={noteError(r.id) ? true : undefined}
                        aria-describedby={noteError(r.id) ? `note-${r.id}-error` : undefined}
                        className="rounded-card border border-zinc-200 bg-white px-3 py-2 text-body"
                      />
                      {noteError(r.id) ? (
                        <p id={`note-${r.id}-error`} className="text-caption text-pink-700">
                          {t(`errors.${sp.error}`)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" name="decision" value="resolved">
                          {t('resolve')}
                        </Button>
                        <Button type="submit" name="decision" value="dismissed" variant="secondary">
                          {t('dismiss')}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-body">
                      <span className="font-medium">{t(`status.${r.status}`)}</span>
                      {r.reviewedAt ? ` · ${when.format(r.reviewedAt)}` : ''}
                      {r.reviewNote ? ` · ${r.reviewNote}` : ''}
                    </p>
                  )}
                </article>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
