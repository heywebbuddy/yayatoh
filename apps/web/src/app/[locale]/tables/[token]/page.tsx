import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { publicTableQuery, tableLinkContext } from '@yayatoh/orders';
import { Alert, Card, EmptyState, Label, PageHeader, StatusDot } from '@yayatoh/ui';
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
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{t('public.eyebrow')}</Label>}
        title={t('public.title')}
        description={`${table.eventName} · ${when}`}
      />
      <Card size="panel" className="flex flex-col gap-3">
        <p className="text-body font-medium">
          {t('public.tableOf', { table: table.typeName, n: table.unitNo })}
        </p>
        <p className="text-body" data-progress>
          {t('progress', {
            named: formatNumber(table.named, locale),
            size: formatNumber(table.named + table.missing, locale),
          })}
        </p>
        {full ? (
          <StatusDot status="success" label={t('public.full')} />
        ) : (
          <StatusDot status="warning" label={t('missing', { count: table.missing })} />
        )}
      </Card>

      {table.closed ? (
        <Alert title={t(`public.closed.${table.closed}`)} />
      ) : (
        <>
          <section aria-labelledby="company-heading" className="flex flex-col gap-3">
            <h2 id="company-heading" className="text-section">
              {t('public.companyTitle')}
            </h2>
            <Card size="panel">
              <CompanyForm action={companyAction.bind(null, token)} current={table.company} />
            </Card>
          </section>
          {full ? null : (
            <section aria-labelledby="name-heading" className="flex flex-col gap-3">
              <h2 id="name-heading" className="text-section">
                {t('public.nameTitle')}
              </h2>
              <p className="text-body text-zinc-600">{t('public.nameIntro')}</p>
              <Card size="panel">
                <NameGuestForm
                  action={nameGuestAction.bind(null, token)}
                  idPrefix="guest"
                  large
                  submitLabel={t('public.submit')}
                />
              </Card>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="seats-heading" className="flex flex-col gap-3">
        <h2 id="seats-heading" className="text-section">
          {t('public.seatsTitle')}
        </h2>
        {table.slots.length === 0 ? (
          <EmptyState title={t('public.noSeats')} description={t('public.noSeatsHint')} />
        ) : (
          <ol className="flex list-none flex-col gap-2 p-0">
            {table.slots.map((s, i) => (
              <li
                key={s.ticketId}
                className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white px-4 py-2"
              >
                <span className="text-caption text-zinc-500">{t('seat', { n: i + 1 })}</span>
                <span className={s.guestName ? 'text-body' : 'text-body text-zinc-500'}>
                  {s.guestName ?? t('unnamed')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {table.closed ? null : (
        <section aria-labelledby="resend-heading" className="flex flex-col gap-2">
          <h2 id="resend-heading" className="text-section">
            {t('public.resendTitle')}
          </h2>
          <p className="text-body text-zinc-600">{t('public.resendIntro')}</p>
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
