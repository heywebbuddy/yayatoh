import { formatMoney, money } from '@yayatoh/kernel';
import type { OrderTimelineDto } from '@yayatoh/reports';
import { getTranslations } from 'next-intl/server';

/**
 * The unified order timeline (M3.10b): every moment of an order oldest first, in the event's
 * timezone (named once above the list). Codes are worded where the console has words for them
 * and shown as they are otherwise (machine values, never free text from elsewhere).
 */
export async function OrderTimeline({
  timeline,
  locale,
  memberNames,
}: {
  timeline: OrderTimelineDto;
  locale: string;
  /** `user:<id>` → the member's name (note authors). */
  memberNames: ReadonlyMap<string, string>;
}) {
  const t = await getTranslations();
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeline.timezone,
  });
  const fmt = (minor: number) => formatMoney(money(minor, timeline.currency), locale);
  const word = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const details = (i: OrderTimelineDto['items'][number]): string[] => {
    const out: string[] = [];
    if (i.amountMinor !== null) out.push(fmt(i.amountMinor));
    switch (i.kind) {
      case 'payment_received':
        if (i.code) out.push(word(`refunds.soldBy.${i.code}`, word(`boxOffice.method.${i.code}`, i.code)));
        break;
      case 'ticket_voided':
        if (i.code) out.push(word(`refundOps.timeline.voidReasons.${i.code}`, i.code));
        break;
      case 'refund_started':
      case 'refund_succeeded':
        if (i.code) out.push(word(`refunds.reasons.${i.code}`, i.code));
        break;
      case 'refund_failed':
        if (i.code) out.push(i.code);
        break;
      case 'message': {
        const [kind = '', status = ''] = (i.code ?? '').split('|');
        out.push(word(`notifications.kinds.${kind}`, kind), word(`notifications.status.${status}`, status));
        break;
      }
      case 'check_in':
        if (i.code === 'offline') out.push(t('refundOps.timeline.offline'));
        break;
      case 'scan_refused':
        if (i.code) out.push(word(`checkin.result.${i.code}`, i.code));
        break;
      case 'refund_requested':
        out.push(t('refundOps.request.tickets', { count: Number(i.code ?? 0) }));
        break;
      case 'dispute_opened':
        if (i.code) out.push(i.code);
        break;
      // M3.10c: a credit note's disposition, a macro's actions (its name is the text).
      case 'credit_note_issued':
        if (i.code) out.push(word(`supportTools.credit.disposition.${i.code}`, i.code));
        break;
      case 'macro_run':
        out.push(
          ...(i.code ?? '')
            .split(',')
            .filter(Boolean)
            .map((a) => word(`supportTools.macros.action.${a}`, a)),
        );
        break;
      default:
        break;
    }
    if ((i.kind === 'note' || i.kind === 'macro_run') && i.who)
      out.push(memberNames.get(i.who) ?? t('refundOps.timeline.someone'));
    else if (i.who) out.push(i.who);
    if (i.text)
      out.push(
        ['note', 'message', 'credit_note_issued', 'credit_applied', 'credit_released', 'macro_run'].includes(
          i.kind,
        )
          ? i.text
          : `“${i.text}”`,
      );
    return out;
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-zinc-500">
        {t('refundOps.timeline.zone', { zone: timeline.timezone })}
      </p>
      <ol className="flex list-none flex-col gap-0 border-s border-zinc-200 p-0">
        {timeline.items.map((i, n) => (
          <li
            // Items have no id of their own; their position in this server-rendered list is stable.
            key={`${i.kind}-${i.at.getTime()}-${n}`}
            className="relative flex flex-col gap-0.5 ps-5 pb-4 before:absolute before:start-[-5px] before:top-1.5 before:size-2.5 before:rounded-full before:bg-zinc-300"
          >
            <span className="text-caption text-zinc-500">
              <time dateTime={i.at.toISOString()}>{when.format(i.at)}</time>
            </span>
            <span className="text-body">
              {t(`refundOps.timeline.kinds.${i.kind}`, { serial: i.ticketSerial ?? 0 })}
            </span>
            {details(i).length ? (
              <span className="whitespace-pre-line break-words text-caption text-zinc-600">
                {details(i).join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
