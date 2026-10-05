import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { markThreadReadCommand, threadQuery } from '@yayatoh/messaging';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { BlockToggle, MessageForm, ReportForm } from '@/components/conversation.tsx';
import { MessageList } from '@/components/message-list.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { blockAction, replyAction, reportAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('conversation');
  return { title: t('threadTitle') };
}

/** One conversation: history, reply, block and report. Opening it clears the unread mark. */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; threadId: string }>;
}) {
  const { locale, org, threadId } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(threadId).success) notFound();
  const data = await loadConsole(org);
  if (!data.modules.has('messaging') || !roleCan(data.role, 'messages:read')) notFound();
  const thread = await executeQuery(threadQuery, { threadId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  if (thread.unread) await executeCommand(markThreadReadCommand, { threadId }, data.ctx, ports);
  const t = await getTranslations('conversation');
  const canSend = roleCan(data.role, 'messages:send');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const name = thread.contactName ?? thread.contactEmail;
  return (
    <>
      <Link href={`/o/${org}/messages`} className="self-start text-caption underline underline-offset-2">
        {t('back')}
      </Link>
      <PageHeader title={t('threadWith', { name })} description={thread.contactEmail} />
      <MessageList
        label={t('history')}
        messages={thread.messages.map((m) => ({
          key: m.id,
          direction: m.direction,
          subject: m.subject,
          body: m.body,
          author: m.direction === 'out' ? data.org.name : name,
          when: when.format(m.at),
        }))}
      />
      {thread.contactBlocked ? <p className="text-body text-ink-2">{t('contactBlockedYou')}</p> : null}
      {canSend ? (
        <>
          {!thread.blocked && !thread.contactBlocked ? (
            <section aria-labelledby="reply-heading" className="flex flex-col gap-3">
              <h2 id="reply-heading" className="text-section">
                {t('replyTitle')}
              </h2>
              <Card>
                <MessageForm
                  action={replyAction.bind(null, org, threadId)}
                  label={t('replyLabel')}
                  submit={t('sendReply')}
                />
              </Card>
            </section>
          ) : null}
          <section aria-labelledby="safety-heading" className="flex flex-col gap-3">
            <h2 id="safety-heading" className="text-section">
              {t('safetyTitle')}
            </h2>
            <Card className="flex flex-col gap-6">
              <BlockToggle
                action={blockAction.bind(null, org, threadId)}
                blocked={thread.blocked}
                blockLabel={t('block')}
                unblockLabel={t('unblock')}
                blockedText={t('blockedText')}
              />
              <ReportForm action={reportAction.bind(null, org, threadId)} done={thread.reported} />
            </Card>
          </section>
        </>
      ) : null}
    </>
  );
}
