'use client';

import { Button, cx, EmptyState } from '@yayatoh/ui';
import { Bell, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { inboxAction, markReadAction } from '@/app/[locale]/o/[org]/(org)/notifications/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import type { InboxView } from '@/server/inbox.ts';

const POLL_SECONDS = 30;

/**
 * The notification bell: unread badge, a native popover with the latest items, mark read / mark
 * all read. Polls while the tab is visible (realtime arrives with Ably, roadmap §6.4); a polite
 * live region announces when new items arrive. Everything works from the keyboard.
 */
export function InboxBell({ org, initial }: { org: string; initial: InboxView }) {
  const t = useTranslations('notifications');
  const [view, setView] = useState(initial);
  const [announcement, setAnnouncement] = useState('');
  const [pending, start] = useTransition();
  const last = useRef(initial.unread);

  useEffect(() => setView(initial), [initial]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      inboxAction(org)
        .then(setView)
        .catch(() => {});
    }, POLL_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [org]);
  useEffect(() => {
    if (view.unread > last.current) setAnnouncement(t('unreadAnnouncement', { count: view.unread }));
    last.current = view.unread;
  }, [view.unread, t]);

  const mark = (ids: readonly string[] | 'all') =>
    start(async () => {
      const next = await markReadAction(org, ids);
      last.current = next.unread;
      setView(next);
      setAnnouncement(t('unreadAnnouncement', { count: next.unread }));
    });

  return (
    <>
      <button
        type="button"
        popoverTarget="notification-center"
        aria-label={t('openWithCount', { count: view.unread })}
        className="relative flex size-10 items-center justify-center rounded-pill border border-zinc-200 bg-white hover:bg-zinc-50"
      >
        <Bell aria-hidden="true" className="size-4" strokeWidth={1.6} />
        {view.unread > 0 ? (
          <span
            aria-hidden="true"
            data-testid="inbox-badge"
            className="absolute -end-1 -top-1 flex min-w-5 items-center justify-center rounded-pill bg-zinc-900 px-1 font-mono text-[11px] text-white"
          >
            {view.unread > 99 ? '99+' : view.unread}
          </span>
        ) : null}
      </button>
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
      <div
        id="notification-center"
        popover="auto"
        role="dialog"
        aria-label={t('title')}
        className="m-0 w-[min(380px,calc(100vw-2rem))] rounded-panel border border-zinc-200 bg-white p-4 shadow-xl [inset:auto] [inset-block-start:72px] [inset-inline-end:16px]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-section">{t('title')}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending || view.unread === 0}
            onClick={() => mark('all')}
          >
            {t('markAllRead')}
          </Button>
        </div>
        {view.items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} className="py-8" />
        ) : (
          <ul className="flex max-h-[60vh] list-none flex-col gap-1 overflow-y-auto p-0">
            {view.items.map((i) => (
              <li
                key={i.id}
                className={cx('flex items-start gap-2 rounded-[14px] px-2.5 py-2', !i.read && 'bg-zinc-50')}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'mt-1.5 size-2 shrink-0 rounded-pill',
                    i.read ? 'bg-transparent' : 'bg-accent-900',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
                  <button
                    type="button"
                    aria-label={t('markReadItem', { title: i.title })}
                    disabled={pending}
                    onClick={() => mark([i.id])}
                    className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-zinc-200 bg-white hover:bg-zinc-50"
                  >
                    <Check aria-hidden="true" className="size-4" strokeWidth={1.6} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-zinc-200 pt-3 text-caption">
          <Link href={`/o/${org}/notifications`} className="underline underline-offset-2">
            {t('viewAll')}
          </Link>
          <Link href={`/o/${org}/notifications/preferences`} className="underline underline-offset-2">
            {t('settings')}
          </Link>
        </div>
      </div>
    </>
  );
}
