import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, buttonClass, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { viewerQuery } from '@yayatoh/virtual';
import { MonitorPlay } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { ports } from '@/server/ports.ts';

type Params = { params: Promise<{ locale: string; slug: string; ticket: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('virtual.watch');
  return { title: t('metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

/**
 * A ticket holder's watch page (M6.9a), phone first: the sessions streaming now or later that
 * their ticket includes, with their own minutes watched. The link is the ticket's signed watch
 * link (from their order page); a forged or void one is a 404. An in-person-only ticket is told
 * so and gets nothing to play.
 */
export default async function WatchPage({ params }: Params) {
  const { locale, slug, ticket } = await params;
  pageLocale(locale);
  const token = decodeURIComponent(ticket);
  const target = await checkoutTarget(slug);
  if (!target || token.length > 200) notFound();
  const page = await executeQuery(
    viewerQuery,
    { eventId: target.eventId, ticketToken: token },
    createCtx({ orgId: target.orgId }),
    ports,
  ).catch((err) => {
    if (isDomainError(err)) return null;
    throw err;
  });
  if (!page) notFound();
  const t = await getTranslations('virtual.watch');
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: page.timezone,
    timeZoneName: 'short',
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{page.eventName}</Label>}
        title={t('title')}
        description={t('greeting', { name: page.holderName })}
      />
      {page.access === 'in_person' ? (
        <Alert tone="info" title={t('inPersonOnly')}>
          {t('inPersonOnlyHint')}
        </Alert>
      ) : page.sessions.length === 0 ? (
        <EmptyState icon={<MonitorPlay />} title={t('noSessionsTitle')} description={t('noSessionsHint')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {page.sessions.map((s) => (
            <li
              key={s.sessionId}
              className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-body font-semibold text-ink">{s.title}</h2>
                <p className="m-0 text-caption text-ink-2">{when.format(s.startsAt)}</p>
                <p className="m-0 text-caption text-ink-2">{t('watched', { count: s.minutes })}</p>
              </div>
              <Link
                href={`/events/${slug}/watch/${encodeURIComponent(token)}/${s.sessionId}`}
                className={buttonClass('primary')}
                aria-label={t('watchLabel', { title: s.title })}
              >
                {t('watchSession')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
