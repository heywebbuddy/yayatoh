import { cx, Label, PageHeader, TabCount, Tabs, tabClass } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { networkPath } from '@/server/networking.ts';
import { NetworkToasts } from './network-forms.tsx';

export type NetworkTab = 'people' | 'connections' | 'meetings' | 'chats' | 'profile';

/**
 * The frame of the attendee networking pages (M5.8a), phone first: the event, the page's title,
 * and (for members) the four sections as tabs with what waits for an answer.
 */
export async function NetworkShell({
  slug,
  eventName,
  title,
  description,
  active,
  waiting,
  meetings = true,
  children,
}: {
  slug: string;
  eventName: string;
  title: string;
  description?: ReactNode;
  /** The section shown; omitted before the visitor is a member (no tabs then). */
  active?: NetworkTab;
  waiting?: { connections: number; meetings: number; chats?: number };
  meetings?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations('networking');
  const tabs: { key: NetworkTab; href: string; count?: number }[] = [
    { key: 'people', href: networkPath(slug) },
    { key: 'connections', href: networkPath(slug, '/connections'), count: waiting?.connections },
    ...(meetings
      ? [{ key: 'meetings' as const, href: networkPath(slug, '/meetings'), count: waiting?.meetings }]
      : []),
    // M5.8b: chats, with how many have unread messages.
    { key: 'chats', href: networkPath(slug, '/chat'), count: waiting?.chats },
    { key: 'profile', href: networkPath(slug, '/profile') },
  ];
  return (
    <NetworkToasts closeLabel={t('close')}>
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <Link
          href={`/events/${slug}`}
          className="inline-flex min-h-11 items-center gap-2 self-start text-body font-bold text-ink-2 underline-offset-2 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          {t('backToEvent', { event: eventName })}
        </Link>
        <PageHeader eyebrow={<Label>{eventName}</Label>} title={title} description={description} />
        {active ? (
          <Tabs label={t('sections')}>
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={tab.key === active ? 'page' : undefined}
                className={cx(tabClass(tab.key === active), 'min-h-11')}
              >
                {t(`tabs.${tab.key}`)}
                {tab.count ? (
                  <TabCount active={tab.key === active}>
                    <span className="sr-only">
                      {t(tab.key === 'chats' ? 'unreadChats' : 'waitingCount', { count: tab.count })}
                    </span>
                    <span aria-hidden="true">{tab.count}</span>
                  </TabCount>
                ) : null}
              </Link>
            ))}
          </Tabs>
        ) : null}
        {children}
      </main>
    </NetworkToasts>
  );
}
