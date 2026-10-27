import { lobbyConsoleQuery } from '@yayatoh/engagement';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { Card, StatCard } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/networking/network-forms.tsx';
import { ports } from '@/server/ports.ts';
import { moderateLobbyAction, setLobbyAction } from './lobby-actions.ts';

/** The event lobby in the networking console: the switch (off by default), counts and reports. */
export async function LobbyConsole({
  org,
  event,
  eventId,
  ctx,
  canWrite,
}: {
  org: string;
  event: string;
  eventId: string;
  ctx: Ctx;
  canWrite: boolean;
}) {
  const c = await executeQuery(lobbyConsoleQuery, { eventId }, ctx, ports);
  const t = await getTranslations('networking.console.lobby');
  const tn = await getTranslations('networking');
  const open = c.reports.filter((r) => r.moderation === 'open');
  return (
    <section aria-labelledby="net-lobby" className="flex flex-col gap-3">
      <h2 id="net-lobby" className="text-section">
        {t('heading')}
      </h2>
      <p className="text-body text-ink-2">{c.enabled ? t('on') : t('off')}</p>
      {c.available ? null : <p className="text-body text-ink-2">{t('needsChat')}</p>}
      {canWrite ? (
        <div>
          <ActionButton
            action={setLobbyAction.bind(null, org, event, !c.enabled)}
            label={c.enabled ? t('turnOff') : t('turnOn')}
            done={c.enabled ? t('turnedOff') : t('turnedOn')}
            variant={c.enabled ? 'secondary' : 'primary'}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('stats.messages')} value={c.stats.messages} />
        <StatCard label={t('stats.today')} value={c.stats.messagesToday} />
        <StatCard label={t('stats.reports')} value={c.stats.openReports} />
      </div>
      {open.length === 0 ? (
        <p className="text-body text-ink-2">{t('noReports')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {open.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3">
                <h4 className="text-card">
                  {t('reportTitle', { reported: r.author.name, reporter: r.reporterName })}
                </h4>
                <p className="text-body text-ink-2">{tn(`reasons.${r.reason}`)}</p>
                {r.details ? (
                  <blockquote className="border-s-2 border-line-strong ps-3 text-body">
                    {r.details}
                  </blockquote>
                ) : null}
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                  {r.excerpt.map((m) => (
                    <li
                      key={m.id}
                      className={`rounded-card border p-2 text-body ${m.reported ? 'border-danger' : 'border-line'}`}
                    >
                      <span className="text-caption font-bold text-ink-2">{m.from}: </span>
                      {m.removed ? <em>{t('removedMessage')}</em> : m.body}
                    </li>
                  ))}
                </ol>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action={moderateLobbyAction.bind(null, org, event, r.id, 'remove')}
                      label={t('remove')}
                      done={t('removed')}
                      variant="danger"
                    />
                    <ActionButton
                      action={moderateLobbyAction.bind(null, org, event, r.id, 'hide')}
                      label={t('hide')}
                      done={t('hidden')}
                      variant="danger"
                    />
                    <ActionButton
                      action={moderateLobbyAction.bind(null, org, event, r.id, 'dismiss')}
                      label={t('dismiss')}
                      done={t('dismissed')}
                    />
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
