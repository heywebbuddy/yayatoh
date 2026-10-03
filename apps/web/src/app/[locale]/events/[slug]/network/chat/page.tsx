import { attendeeChatChannel, type ChatSummaryDto, chatInboxQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, Avatar, avatarTone, Badge, buttonClass, Card, EmptyState } from '@yayatoh/ui';
import { MessagesSquare, Store } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChatInboxLive } from '@/components/networking/chat-thread.tsx';
import { initials } from '@/components/networking/initials.ts';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { chatStreamPath, loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ notice?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chat');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * An attendee's chats (M5.8b): conversations with people they're connected with or meeting, and
 * with exhibitors at their booths, newest first with what's unread; and the booths taking chats.
 * The list re-reads itself when a message arrives on their inbox stream.
 */
export default async function ChatsPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const { notice } = await searchParams;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('chat');
  const inbox = await executeQuery(chatInboxQuery, p.at, p.ctx, ports);
  const channel = await attendeeChatChannel(p.target.orgId, p.target.eventId, p.at.email);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: p.target.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const hrefOf = (c: ChatSummaryDto) =>
    c.kind === 'direct'
      ? networkPath(slug, `/chat/${c.person?.id}`)
      : networkPath(slug, `/booths/${c.booth?.id}`);
  const nameOf = (c: ChatSummaryDto) => c.person?.displayName ?? c.booth?.name ?? '';
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('title')}
      description={t('description')}
      active="chats"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <ChatInboxLive streamUrl={chatStreamPath(slug)} channel={channel} />
      {notice === 'reported' || notice === 'blocked' ? (
        <Alert tone="info" title={t(`notice.${notice}`)} />
      ) : null}
      {!inbox.chatEnabled ? <Alert tone="info" title={t('closed.chat_off')} /> : null}
      <section aria-labelledby="chats-heading" className="flex flex-col gap-3">
        <h2 id="chats-heading" className="text-section">
          {t('conversationsHeading')}
        </h2>
        {inbox.conversations.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Link href={networkPath(slug, '/connections')} className={buttonClass('primary')}>
                {t('toConnections')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {inbox.conversations.map((c) => (
              <li key={c.id}>
                <Card className="flex items-start gap-3">
                  <Avatar
                    initials={initials(nameOf(c))}
                    label={nameOf(c)}
                    tone={avatarTone(c.person?.id ?? c.booth?.id ?? c.id)}
                    size={42}
                    decorative
                  />
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    <h3 className="text-card">
                      <Link
                        href={hrefOf(c)}
                        className="inline-flex min-h-6 items-center gap-2 underline-offset-2 hover:underline"
                      >
                        {nameOf(c)}
                        {c.unread ? (
                          <Badge tone="primary">
                            <span className="sr-only">{t('unread', { count: c.unread })}</span>
                            <span aria-hidden="true">{c.unread}</span>
                          </Badge>
                        ) : null}
                      </Link>
                    </h3>
                    <p className="text-caption text-ink-2">
                      {c.kind === 'booth'
                        ? t('boothLabel', { numbers: c.booth?.boothNumbers.join(', ') ?? '' })
                        : [c.person?.headline, c.person?.company].filter(Boolean).join(' · ')}
                    </p>
                    {c.last ? (
                      <p className="truncate text-body text-ink">
                        {c.last.body === null
                          ? t('lastRemoved')
                          : c.last.fromMe
                            ? t('lastFromMe', { body: c.last.body })
                            : c.last.body}
                      </p>
                    ) : null}
                  </div>
                  {c.last ? (
                    <time
                      dateTime={c.last.at.toISOString()}
                      className="shrink-0 text-caption text-ink-2 tabular-nums"
                    >
                      {when.format(c.last.at)}
                    </time>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="booths-heading" className="flex flex-col gap-3">
        <h2 id="booths-heading" className="text-section">
          {t('boothsHeading')}
        </h2>
        {inbox.booths.length === 0 ? (
          <p className="text-body text-ink-2">{t('noBooths')}</p>
        ) : (
          <>
            <p className="text-body text-ink-2">{t('boothsHelp')}</p>
            <ul className="flex list-none flex-col gap-2 p-0">
              {inbox.booths.map((b) => (
                <li key={b.id}>
                  <Card className="flex flex-wrap items-center gap-3">
                    <Store aria-hidden="true" className="size-5 text-ink-2" />
                    <div className="flex min-w-0 grow flex-col">
                      <span className="text-card text-ink">{b.name}</span>
                      <span className="text-caption text-ink-2">
                        {t('boothLabel', { numbers: b.boothNumbers.join(', ') })}
                      </span>
                    </div>
                    <Link
                      href={networkPath(slug, `/booths/${b.id}`)}
                      className={buttonClass('secondary', 'md', 'min-h-11')}
                      aria-label={t('chatWithBooth', { name: b.name })}
                    >
                      {t('openBooth')}
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </NetworkShell>
  );
}
