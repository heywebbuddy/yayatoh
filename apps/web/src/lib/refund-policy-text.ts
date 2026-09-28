import { formatMoney, money } from '@yayatoh/kernel';
import type { RefundPolicyDto } from '@yayatoh/orders';

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * The buyer-facing words for an event's refund policy (M1.6e), shown on the event page and the
 * order page: what the organizer allows, what they keep, and the platform minimum, which always
 * applies. Deadlines are shown in the event's timezone, with the zone.
 */
export function refundPolicyLines(t: T, policy: RefundPolicyDto, locale: string): string[] {
  const deadline = policy.deadline
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: policy.timezone,
        timeZoneName: 'short',
      }).format(policy.deadline)
    : null;
  const lines = [
    policy.kind === 'none'
      ? t('none')
      : policy.kind === 'always'
        ? t('always')
        : t('until', { deadline: deadline ?? '', days: policy.daysBefore ?? 0 }),
  ];
  if (policy.kind !== 'none' && policy.retainedMinor > 0)
    lines.push(t('retained', { amount: formatMoney(money(policy.retainedMinor, policy.currency), locale) }));
  if (policy.kind !== 'none') lines.push(t('feeKept'));
  lines.push(t('minimum'));
  return lines;
}
