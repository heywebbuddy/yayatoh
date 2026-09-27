import { executeQuery } from '@yayatoh/kernel';
import { threadsQuery } from '@yayatoh/messaging';
import { roleCan } from '@yayatoh/tenancy';
import { Card, Chip, cx, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('conversation');
  return { title: t('inboxTitle') };
}

const FILTERS = ['all', 'unread', 'blocked'] as const;

/** The organizer inbox: one conversation per customer, newest first. */
export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('messaging') || !roleCan(data.role, 'messages:read')) notFound();
  const { filter: raw } = await searchParams;
  const filter = FILTERS.find((f) => f === raw) ?? 'all';
  const t = await getTranslations('conversation');
  const threads = await executeQuery(threadsQuery, { filter }, data.ctx, ports);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  return (
    <>
      <PageHeader title={t('inboxTitle')} description={t('inboxDescription')} />
      <nav aria-label={t('filters')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? `/o/${org}/messages` : `/o/${org}/messages?filter=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={cx(
              'flex min-h-8 items-center rounded-pill border px-3 text-caption',
              f === filter ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white',
            )}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </nav>
      {threads.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="p-2">
          <ul className="flex list-none flex-col p-0">
            {threads.map((th) => (
              <li key={th.id} className={cx('rounded-[14px] px-3 py-2.5', th.unread && 'bg-zinc-50')}>
                <Link href={`/o/${org}/messages/${th.id}`} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cx('text-body', th.unread && 'font-medium')}>
                      {th.contactName ?? th.contactEmail}
                    </span>
                    <span className="text-caption text-zinc-500">{th.contactEmail}</span>
                    {th.unread ? <Chip>{t('unread')}</Chip> : null}
                    {th.blocked ? <Chip>{t('blockedChip')}</Chip> : null}
                  </span>
                  <span className="line-clamp-1 text-caption text-zinc-600">
                    {th.lastDirection === 'out' ? `${t('you')}: ` : ''}
                    {th.preview}
                  </span>
                  <span className="text-caption text-zinc-500">{when.format(th.lastMessageAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
