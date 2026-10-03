import {
  attendeeChatChannel,
  boothThreadQuery,
  type ChatThreadDto,
  REPORT_REASONS,
} from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChatSafety } from '@/components/networking/chat-forms.tsx';
import { ChatThread } from '@/components/networking/chat-thread.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { chatStreamPath, loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import {
  blockBoothAction,
  markChatReadAction,
  reportChatAction,
  sendBoothAction,
} from '../../chat-actions.ts';

type Params = { params: Promise<{ locale: string; slug: string; exhibitor: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chat');
  return { title: t('threadMetaTitle'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Booth chat with an exhibitor (M5.8b): the attendee asks, the exhibitor's booth people answer.
 * Only exhibitors that take chats (or that the attendee wrote to before) are here; either side can
 * block, and the attendee can report the chat (it also blocks the booth).
 */
export default async function BoothChatPage({ params }: Params) {
  const { locale, slug, exhibitor } = await params;
  pageLocale(locale);
  if (!UUID.test(exhibitor)) notFound();
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('chat');
  const tn = await getTranslations('networking');
  let chat: ChatThreadDto;
  try {
    chat = await executeQuery(boothThreadQuery, { ...p.at, exhibitorId: exhibitor }, p.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const booth = chat.booth;
  if (!booth) notFound();
  const channel = await attendeeChatChannel(p.target.orgId, p.target.eventId, p.at.email);
  const chats = getPathname({ href: networkPath(slug, '/chat'), locale });
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('threadTitle', { name: booth.name })}
      description={t('boothLabel', { numbers: booth.boothNumbers.join(', ') })}
      active="chats"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <Link
        href={networkPath(slug, '/chat')}
        className="inline-flex min-h-11 items-center gap-2 self-start text-body font-bold text-ink-2 underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('backToChats')}
      </Link>
      <ChatThread
        messages={chat.messages.map((m) => ({ ...m, at: m.at.toISOString() }))}
        conversationId={chat.conversationId}
        streamUrl={chatStreamPath(slug)}
        channel={channel}
        timeZone={p.target.timeZone}
        locale={locale}
        otherName={booth.name}
        send={sendBoothAction.bind(null, slug, booth.id)}
        markRead={chat.conversationId ? markChatReadAction.bind(null, slug, chat.conversationId) : undefined}
        closed={
          chat.closed
            ? t(chat.blockedByMe ? 'closed.blockedByMe' : `closed.${chat.closed}`, { name: booth.name })
            : null
        }
      />
      {chat.conversationId ? (
        <ChatSafety
          summary={t('safety.summary', { name: booth.name })}
          block={
            chat.blockedByMe
              ? {
                  action: blockBoothAction.bind(null, slug, booth.id, false),
                  label: t('safety.unblock', { name: booth.name }),
                  help: t('safety.unblockHelp'),
                  danger: false,
                }
              : {
                  action: blockBoothAction.bind(null, slug, booth.id, true),
                  label: t('safety.block', { name: booth.name }),
                  help: t('safety.blockBoothHelp', { name: booth.name }),
                  danger: true,
                }
          }
          report={{
            action: reportChatAction.bind(null, slug, chat.conversationId),
            label: t('safety.report', { name: booth.name }),
            help: t('safety.reportHelp'),
          }}
          reasons={REPORT_REASONS.map((r) => ({ value: r, label: tn(`reasons.${r}`) }))}
          after={`${chats}?notice=reported`}
        />
      ) : null}
    </NetworkShell>
  );
}
