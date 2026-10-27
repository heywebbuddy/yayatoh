import { lobbyQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, Card, EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { LobbyRead } from '@/components/lobby-read.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { markLobbyReadAction, reportLobbyAction, sendLobbyAction } from '../lobby-actions.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking.lobby');
  return { title: t('title'), robots: { index: false, follow: false } };
}

const REASONS = ['spam', 'harassment', 'inappropriate', 'fake', 'other'] as const;

/** The event lobby: one chat room for every attendee who opted into networking. */
export default async function LobbyPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p || p.kind !== 'member') notFound();
  const t = await getTranslations('networking.lobby');
  const tn = await getTranslations('networking');
  const lobby = await executeQuery(lobbyQuery, p.at, p.ctx, ports);
  if (!lobby.enabled) notFound();
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: p.target.timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('title')}
      description={t('description')}
      active="lobby"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <AutoRefresh />
      <LobbyRead mark={markLobbyReadAction.bind(null, slug)} count={lobby.messages.length} />
      <Alert tone="info" title={t('rules')} />
      {lobby.messages.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ol aria-label={t('messages')} className="m-0 flex list-none flex-col gap-2 p-0">
          {lobby.messages.map((m) => (
            <li key={m.id}>
              <Card className={`flex flex-col gap-1 ${m.mine ? 'bg-primary-soft' : ''}`}>
                <span className="text-caption font-bold text-ink-2">
                  {m.mine ? t('you') : m.author.displayName}
                  {m.author.headline && !m.mine ? ` · ${m.author.headline}` : ''} ·{' '}
                  <time dateTime={m.at.toISOString()}>{time.format(m.at)}</time>
                </span>
                {m.removed ? (
                  <span className="text-body italic text-ink-2">{t('removed')}</span>
                ) : (
                  <span className="whitespace-pre-wrap break-words text-body">{m.body}</span>
                )}
                {!m.mine && !m.removed ? (
                  <details className="pt-1">
                    <summary className="min-h-8 cursor-pointer text-caption text-ink-2">
                      {t('report')}
                    </summary>
                    <ProgramForm
                      action={reportLobbyAction.bind(null, slug, m.id)}
                      fields={[
                        {
                          kind: 'select',
                          name: 'reason',
                          label: t('reportReason'),
                          options: REASONS.map((r) => ({ value: r, label: tn(`reasons.${r}`) })),
                          defaultValue: 'spam',
                        },
                        { kind: 'textarea', name: 'details', label: t('reportDetails'), rows: 2 },
                      ]}
                      idPrefix={`lobby-report-${m.id}`}
                      submitLabel={t('reportSubmit')}
                      successLabel={t('reported')}
                      errors={{}}
                    />
                  </details>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <Card size="panel">
        <ProgramForm
          action={sendLobbyAction.bind(null, slug)}
          fields={[{ kind: 'textarea', name: 'body', label: t('write'), rows: 3, required: true }]}
          idPrefix="lobby-send"
          submitLabel={t('send')}
          successLabel={t('sent')}
          errors={{ rate_limited: t('tooFast'), too_long: t('tooLong'), required: t('required') }}
          reset
        />
      </Card>
    </NetworkShell>
  );
}
