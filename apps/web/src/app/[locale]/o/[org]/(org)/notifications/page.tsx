import { Button, Card, cx, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { loadInbox } from '@/server/inbox.ts';
import { markReadFormAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('pageTitle') };
}

/** Every notification of the signed-in member in this org, newest first, 20 at a time. */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { before } = await searchParams;
  const data = await loadConsole(org);
  const t = await getTranslations('notifications');
  const view = await loadInbox(data, {
    limit: 20,
    before: z.uuid().safeParse(before).success ? before : undefined,
  });
  const action = markReadFormAction.bind(null, org);
  const last = view.items.at(-1);
  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={action}>
              <Button type="submit" variant="secondary" disabled={view.unread === 0}>
                {t('markAllRead')}
              </Button>
            </form>
            <Link
              href={`/o/${org}/notifications/preferences`}
              className="flex min-h-10 items-center rounded-pill border border-zinc-200 bg-white px-4 text-body"
            >
              {t('settings')}
            </Link>
          </div>
        }
      />
      <p role="status" className="text-body text-zinc-600">
        {view.unread === 0 ? t('allRead') : t('unreadAnnouncement', { count: view.unread })}
      </p>
      {view.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card className="p-2">
          <ul className="flex list-none flex-col p-0">
            {view.items.map((i) => (
              <li
                key={i.id}
                className={cx(
                  'flex flex-wrap items-center gap-3 rounded-[14px] px-3 py-2.5',
                  !i.read && 'bg-zinc-50',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx('size-2 shrink-0 rounded-pill', i.read ? 'bg-transparent' : 'bg-accent-900')}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  {i.href ? (
                    <Link href={i.href} className="text-body underline-offset-2 hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    <span className="text-body">{i.title}</span>
                  )}
                  <span className="text-caption text-zinc-500">
                    {i.read ? i.when : `${t('unread')} · ${i.when}`}
                  </span>
                </div>
                {i.read ? null : (
                  <form action={action}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {t('markRead')}
                      <span className="sr-only">: {i.title}</span>
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view.more && last ? (
        <Link
          href={`/o/${org}/notifications?before=${last.id}`}
          className="self-start text-body underline underline-offset-2"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </>
  );
}
