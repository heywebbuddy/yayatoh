import {
  type BoothThreadDto,
  boothChatThreadQuery,
  exhibitorChatChannel,
  REPORT_REASONS,
} from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { exhibitorPortalQuery } from '@yayatoh/program';
import { Label, PageHeader } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChatSafety } from '@/components/networking/chat-forms.tsx';
import { ChatThread } from '@/components/networking/chat-thread.tsx';
import { PortalFrame } from '@/components/portal-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { boothStreamPath } from '@/server/networking.ts';
import { currentPortalPrincipal, portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import {
  blockVisitorAction,
  markBoothReadAction,
  replyBoothChatAction,
  reportVisitorAction,
} from '../../chat-actions.ts';

type Params = { params: Promise<{ locale: string; conversation: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'chat' });
  return { title: t('threadMetaTitle'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One visitor's booth chat (M5.8b), for any of the exhibitor's portal people: answer, block or
 * unblock the visitor, report them (which also blocks). Another exhibitor's chat is a 404.
 */
export default async function BoothChatThreadPage({ params }: Params) {
  const { locale, conversation } = await params;
  setRequestLocale(locale);
  if (!UUID.test(conversation)) notFound();
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind !== 'exhibitor') notFound();
  const ctx = await portalRequestCtx(principal);
  let chat: BoothThreadDto;
  try {
    chat = await executeQuery(boothChatThreadQuery, { conversationId: conversation }, ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const [view, channel] = await Promise.all([
    executeQuery(exhibitorPortalQuery, {}, ctx, ports),
    exhibitorChatChannel(ctx),
  ]);
  const t = await getTranslations('chat');
  const tn = await getTranslations('networking');
  const name = chat.visitor.displayName;
  return (
    <PortalFrame eventName={view.event.name}>
      <Link
        href="/event-portal/chat"
        className="inline-flex min-h-11 items-center gap-2 self-start text-body font-bold text-ink-2 underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('portal.backToChats')}
      </Link>
      <PageHeader
        eyebrow={<Label>{t('portal.title')}</Label>}
        title={name}
        description={[chat.visitor.headline, chat.visitor.company].filter(Boolean).join(' · ') || undefined}
      />
      <ChatThread
        messages={chat.messages.map((m) => ({ ...m, at: m.at.toISOString() }))}
        conversationId={chat.id}
        streamUrl={boothStreamPath}
        channel={channel}
        timeZone={view.event.timezone}
        locale={locale}
        otherName={name}
        send={replyBoothChatAction.bind(null, chat.id)}
        markRead={markBoothReadAction.bind(null, chat.id)}
        closed={
          chat.closed
            ? t(chat.blockedByMe ? 'portal.closedBlockedByMe' : `portal.closed.${chat.closed}`, { name })
            : null
        }
      />
      <ChatSafety
        summary={t('safety.summary', { name })}
        block={
          chat.blockedByMe
            ? {
                action: blockVisitorAction.bind(null, chat.id, false),
                label: t('safety.unblock', { name }),
                help: t('safety.unblockHelp'),
                danger: false,
              }
            : {
                action: blockVisitorAction.bind(null, chat.id, true),
                label: t('safety.block', { name }),
                help: t('safety.blockVisitorHelp', { name }),
                danger: true,
              }
        }
        report={{
          action: reportVisitorAction.bind(null, chat.id),
          label: t('safety.report', { name }),
          help: t('safety.reportHelp'),
        }}
        reasons={REPORT_REASONS.map((r) => ({ value: r, label: tn(`reasons.${r}`) }))}
        after={`${getPathname({ href: '/event-portal/chat', locale })}?notice=reported`}
      />
    </PortalFrame>
  );
}
