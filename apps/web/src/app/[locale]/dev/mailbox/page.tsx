import { readDevMailbox } from '@yayatoh/notifications';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { devAuthEnabled } from '@/server/session.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('devMailbox');
  return { title: t('title'), robots: { index: false } };
}

/**
 * Dev/preview only: the messages the dev mailbox captured (what SES, Twilio and push would have
 * delivered). 404 unless dev auth is on; never in production.
 */
export default async function DevMailboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!devAuthEnabled()) notFound();
  const { to } = await searchParams;
  const t = await getTranslations('devMailbox');
  const entries = readDevMailbox({ to: to || undefined, limit: 50 });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      <form className="flex flex-wrap items-end gap-2" method="get">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="mailbox-to" className="text-caption text-zinc-600">
            {t('filter')}
          </label>
          <input
            id="mailbox-to"
            name="to"
            type="email"
            defaultValue={to ?? ''}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          />
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          {t('apply')}
        </button>
      </form>
      {entries.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {entries.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-col gap-2">
                <p className="text-caption text-zinc-500">
                  {t('meta', { channel: m.channel, to: m.to, at: m.at })}
                </p>
                <p className="text-section">{m.subject}</p>
                <details>
                  <summary className="cursor-pointer text-body">{t('show')}</summary>
                  {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
                  <pre tabIndex={0} className="mt-2 overflow-x-auto whitespace-pre-wrap text-caption">
                    {m.text}
                  </pre>
                  {Object.keys(m.headers).length > 0 ? (
                    <pre
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
                      tabIndex={0}
                      className="mt-2 overflow-x-auto whitespace-pre-wrap text-caption text-zinc-500"
                    >
                      {Object.entries(m.headers)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n')}
                    </pre>
                  ) : null}
                  {m.html ? (
                    <iframe
                      title={t('preview', { subject: m.subject })}
                      src={`/api/dev/mailbox/${m.id}`}
                      sandbox=""
                      className="mt-2 h-[480px] w-full rounded-card border border-zinc-200"
                    />
                  ) : null}
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
