import {
  renderSlackTest,
  type SlackBlock,
  type SlackMessageDto,
  slackChannelsFor,
  slackPanelQuery,
} from '@yayatoh/integrations';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, Button, Card, SectionHeader, StatusPill, type StatusTone, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ConsoleData } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { saveSlackSettingsAction, sendSlackTestAction } from '../slack-actions.ts';
import { type SlackChannelOption, SlackSettingsForm } from './slack-form.tsx';

const MESSAGE_TONE: Record<SlackMessageDto['status'], StatusTone> = {
  pending: 'waiting',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Slack mrkdwn as plain text for the preview: links show their label, bold markers go. */
function plain(text: string): string {
  return text
    .replace(/<[^|>]+\|([^>]+)>/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/:[a-z_]+:\s?/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function PreviewBlock({ block }: { block: SlackBlock }) {
  if (block.type === 'divider') return <hr className="m-0 border-line" />;
  if (block.type === 'context')
    return (
      <p className="m-0 text-caption text-ink-2">{block.elements.map((e) => plain(e.text)).join(' ')}</p>
    );
  if (block.type === 'header') return <p className="m-0 font-bold text-ink">{block.text.text}</p>;
  return <p className="m-0 whitespace-pre-line text-body text-ink">{plain(block.text.text)}</p>;
}

/**
 * The Slack part of a connection page (M6.4c): channel, alerts and digest settings, a preview of
 * the test alert and "Send test alert" (the one primary action once a channel is set), and the
 * latest messages with their outcome. Message text never includes personal data beyond names.
 */
export async function SlackPanel({
  org,
  connectionId,
  data,
  canManage,
  active,
  sp,
}: {
  org: string;
  connectionId: string;
  data: ConsoleData;
  canManage: boolean;
  active: boolean;
  sp: { slack?: string; channel?: string; slackError?: string };
}) {
  const t = await getTranslations('integrations.slack');
  const panel = await executeQuery(slackPanelQuery, { connectionId }, data.ctx, ports);
  const auth = integrationAuth();
  let channels: SlackChannelOption[] = [];
  let channelsFailed = false;
  if (active && auth) {
    const list = await slackChannelsFor(connectionId, data.ctx, ports, auth).catch(() => null);
    if (list) channels = list;
    else channelsFailed = true;
  }
  const s = panel.settings;
  const preview = renderSlackTest({ locale: data.org.defaultLocale, orgName: data.org.name, url: '' });
  const when = new Intl.DateTimeFormat(data.ctx.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const errorText = (code: string) =>
    t.has(`error.${code}`) ? t(`error.${code}`) : t('error.other', { code });
  const canSend = canManage && active && !!s.channelId;
  return (
    <section aria-labelledby="slack-heading" className="flex flex-col gap-3">
      <SectionHeader id="slack-heading" title={t('title')} description={t('description')} />
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {sp.slack === 'sent' ? (
          <Alert tone="success" title={t('testSent', { channel: sp.channel ?? s.channelName ?? '' })} />
        ) : null}
        {sp.slackError ? <Alert tone="danger" title={errorText(sp.slackError)} /> : null}
        {channelsFailed ? <Alert tone="warning" title={t('channelsFailed')} /> : null}
      </div>
      {active ? (
        <SlackSettingsForm
          channels={channels}
          initial={{
            channelId: s.channelId,
            alertsEnabled: s.alertsEnabled,
            alertMinSeverity: s.alertMinSeverity,
            digestEnabled: s.digestEnabled,
            digestTime: s.digestTime,
            includeFinance: s.includeFinance,
          }}
          timeZone={s.timeZone}
          financeAllowed={s.financeAllowed}
          canManage={canManage}
          primary={!s.channelId}
          action={saveSlackSettingsAction.bind(null, org, connectionId)}
        />
      ) : (
        <p className="m-0 text-body text-ink-2">{t('inactive')}</p>
      )}
      {s.channelId ? (
        <Card className="flex flex-col gap-3">
          <h3 id="slack-preview-heading" className="m-0 text-section">
            {t('previewTitle', { channel: s.channelName ?? s.channelId })}
          </h3>
          <p className="m-0 text-caption text-ink-2">{t('previewHelp')}</p>
          <figure
            aria-labelledby="slack-preview-heading"
            className="m-0 flex flex-col gap-2 rounded-tile border border-line bg-surface-2 p-3"
            data-testid="slack-preview"
          >
            {preview.blocks.map((b, i) => (
              <PreviewBlock key={`${b.type}-${i}`} block={b} />
            ))}
          </figure>
          {s.digestEnabled && s.digestNextAt ? (
            <p className="m-0 text-body" data-testid="slack-next-digest">
              {t('nextDigest', { when: when.format(s.digestNextAt) })}
            </p>
          ) : null}
          {canSend ? (
            <form action={sendSlackTestAction.bind(null, org, connectionId)}>
              <Button type="submit">{t('sendTest')}</Button>
            </form>
          ) : null}
        </Card>
      ) : null}
      <Table
        caption={t('messagesTitle')}
        captionHidden={false}
        rowKey={(m) => m.id}
        rows={panel.messages}
        stackOnPhone
        empty={t('messagesEmpty')}
        columns={[
          { key: 'when', header: t('messages.when'), cell: (m) => when.format(m.sentAt ?? m.createdAt) },
          { key: 'kind', header: t('messages.kind'), cell: (m) => t(`kinds.${m.kind}`) },
          {
            key: 'status',
            header: t('messages.status'),
            cell: (m) => <StatusPill tone={MESSAGE_TONE[m.status]} label={t(`statuses.${m.status}`)} />,
          },
          {
            key: 'detail',
            header: t('messages.detail'),
            cell: (m) => (m.errorCode ? errorText(m.errorCode) : '—'),
          },
        ]}
      />
    </section>
  );
}
