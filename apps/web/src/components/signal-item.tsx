import type { FraudSignalDto } from '@yayatoh/checkin';
import { Card, StatusDot } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { SignalActionState } from '@/app/[locale]/o/[org]/e/[event]/onsite/signals/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { SignalActions } from './signal-actions.tsx';
import { SEVERITY_DOT, signalSummary } from './signal-summary.ts';

/**
 * One fraud signal (M1.9e): severity, when, where it came from, status, what tripped it, the
 * triage note, links to its order or conversation, and (for people who may triage) the
 * acknowledge/dismiss form. The Signals list and the order timeline share it.
 */
export function SignalItem({
  signal: s,
  timeZone,
  people,
  orderHref,
  threadHref,
  action,
}: {
  signal: FraudSignalDto;
  timeZone: string;
  /** Names of signed-in scanners by user id. */
  people: Readonly<Record<string, string>>;
  orderHref?: string | null;
  threadHref?: string | null;
  action: ((prev: SignalActionState, form: FormData) => Promise<SignalActionState>) | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const nameOf = (id: string) => people[id] ?? t('team.unknownUser');
  const what = `${t(`checkpoints.signal.${s.kind}`)}${signalSummary(s, t, nameOf)}`;
  return (
    <Card className="flex flex-col gap-2" data-signal={s.kind}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusDot status={SEVERITY_DOT[s.severity]} label={t(`signals.severity.${s.severity}`)} />
        <span className="text-caption text-zinc-600">{when.format(s.at)}</span>
        <span className="text-caption text-zinc-600">{t(`fraudSignals.source.${s.source}`)}</span>
        <span className="text-caption text-zinc-600" data-status={s.status}>
          {t(`signals.status.${s.status}`)}
        </span>
      </div>
      <p className="text-body">{what}</p>
      {s.resolutionNote ? (
        <p className="text-caption text-zinc-600">
          {t('fraudSignals.note.shown', { note: s.resolutionNote })}
        </p>
      ) : null}
      {orderHref || threadHref ? (
        <p className="flex flex-wrap gap-x-4 text-caption">
          {orderHref ? (
            <Link href={orderHref} className="inline-flex min-h-6 items-center underline">
              {t('fraudSignals.openOrder')}
            </Link>
          ) : null}
          {threadHref ? (
            <Link href={threadHref} className="inline-flex min-h-6 items-center underline">
              {t('fraudSignals.openConversation')}
            </Link>
          ) : null}
        </p>
      ) : null}
      {action ? (
        <SignalActions key={s.id} signalId={s.id} open={s.status === 'open'} label={what} action={action} />
      ) : null}
    </Card>
  );
}
