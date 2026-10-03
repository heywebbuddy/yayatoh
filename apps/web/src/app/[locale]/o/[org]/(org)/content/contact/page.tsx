import { CMS_WRITE, contactPageQuery, orgContactMessagesQuery } from '@yayatoh/cms';
import { executeQuery } from '@yayatoh/kernel';
import { publicOrganizer } from '@yayatoh/marketplace';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContactPageSettings, MarkHandledButton } from '@/components/cms/contact-page-settings.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { contactPublicUrl } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { markContactMessageHandledAction, saveContactPageAction } from './actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orgContactConsole' });
  return { title: t('title') };
}

/**
 * U10: the org's contact page block (Site & content). Settings first (on/off, its line of text),
 * the public link, then the messages visitors sent (people who write the site; viewers see the
 * settings only, since messages hold visitors' details).
 */
export default async function ContactPageConsole({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('orgContactConsole');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const page = await executeQuery(contactPageQuery, {}, data.ctx, ports);
  const messages = canWrite ? await executeQuery(orgContactMessagesQuery, {}, data.ctx, ports) : [];
  const pub = await publicOrganizer(data.org.slug);
  const url = pub ? contactPublicUrl(await requestHost(), pub) : null;
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const fresh = messages.filter((m) => m.status === 'new').length;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('settingsTitle')}</h2>
        <ContactPageSettings
          action={saveContactPageAction.bind(null, org)}
          enabled={page.enabled}
          intro={page.intro}
          canWrite={canWrite}
        />
        {page.enabled && url ? (
          <p className="text-body">
            {t('liveAt')}{' '}
            <a href={url} className="break-all underline" dir="ltr">
              {url}
            </a>
          </p>
        ) : (
          <p className="text-caption text-ink-2">{t('offNote')}</p>
        )}
        <p className="text-caption text-ink-2">{t('privacyNote')}</p>
      </Card>

      <section aria-labelledby="contact-messages" className="flex flex-col gap-3">
        <h2 id="contact-messages" className="text-section">
          {t('messagesTitle')}
          {fresh ? (
            <span className="ms-2 text-caption text-ink-2">{t('newCount', { count: fresh })}</span>
          ) : null}
        </h2>
        {!canWrite ? (
          <p className="text-body text-ink-2">{t('messagesHidden')}</p>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<Inbox strokeWidth={2} />}
            title={t('emptyTitle')}
            description={page.enabled ? t('emptyOn') : t('emptyOff')}
            action={
              page.enabled && url ? (
                <a href={url} className="inline-flex min-h-10 items-center underline">
                  {t('openPage')}
                </a>
              ) : (
                <Link href="#contact-enabled" className="inline-flex min-h-10 items-center underline">
                  {t('turnOn')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('messagesTitle')}
            rowKey={(m) => m.id}
            rows={messages}
            stackOnPhone
            columns={[
              {
                key: 'from',
                header: t('from'),
                cell: (m) => (
                  <span className="flex flex-col">
                    <span className="font-semibold">{m.name}</span>
                    <a href={`mailto:${m.email}`} className="text-caption underline" dir="ltr">
                      {m.email}
                    </a>
                  </span>
                ),
              },
              {
                key: 'message',
                header: t('message'),
                cell: (m) => <p className="max-w-prose whitespace-pre-line break-words">{m.message}</p>,
              },
              {
                key: 'received',
                header: t('received'),
                cell: (m) =>
                  formatDate(m.createdAt.toISOString(), f, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }),
              },
              {
                key: 'status',
                header: t('status'),
                align: 'end',
                cell: (m) =>
                  m.status === 'new' ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <StatusPill tone="waiting" label={t('statusNew')} />
                      <MarkHandledButton
                        action={markContactMessageHandledAction.bind(null, org, m.id)}
                        name={m.name}
                      />
                    </span>
                  ) : (
                    <StatusPill tone="success" label={t('statusHandled')} />
                  ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
