/**
 * Delivery reports → suppression (M1.10d). Pure rules, unit-tested:
 * - a hard bounce suppresses the address at once (it does not exist);
 * - a complaint suppresses it at once (the person marked the mail as spam);
 * - soft bounces (mailbox full, greylisting) suppress only when they repeat: the third within
 *   14 days with no delivery since the first of them;
 * - a delivery never suppresses (and resets the soft-bounce count).
 */
export type DeliveryEventType = 'delivered' | 'bounced' | 'complained';
export type BounceType = 'hard' | 'soft';
export type SuppressionReason = 'hard_bounce' | 'soft_bounce' | 'complaint';
export type DeliveryState = 'delivered' | 'bounced' | 'soft_bounced' | 'complained';

export interface DeliveryFact {
  readonly type: DeliveryEventType;
  readonly bounceType?: BounceType | null;
  readonly occurredAt: Date;
}

export const SOFT_BOUNCE_LIMIT = 3;
export const SOFT_BOUNCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Whether this event (with the address's earlier events) puts the address on the list. */
export function suppressionFor(
  event: DeliveryFact,
  history: readonly DeliveryFact[],
): SuppressionReason | null {
  if (event.type === 'complained') return 'complaint';
  if (event.type !== 'bounced') return null;
  if (event.bounceType === 'hard') return 'hard_bounce';
  const since = event.occurredAt.getTime() - SOFT_BOUNCE_WINDOW_MS;
  const recent = [...history, event]
    .filter((e) => e.occurredAt.getTime() >= since && e.occurredAt.getTime() <= event.occurredAt.getTime())
    .sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
  let soft = 0;
  for (const e of recent) {
    if (e.type === 'delivered') soft = 0;
    else if (e.type === 'bounced' && e.bounceType !== 'hard') soft += 1;
  }
  return soft >= SOFT_BOUNCE_LIMIT ? 'soft_bounce' : null;
}

/**
 * The message's delivery state after an event: the worst news wins, so a late "delivered" never
 * hides a bounce or complaint; a soft bounce the provider later retried successfully is delivered.
 */
const RANK: Record<DeliveryState, number> = { delivered: 1, soft_bounced: 2, bounced: 3, complained: 4 };

export function deliveryStateOf(event: DeliveryFact): DeliveryState {
  if (event.type === 'bounced') return event.bounceType === 'hard' ? 'bounced' : 'soft_bounced';
  return event.type;
}

export function nextDeliveryState(current: string | null, event: DeliveryFact): DeliveryState {
  const next = deliveryStateOf(event);
  const cur = current && current in RANK ? (current as DeliveryState) : null;
  if (cur === 'soft_bounced' && next === 'delivered') return next;
  return cur && RANK[cur] >= RANK[next] ? cur : next;
}

/** The dispatcher's reason for a message to a suppressed address (shown in the message log). */
export function suppressedReason(reason: string): 'bounced' | 'complained' {
  return reason === 'complaint' ? 'complained' : 'bounced';
}
