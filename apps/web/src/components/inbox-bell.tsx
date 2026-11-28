'use client';

import { Button, buttonClass, cx, EmptyState, iconButtonClass } from '@yayatoh/ui';
import { Bell, Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { inboxAction, markReadAction } from '@/app/[locale]/o/[org]/(org)/notifications/actions.ts';
import { Link, usePathname } from '@/i18n/navigation.ts';
import type { InboxView } from '@/server/inbox.ts';

const POLL_SECONDS = 30;

/**
 * The notification bell: unread badge, a native popover with the latest items, mark read / mark
 * all read. Polls while the tab is visible (realtime arrives with Ably, roadmap §6.4); a polite
 * live region announces when new items arrive. Everything works from the keyboard. Opening an
 * item marks it read and closes the panel, as does any navigation; the X closes it too (QA #21).
 */
export function InboxBell({ org, initial }: { org: string; initial: InboxView }) {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
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

  const close = () => {
    const p = panel.current;
    if (p?.matches(':popover-open')) p.hidePopover();
  };
  // Any navigation (an item, "All notifications", a link elsewhere) closes the panel.
  useEffect(() => {
    if (panel.current?.matches(':popover-open')) panel.current.hidePopover();
  }, [pathname]);

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
        className={cx(iconButtonClass('secondary', 'md'), 'relative')}
      >
        <Bell aria-hidden="true" className="size-4" strokeWidth={2} />
        {view.unread > 0 ? (
          <span
            aria-hidden="true"
            data-testid="inbox-badge"
            className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-pill bg-brand-strong px-1 text-[11px] font-extrabold text-white tabular-nums ring-2 ring-canvas"
          >
            {view.unread > 99 ? '99+' : view.unread}
          </span>
        ) : null}
      </button>
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
      <div
        ref={panel}
        id="notification-center"
        popover="auto"
        role="dialog"
        aria-label={t('title')}
        className="m-0 w-[min(380px,calc(100vw-2rem))] rounded-panel border border-line bg-surface-solid p-4 text-ink elevation-pop [inset:auto] [inset-block-start:72px] [inset-inline-end:16px]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-card">{t('title')}</p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending || view.unread === 0}
              onClick={() => mark('all')}
            >
              {t('markAllRead')}
            </Button>
            <button
              type="button"
              popoverTarget="notification-center"
              popoverTargetAction="hide"
              aria-label={tc('close')}
              title={tc('close')}
              className={iconButtonClass('ghost', 'sm')}
            >
              <X aria-hidden="true" className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        {view.items.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            className="py-8"
            action={
              <Link
                href={`/o/${org}/notifications/preferences`}
                onClick={close}
                className={buttonClass('secondary', 'md')}
              >
                {t('choosePreferences')}
              </Link>
            }
          />
        ) : (
          <ul className="flex max-h-[60vh] list-none flex-col gap-1 overflow-y-auto p-0">
            {view.items.map((i) => (
              <li
                key={i.id}
                className={cx(
                  'flex items-start gap-2 rounded-control px-2.5 py-2',
                  !i.read && 'bg-surface-2',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'mt-1.5 size-2 shrink-0 rounded-pill',
                    i.read ? 'bg-transparent' : 'bg-primary',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {i.href ? (
                    <Link
                      href={i.href}
                      onClick={() => {
                        if (!i.read) mark([i.id]);
                        close();
                      }}
                      className="text-body underline-offset-2 hover:underline"
                    >
                      {i.title}
                    </Link>
                  ) : (
                    <span className="text-body">{i.title}</span>
                  )}
                  <span className="text-caption text-ink-2">
                    {i.read ? i.when : `${t('unread')} · ${i.when}`}
                  </span>
                </div>
                {i.read ? null : (
                  <button
                    type="button"
                    aria-label={t('markReadItem', { title: i.title })}
                    disabled={pending}
                    onClick={() => mark([i.id])}
                    className={iconButtonClass('ghost', 'sm')}
                  >
                    <Check aria-hidden="true" className="size-4" strokeWidth={2} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-caption">
          <Link href={`/o/${org}/notifications`} onClick={close} className="underline underline-offset-2">
            {t('viewAll')}
          </Link>
          <Link
            href={`/o/${org}/notifications/preferences`}
            onClick={close}
            className="underline underline-offset-2"
          >
            {t('settings')}
          </Link>
        </div>
      </div>
    </>
  );
}
