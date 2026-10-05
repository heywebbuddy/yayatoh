import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { publicTableQuery, tableLinkContext } from '@yayatoh/orders';
import { Alert, EmptyState, Label, PageHeader, ProgressBar, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionButton, CompanyForm, NameGuestForm } from '@/components/gala-tables.tsx';
import { formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { companyAction, nameGuestAction, resendAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('galaTables.public');
  // A private link: never indexed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * M4.2b: a purchased table's claim link. The buyer names their company (or sponsor) and the
 * guests at their table, one seat at a time; each named guest gets the seat's ticket. Phone
 * first: one column, large targets.
 */
export default async function TableNamingPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const c = await tableLinkContext(token);
  if (!c) notFound();
  const table = await executeQuery(publicTableQuery, { tableUnitId: c.id }, c.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations('galaTables');
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: table.eventTimezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(table.eventStartsAt);
  const full = table.missing === 0;
  const size = table.named + table.missing;
  /** The public pages' card (ADR 0022, as on the public event page). */
  const card = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass';
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{t('public.eyebrow')}</Label>}
        title={t('public.title')}
        description={`${table.eventName} · ${when}`}
      />
      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 grow text-card text-ink">
            {t('public.tableOf', { table: table.typeName, n: table.unitNo })}
          </p>
          {full ? (
            <StatusPill tone="success" label={t('public.full')} />
          ) : (
            <StatusPill tone="waiting" label={t('missing', { count: table.missing })} />
          )}
        </div>
        <p className="m-0 text-body font-semibold text-ink-2 tabular-nums" data-progress>
          {t('progress', {
            named: formatNumber(table.named, locale),
            size: formatNumber(size, locale),
          })}
        </p>
        <ProgressBar
          value={table.named}
          max={size}
          tone={full ? 'success' : 'primary'}
          label={t('progress', {
            named: formatNumber(table.named, locale),
            size: formatNumber(size, locale),
          })}
        />
      </div>

      {table.closed ? (
        <Alert title={t(`public.closed.${table.closed}`)} />
      ) : (
        <>
          <section aria-labelledby="company-heading" className={card}>
            <h2 id="company-heading" className="m-0 text-card text-ink">
              {t('public.companyTitle')}
            </h2>
            <CompanyForm action={companyAction.bind(null, token)} current={table.company} />
          </section>
          {full ? null : (
            <section aria-labelledby="name-heading" className={card}>
              <div className="flex flex-col gap-1">
                <h2 id="name-heading" className="m-0 text-card text-ink">
                  {t('public.nameTitle')}
                </h2>
                <p className="m-0 text-body text-ink-2">{t('public.nameIntro')}</p>
              </div>
              <NameGuestForm
                action={nameGuestAction.bind(null, token)}
                idPrefix="guest"
                large
                submitLabel={t('public.submit')}
              />
            </section>
          )}
        </>
      )}

      <section aria-labelledby="seats-heading" className="flex flex-col gap-3">
        <h2 id="seats-heading" className="m-0 text-section text-ink">
          {t('public.seatsTitle')}
        </h2>
        {table.slots.length === 0 ? (
          <EmptyState title={t('public.noSeats')} description={t('public.noSeatsHint')} />
        ) : (
          <ol className="m-0 flex list-none flex-col rounded-panel border border-line bg-surface px-5 py-1 elevation-card glass">
            {table.slots.map((s, i) => (
              <li
                key={s.ticketId}
                className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
              >
                <span className="text-caption font-bold text-ink-2">{t('seat', { n: i + 1 })}</span>
                <span className={s.guestName ? 'text-body font-bold text-ink' : 'text-body text-ink-2'}>
                  {s.guestName ?? t('unnamed')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {table.closed ? null : (
        <section aria-labelledby="resend-heading" className={card}>
          <div className="flex flex-col gap-1">
            <h2 id="resend-heading" className="m-0 text-card text-ink">
              {t('public.resendTitle')}
            </h2>
            <p className="m-0 text-body text-ink-2">{t('public.resendIntro')}</p>
          </div>
          <ActionButton
            action={resendAction.bind(null, token)}
            label={t('public.resend')}
            large
            done="resend"
          />
        </section>
      )}
    </main>
  );
}
