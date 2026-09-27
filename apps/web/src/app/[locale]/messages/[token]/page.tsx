import { publicThread } from '@yayatoh/messaging';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BlockToggle, MessageForm, ReportForm } from '@/components/conversation.tsx';
import { MessageList } from '@/components/message-list.tsx';
import { contactBlockAction, contactMessageAction, contactReportAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('conversation');
  return { title: t('publicMetaTitle'), robots: { index: false } };
}

/** A customer's conversation with an organizer, reached from the reply link in an email. */
export default async function PublicThreadPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const view = await publicThread(token);
  if (!view) notFound();
  const t = await getTranslations('conversation');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('publicEyebrow')}</Label>}
        title={t('publicTitle', { org: view.orgName })}
        description={t('publicDescription')}
      />
      <MessageList
        label={t('history')}
        messages={view.messages.map((m) => ({
          key: m.key,
          direction: m.direction,
          subject: m.subject,
          body: m.body,
          author: m.direction === 'out' ? view.orgName : t('you'),
          when: when.format(m.at),
        }))}
      />
      {view.blocked ? (
        <p role="status" className="text-body text-zinc-600">
          {t('notAccepting', { org: view.orgName })}
        </p>
      ) : view.contactBlocked ? null : (
        <Card>
          <MessageForm
            action={contactMessageAction.bind(null, token)}
            label={t('writeLabel', { org: view.orgName })}
            submit={t('send')}
          />
        </Card>
      )}
      <section aria-labelledby="safety-heading" className="flex flex-col gap-3">
        <h2 id="safety-heading" className="text-section">
          {t('safetyTitle')}
        </h2>
        <Card className="flex flex-col gap-6">
          <BlockToggle
            action={contactBlockAction.bind(null, token)}
            blocked={view.contactBlocked}
            blockLabel={t('blockOrg', { org: view.orgName })}
            unblockLabel={t('unblockOrg', { org: view.orgName })}
            blockedText={t('youBlocked', { org: view.orgName })}
          />
          <ReportForm action={contactReportAction.bind(null, token)} />
        </Card>
      </section>
    </main>
  );
}
