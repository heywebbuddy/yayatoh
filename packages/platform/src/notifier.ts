import type { TenantTx } from '@yayatoh/db';

/**
 * Outbound notification port (roadmap §6.4 MessageIntent). Modules describe *what* to send; the
 * notifications module (M1.10) records one delivery per channel under a dedupe key, applies the
 * policy gate (suppressions, preferences, quiet hours, the org kill switch), renders the template
 * per locale and hands it to a channel adapter. Enqueueing happens inside the caller's tenant
 * transaction, so a rolled-back command never sends and a replayed event never sends twice.
 */
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationRecipient {
  readonly email?: string | null;
  /** E.164, for SMS. */
  readonly phone?: string | null;
  /** A signed-in user (members, buyers with accounts): preferences, push tokens and the inbox. */
  readonly userId?: string | null;
  readonly name?: string | null;
  readonly locale?: string | null;
  /** IANA zone used for quiet hours; falls back to the event's, then the org's. */
  readonly timeZone?: string | null;
}

export interface NotificationIntent {
  /** Message kind from the notifications registry, e.g. `orders.tickets`. */
  readonly kind: string;
  readonly to: NotificationRecipient;
  readonly params: Readonly<Record<string, string | number>>;
  /** Unique per org and channel: the same key never delivers twice (e.g. `order-tickets:{id}`). */
  readonly dedupeKey: string;
  /** Defaults to the kind's channels. */
  readonly channels?: readonly NotificationChannel[];
  /** Links the message to an order (the per-order message log) and/or an event. */
  readonly orderId?: string | null;
  readonly eventId?: string | null;
  /** Multi-date events: the date the message is about (reminders follow its start time). */
  readonly occurrenceId?: string | null;
  /** Not before this time (reminders). */
  readonly sendAfter?: Date | null;
}

/** A notification for org members, fanned out by role per the kind's category. */
export interface MemberNotificationIntent {
  readonly kind: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly dedupeKey: string;
  /** Console path the inbox item links to, e.g. `/e/{slug}/orders/{id}` (org-relative). */
  readonly href?: string | null;
  readonly orderId?: string | null;
  readonly eventId?: string | null;
}

export interface Notifier {
  /** Record the intent's deliveries (one per channel) inside the caller's tenant transaction. */
  enqueue(tx: TenantTx, intent: NotificationIntent): Promise<{ readonly queued: number }>;
  notifyMembers(tx: TenantTx, intent: MemberNotificationIntent): Promise<{ readonly queued: number }>;
}

/** Test adapter: records intents instead of queueing them. */
export function memoryNotifier() {
  const sent: NotificationIntent[] = [];
  const members: MemberNotificationIntent[] = [];
  const notifier: Notifier = {
    async enqueue(_tx, intent) {
      sent.push(intent);
      return { queued: 1 };
    },
    async notifyMembers(_tx, intent) {
      members.push(intent);
      return { queued: 1 };
    },
  };
  return { notifier, sent, members };
}
