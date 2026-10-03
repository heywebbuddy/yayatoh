import {
  attendeeChatChannel,
  type ChatThreadDto,
  chatThreadQuery,
  REPORT_REASONS,
} from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { Avatar, avatarTone, buttonClass } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChatThread } from '@/components/networking/chat-thread.tsx';
import { initials } from '@/components/networking/initials.ts';
import { SafetyForms } from '@/components/networking/network-forms.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { chatStreamPath, loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { blockAction, reportAction } from '../../actions.ts';
import { markChatReadAction, reportChatAction, sendChatAction } from '../../chat-actions.ts';

type Params = { params: Promise<{ locale: string; slug: string; person: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chat');
  return { title: t('threadMetaTitle'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A 1:1 chat with one person (M5.8b, P5-3): only while both are in networking with no block, and
 * a message may be sent only with an accepted connection or an agreed meeting (the page says so
 * instead of the box otherwise). Anyone not listed for the viewer is a 404.
 */
export default async function DirectChatPage({ params }: Params) {
  const { locale, slug, person } = await params;
  pageLocale(locale);
  if (!UUID.test(person)) notFound();
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('chat');
  const tn = await getTranslations('networking');
  let chat: ChatThreadDto;
  try {
    chat = await executeQuery(chatThreadQuery, { ...p.at, personId: person }, p.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const who = chat.person;
  if (!who) notFound();
  const channel = await attendeeChatChannel(p.target.orgId, p.target.eventId, p.at.email);
  const chats = getPathname({ href: networkPath(slug, '/chat'), locale });
  const directory = getPathname({ href: networkPath(slug), locale });
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('threadTitle', { name: who.displayName })}
      active="chats"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={networkPath(slug, '/chat')}
          className="inline-flex min-h-11 items-center gap-2 text-body font-bold text-ink-2 underline-offset-2 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          {t('backToChats')}
        </Link>
        <Link
          href={networkPath(slug, `/people/${who.id}`)}
          className={buttonClass('ghost', 'md', 'min-h-11 gap-2')}
        >
          <Avatar
            initials={initials(who.displayName)}
            label={who.displayName}
            tone={avatarTone(who.id)}
            size={28}
            decorative
          />
          {t('viewProfile', { name: who.displayName })}
        </Link>
      </div>
      <ChatThread
        messages={chat.messages.map((m) => ({ ...m, at: m.at.toISOString() }))}
        conversationId={chat.conversationId}
        streamUrl={chatStreamPath(slug)}
        channel={channel}
        timeZone={p.target.timeZone}
        locale={locale}
        otherName={who.displayName}
        send={sendChatAction.bind(null, slug, who.id)}
        markRead={chat.conversationId ? markChatReadAction.bind(null, slug, chat.conversationId) : undefined}
        closed={chat.closed ? t(`closed.${chat.closed}`, { name: who.displayName }) : null}
      />
      <SafetyForms
        block={blockAction.bind(null, slug, who.id)}
        report={
          chat.conversationId
            ? reportChatAction.bind(null, slug, chat.conversationId)
            : reportAction.bind(null, slug, who.id)
        }
        personName={who.displayName}
        reasons={REPORT_REASONS.map((r) => ({ value: r, label: tn(`reasons.${r}`) }))}
        after={{ blocked: `${directory}?notice=blocked`, reported: `${chats}?notice=reported` }}
      />
    </NetworkShell>
  );
}
