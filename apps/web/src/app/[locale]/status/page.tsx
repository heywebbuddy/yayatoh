import type { ComponentStatus, StatusIncident } from '@yayatoh/platform';
import { STATUS_COMPONENTS } from '@yayatoh/platform';
import { EmptyState, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { formatDate } from '@/lib/format.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { statusSnapshot } from '@/server/status.ts';

type Props = { params: Promise<{ locale: string }> };

const DOT: Record<ComponentStatus, 'success' | 'info' | 'warning' | 'danger'> = {
  operational: 'success',
  maintenance: 'info',
  degraded: 'warning',
  partial_outage: 'warning',
  major_outage: 'danger',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  if (req.kind === 'tenant') return {};
  const t = await getTranslations({ locale, namespace: 'status' });
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/status',
    title: t('page.metaTitle'),
    description: t('page.lede'),
    image: `${req.origin}/api/og/home`,
  });
}

/**
 * The public status page (M3.11b): overall state, each component, open incidents with their
 * updates and those resolved in the last 14 days, from the `StatusPage` port. Times in UTC.
 */
export default async function StatusPageView({ params }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  if ((await requestHost()).kind === 'tenant') notFound();
  const t = await getTranslations('status');
  const snapshot = await statusSnapshot();
  const when = (d: Date) =>
    formatDate(
      d.toISOString(),
      { locale, currency: 'USD', timeZone: 'UTC' },
      { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
    );
  const componentName = (key: string, name: string) =>
    (STATUS_COMPONENTS as readonly string[]).includes(key) ? t(`components.${key}`) : name;
  const open = snapshot?.incidents.filter((i) => i.active) ?? [];
  const past = snapshot?.incidents.filter((i) => !i.active) ?? [];
  const incident = (i: StatusIncident) => (
    <li key={i.id} className="flex flex-col gap-3 rounded-card border border-zinc-200 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[19px] font-normal tracking-[-0.02em] break-words">{i.title}</h3>
        <p className="flex flex-wrap gap-x-3 text-caption text-zinc-600">
          <span>{t(`impact.${i.impact}`)}</span>
          <span>{t(`incidentStatus.${i.status}`)}</span>
          {i.components.length > 0 ? (
            <span>
              {t('affects', {
                components: i.components
                  .map((k) => componentName(k, snapshot?.components.find((c) => c.key === k)?.name ?? k))
                  .join(', '),
              })}
            </span>
          ) : null}
        </p>
      </div>
      <ol aria-label={t('updates', { title: i.title })} className="flex list-none flex-col gap-3 border-s border-zinc-200 p-0 ps-4">
        {i.updates.map((u) => (
          <li key={`${u.at.toISOString()}-${u.status}`} className="flex flex-col gap-0.5">
            <p className="text-caption text-zinc-500">
              <span className="font-medium text-zinc-700">{t(`incidentStatus.${u.status}`)}</span> ·{' '}
              <time dateTime={u.at.toISOString()}>{when(u.at)}</time>
            </p>
            <p className="text-body break-words whitespace-pre-line">{u.body}</p>
          </li>
        ))}
      </ol>
    </li>
  );
  return (
    <div className="min-h-dvh bg-white">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-[40px] leading-tight font-light tracking-[-0.04em]">{t('page.title')}</h1>
          <p className="text-[17px] text-zinc-600">{t('page.lede')}</p>
        </header>
        {!snapshot ? (
          <EmptyState title={t('page.unavailableTitle')} description={t('page.unavailableBody')} />
        ) : (
          <>
            <section
              aria-labelledby="status-overall"
              data-overall={snapshot.overall}
              className="flex flex-col gap-1 rounded-card border border-zinc-200 p-5"
            >
              <h2 id="status-overall" className="text-[24px] font-normal tracking-[-0.02em]">
                {t(`overall.${snapshot.overall}`)}
              </h2>
              <p className="text-caption text-zinc-500">
                {t('page.checked', { time: when(snapshot.fetchedAt) })}
              </p>
            </section>
            <section aria-labelledby="status-components" className="flex flex-col gap-3">
              <h2 id="status-components" className="text-[22px] font-normal tracking-[-0.02em]">
                {t('page.components')}
              </h2>
              <ul className="flex list-none flex-col divide-y divide-zinc-200 rounded-card border border-zinc-200 p-0">
                {snapshot.components.map((c) => (
                  <li key={c.key} data-component={c.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="text-body">{componentName(c.key, c.name)}</span>
                    <StatusDot status={DOT[c.status]} label={t(`componentStatus.${c.status}`)} />
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="status-open" className="flex flex-col gap-3">
              <h2 id="status-open" className="text-[22px] font-normal tracking-[-0.02em]">
                {t('page.open')}
              </h2>
              {open.length === 0 ? (
                <p className="text-body text-zinc-600">{t('page.noOpen')}</p>
              ) : (
                <ul className="flex list-none flex-col gap-4 p-0">{open.map(incident)}</ul>
              )}
            </section>
            <section aria-labelledby="status-past" className="flex flex-col gap-3">
              <h2 id="status-past" className="text-[22px] font-normal tracking-[-0.02em]">
                {t('page.past')}
              </h2>
              {past.length === 0 ? (
                <p className="text-body text-zinc-600">{t('page.noPast')}</p>
              ) : (
                <ul className="flex list-none flex-col gap-4 p-0">{past.map(incident)}</ul>
              )}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
