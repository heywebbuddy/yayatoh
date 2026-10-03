import { chatConsoleQuery } from '@yayatoh/engagement';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { Card, StatCard, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/networking/network-forms.tsx';
import { ports } from '@/server/ports.ts';
import { moderateChatAction, removeChatMessageAction, restoreBoothChatAction } from './chat-actions.ts';

/**
 * The chat part of the networking console (M5.8b). Organizers never read chats: they see counts,
 * and each reported conversation as an excerpt (the latest messages up to the report, names as
 * people chose them). With `events:write` they remove a message, hide the reported person or
 * suspend the reported booth's chat, or dismiss; and lift a booth's suspension.
 */
export async function ChatConsole({
  org,
  event,
  eventId,
  ctx,
  canWrite,
  locale,
  timeZone,
}: {
  org: string;
  event: string;
  eventId: string;
  ctx: Ctx;
  canWrite: boolean;
  locale: string;
  timeZone: string;
}) {
  const c = await executeQuery(chatConsoleQuery, { eventId }, ctx, ports);
  const t = await getTranslations('networking.console.chat');
  const tn = await getTranslations('networking');
  const when = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  const open = c.reports.filter((r) => r.moderation === 'open');
  const closed = c.reports.filter((r) => r.moderation !== 'open');
  return (
    <section aria-labelledby="net-chat" className="flex flex-col gap-3">
      <h2 id="net-chat" className="text-section">
        {t('heading')}
      </h2>
      <p className="text-body text-ink-2">{c.chatEnabled ? t('on') : t('off')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('stats.conversations')} value={c.stats.conversations} />
        <StatCard label={t('stats.messagesToday')} value={c.stats.messagesToday} />
        <StatCard label={t('stats.openReports')} value={c.stats.openReports} />
        <StatCard label={t('stats.booths')} value={c.stats.boothsTakingChats} />
      </div>
      <h3 className="text-card">{t('reports')}</h3>
      {open.length === 0 ? (
        <p className="text-body text-ink-2">{t('noReports')}</p>
      ) : (
        <ul aria-label={t('openReports')} className="flex list-none flex-col gap-3 p-0">
          {open.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3" data-chat-report={r.id}>
                <h4 className="text-card">
                  {t(r.kind === 'booth' ? 'reportTitleBooth' : 'reportTitle', {
                    reported: r.reported.name,
                    reporter: r.reporterName,
                  })}
                </h4>
                <p className="text-body text-ink-2">
                  {tn(`reasons.${r.reason}`)} · {when.format(r.createdAt)}
                </p>
                {r.details ? (
                  <blockquote className="border-s-2 border-line-strong ps-3 text-body text-ink">
                    {r.details}
                  </blockquote>
                ) : null}
                <ol aria-label={t('excerpt')} className="m-0 flex list-none flex-col gap-2 p-0">
                  {r.excerpt.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-1 rounded-card border border-line bg-surface-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-caption font-bold text-ink-2">
                          {m.from} · <time dateTime={m.at.toISOString()}>{time.format(m.at)}</time>
                        </span>
                        {m.removed ? (
                          <span className="text-body italic text-ink-2">{t('removedMessage')}</span>
                        ) : (
                          <span className="text-body whitespace-pre-wrap break-words text-ink">{m.body}</span>
                        )}
                      </div>
                      {canWrite && !m.removed ? (
                        <ActionButton
                          action={removeChatMessageAction.bind(null, org, event, m.id)}
                          label={t('remove')}
                          accessibleName={t('removeFrom', { name: m.from, time: time.format(m.at) })}
                          done={t('removed')}
                          variant="ghost"
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action={moderateChatAction.bind(null, org, event, r.id, 'hide')}
                      label={r.reported.kind === 'person' ? t('hide') : t('suspend')}
                      accessibleName={
                        r.reported.kind === 'person'
                          ? t('hideName', { name: r.reported.name })
                          : t('suspendName', { name: r.reported.name })
                      }
                      done={
                        r.reported.kind === 'person'
                          ? t('hidden', { name: r.reported.name })
                          : t('suspended', { name: r.reported.name })
                      }
                      variant="danger"
                    />
                    <ActionButton
                      action={moderateChatAction.bind(null, org, event, r.id, 'dismiss')}
                      label={t('dismiss')}
                      accessibleName={t('dismissReport', { name: r.reported.name })}
                      done={t('dismissed')}
                    />
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {closed.length ? (
        <details>
          <summary className="min-h-10 cursor-pointer content-center font-bold">
            {t('closedReports', { count: closed.length })}
          </summary>
          <ul className="flex list-none flex-col gap-2 p-0 pt-3">
            {closed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-body">
                <StatusPill
                  tone={r.moderation === 'actioned' ? 'danger' : 'neutral'}
                  label={t(`moderation.${r.moderation}`)}
                />
                {t(r.kind === 'booth' ? 'reportTitleBooth' : 'reportTitle', {
                  reported: r.reported.name,
                  reporter: r.reporterName,
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <h3 className="text-card">{t('suspendedBooths')}</h3>
      {c.suspendedBooths.length === 0 ? (
        <p className="text-body text-ink-2">{t('noSuspended')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {c.suspendedBooths.map((b) => (
            <li key={b.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-body font-bold text-ink">{b.name}</span>
                {canWrite ? (
                  <ActionButton
                    action={restoreBoothChatAction.bind(null, org, event, b.id)}
                    label={t('restore')}
                    accessibleName={t('restoreName', { name: b.name })}
                    done={t('restored', { name: b.name })}
                  />
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
