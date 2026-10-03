import { executeQuery } from '@yayatoh/kernel';
import { type SpeakerChangeDto, speakerChangesQuery } from '@yayatoh/program';
import { Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DecideForm } from '@/components/portal-admin-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment } from '@/lib/portal-format.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { decideChangeAction } from '../portal-actions.ts';

const show = (v: unknown, empty: string): string => {
  if (v === null || v === undefined || v === '') return empty;
  if (Array.isArray(v))
    return v.length
      ? v.map((l) => `${(l as { label: string }).label} | ${(l as { url: string }).url}`).join('\n')
      : empty;
  return String(v);
};

/**
 * Proposed speaker changes (M5.3a): each pending proposal as a diff (current → proposed, and a
 * new photo) with approve and reject; recent decisions below. Viewers read, never decide.
 */
export default async function SpeakerChangesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('speakerChanges');
  const tf = await getTranslations('speakerChanges.fields');
  const { pending, decided } = await executeQuery(speakerChangesQuery, { eventId: ev.id }, data.ctx, ports);
  const target = (c: SpeakerChangeDto) =>
    c.sessionId
      ? t('sessionChange', { name: c.speakerName, title: c.sessionTitle ?? '' })
      : t('profileChange', { name: c.speakerName });
  const diff = (c: SpeakerChangeDto) => (
    <dl className="flex flex-col gap-3">
      {c.changes.map((x) => (
        <div key={x.field} className="flex flex-col gap-1">
          <dt className="text-caption font-medium text-zinc-700">{tf(x.field)}</dt>
          <dd className="grid gap-2 md:grid-cols-2">
            <div className="rounded-card border border-zinc-200 bg-zinc-50 p-2">
              <p className="text-label uppercase text-zinc-500">{t('before')}</p>
              <p className="whitespace-pre-line break-words text-body">{show(x.before, t('empty'))}</p>
            </div>
            <div className="rounded-card border border-zinc-300 bg-white p-2">
              <p className="text-label uppercase text-zinc-500">{t('after')}</p>
              <p className="whitespace-pre-line break-words text-body">{show(x.after, t('empty'))}</p>
            </div>
          </dd>
        </div>
      ))}
      {c.photoFileId ? (
        <div className="flex flex-col gap-1">
          <dt className="text-caption font-medium text-zinc-700">{tf('photo')}</dt>
          <dd>
            <a
              href={`/api/portal-files/${org}/${c.photoFileId}`}
              className="text-body underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              {t('viewPhoto', { name: c.speakerName })}
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/e/${event}/speakers`} className="text-caption underline underline-offset-2">
            {t('back')}
          </Link>
        }
        title={t('title')}
        description={t('subtitle')}
      />
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}
      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <h2 id="pending-heading" className="text-section">
          {t('pendingHeading', { count: pending.length })}
        </h2>
        {pending.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {pending.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3">
                  <h3 className="text-body font-medium">{target(c)}</h3>
                  <p className="text-caption text-zinc-600">
                    {t('sentAt', { date: formatMoment(c.createdAt, locale, ev.timezone) })}
                  </p>
                  {diff(c)}
                  {c.stale.length ? (
                    <p className="text-caption text-pink-700">
                      {t('stale', { fields: c.stale.map((f) => tf(f)).join(', ') })}
                    </p>
                  ) : null}
                  {canWrite ? (
                    <DecideForm
                      action={decideChangeAction.bind(null, org, event, c.id)}
                      approveLabel={t('approve')}
                      rejectLabel={t('reject')}
                      noteLabel={t('note')}
                      successLabel={t('decided')}
                      errors={{ stale: t('staleError'), already_decided: t('alreadyDecided') }}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="decided-heading" className="flex flex-col gap-3">
        <h2 id="decided-heading" className="text-section">
          {t('decidedHeading')}
        </h2>
        {decided.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noneDecided')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {decided.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 text-body">
                <span>{target(c)}</span>
                <StatusDot
                  status={c.status === 'approved' ? 'success' : 'neutral'}
                  label={c.status === 'approved' ? t('approved') : t('rejected')}
                />
                {c.decidedAt ? (
                  <span className="text-caption text-zinc-600">
                    {formatMoment(c.decidedAt, locale, ev.timezone)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
