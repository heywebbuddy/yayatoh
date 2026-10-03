import { boothInboxQuery, exhibitorChatChannel } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { exhibitorPortalQuery } from '@yayatoh/program';
import {
  Alert,
  Avatar,
  avatarTone,
  Badge,
  Card,
  EmptyState,
  Label,
  PageHeader,
  StatusPill,
} from '@yayatoh/ui';
import { ArrowLeft, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChatActionButton } from '@/components/networking/chat-forms.tsx';
import { ChatInboxLive } from '@/components/networking/chat-thread.tsx';
import { initials } from '@/components/networking/initials.ts';
import { PortalFrame } from '@/components/portal-shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { boothStreamPath } from '@/server/networking.ts';
import { currentPortalPrincipal, portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { setBoothChatAction } from '../chat-actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'chat' });
  return { title: t('portal.title'), robots: { index: false, follow: false } };
}

/**
 * Booth chat for an exhibitor's people (M5.8b): the booth's switch (its admin turns it on; off by
 * default), the organizer's suspension if any, and the visitors' chats, newest first with what's
 * unread. A visitor shows only as the networking profile they chose.
 */
export default async function BoothChatInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { locale } = await params;
  const { notice } = await searchParams;
  setRequestLocale(locale);
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind !== 'exhibitor') notFound();
  const ctx = await portalRequestCtx(principal);
  const [view, box, channel] = await Promise.all([
    executeQuery(exhibitorPortalQuery, {}, ctx, ports),
    executeQuery(boothInboxQuery, {}, ctx, ports),
    exhibitorChatChannel(ctx),
  ]);
  const t = await getTranslations('chat');
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: view.event.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const on = box.enabled && !box.suspended && box.eventChat && box.atBooth;
  return (
    <PortalFrame eventName={view.event.name}>
      <ChatInboxLive streamUrl={boothStreamPath} channel={channel} />
      <Link
        href="/event-portal"
        className="inline-flex min-h-11 items-center gap-2 self-start text-body font-bold text-ink-2 underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('portal.back', { name: view.exhibitor.name })}
      </Link>
      <PageHeader
        eyebrow={<Label>{view.exhibitor.name}</Label>}
        title={t('portal.title')}
        description={t('portal.description')}
      />
      {notice === 'reported' ? <Alert tone="info" title={t('portal.reported')} /> : null}
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={on ? 'success' : 'neutral'} label={on ? t('portal.on') : t('portal.off')} />
        </div>
        {box.suspended ? <Alert tone="warning" title={t('portal.suspended')} /> : null}
        {!box.eventChat ? <Alert tone="info" title={t('portal.eventOff')} /> : null}
        {!box.atBooth ? <Alert tone="info" title={t('portal.notAtBooth')} /> : null}
        {box.canManage ? (
          <ChatActionButton
            action={setBoothChatAction.bind(null, !box.enabled)}
            label={box.enabled ? t('portal.turnOff') : t('portal.turnOn')}
            variant={box.enabled ? 'secondary' : 'primary'}
          />
        ) : (
          <p className="text-caption text-ink-2">{t('portal.adminOnly')}</p>
        )}
      </Card>
      <section aria-labelledby="booth-chats-heading" className="flex flex-col gap-3">
        <h2 id="booth-chats-heading" className="text-section">
          {t('portal.conversations')}
        </h2>
        {box.conversations.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title={t('portal.emptyTitle')}
            description={box.enabled ? t('portal.emptyDescription') : t('portal.emptyOff')}
          />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {box.conversations.map((c) => (
              <li key={c.id}>
                <Card className="flex items-start gap-3">
                  <Avatar
                    initials={initials(c.visitor.displayName)}
                    label={c.visitor.displayName}
                    tone={avatarTone(c.id)}
                    size={42}
                    decorative
                  />
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    <h3 className="text-card">
                      <Link
                        href={`/event-portal/chat/${c.id}`}
                        className="inline-flex min-h-6 items-center gap-2 underline-offset-2 hover:underline"
                      >
                        {c.visitor.displayName}
                        {c.unread ? (
                          <Badge tone="primary">
                            <span className="sr-only">{t('unread', { count: c.unread })}</span>
                            <span aria-hidden="true">{c.unread}</span>
                          </Badge>
                        ) : null}
                      </Link>
                    </h3>
                    {c.visitor.headline || c.visitor.company ? (
                      <p className="text-caption text-ink-2">
                        {[c.visitor.headline, c.visitor.company].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {c.last ? (
                      <p className="truncate text-body text-ink">
                        {c.last.body === null
                          ? t('lastRemoved')
                          : c.last.fromMe
                            ? t('lastFromBooth', { body: c.last.body })
                            : c.last.body}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.last ? (
                      <time
                        dateTime={c.last.at.toISOString()}
                        className="text-caption text-ink-2 tabular-nums"
                      >
                        {when.format(c.last.at)}
                      </time>
                    ) : null}
                    {c.blocked ? <StatusPill tone="danger" label={t('portal.blocked')} /> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalFrame>
  );
}
