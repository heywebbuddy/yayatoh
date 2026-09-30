import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, type DomainEvent } from '@yayatoh/kernel';
import { defineSubscriber, emitEvents, type Notifier } from '@yayatoh/platform';
import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BLOCK_REPEAT_WINDOW_MS,
  chatReportSignal,
  checkoutRiskSignal,
  type MappedSignal,
  shouldAlert,
  signalSubject,
} from './fraud-rules.ts';
import { type FraudSeverity, type FraudSource, fraudSignals } from './schema.ts';

/**
 * M1.9e: other modules' outcomes become fraud signals here, through the outbox (one model with
 * the door's signals): checkout risk reviews and blocks (orders), chat reports (messaging). Each
 * source event raises at most one signal (`source_event_id` is unique), and every new signal is
 * announced as `checkin.fraud_signal@1`, which the alert subscriber turns into a team alert.
 */

const RULE_ID = z.string().regex(/^[a-z_]{1,60}$/);
const RiskFlagged = z.object({
  orgId: z.uuid(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  contactId: z.uuid().nullable(),
  rules: z.array(RULE_ID).max(10),
});
const CheckoutBlocked = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  contactId: z.uuid().nullable(),
  rules: z.array(RULE_ID).max(10),
  emailOrders: z.int().min(0),
  paymentFailures: z.int().min(0),
});
const ReportFiled = z.object({
  orgId: z.uuid(),
  reportId: z.uuid(),
  threadId: z.uuid(),
  eventId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  reporter: z.enum(['organizer', 'contact']),
  reason: z.enum(['spam', 'abuse', 'other']),
});

export const signalRaisedEvent = (s: {
  orgId: string;
  eventId: string | null;
  signalId: string;
  kind: string;
  severity: FraudSeverity;
  source: FraudSource;
}): DomainEvent => ({
  type: 'checkin.fraud_signal',
  version: 1,
  aggregateType: s.eventId ? 'event' : 'org',
  aggregateId: s.eventId ?? s.orgId,
  payload: s,
});

/** Insert a signal raised by a source event (once per event) and announce it on the outbox. */
async function raiseFromSourceTx(
  tx: TenantTx,
  subscriber: string,
  s: MappedSignal & {
    orgId: string;
    source: FraudSource;
    sourceEventId: string;
    eventId: string | null;
    orderId?: string | null;
    contactId?: string | null;
    threadId?: string | null;
    detail: Record<string, string | number>;
  },
): Promise<string | null> {
  const [row] = await tx
    .insert(fraudSignals)
    .values({
      orgId: s.orgId,
      eventId: s.eventId,
      kind: s.kind,
      severity: s.severity,
      source: s.source,
      sourceEventId: s.sourceEventId,
      orderId: s.orderId ?? null,
      contactId: s.contactId ?? null,
      threadId: s.threadId ?? null,
      detail: s.detail,
      raisedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: fraudSignals.id });
  if (!row) return null;
  const ctx = createCtx({ orgId: s.orgId, actor: { type: 'system', name: subscriber } });
  await emitEvents(tx, ctx, [
    signalRaisedEvent({
      orgId: s.orgId,
      eventId: s.eventId,
      signalId: row.id,
      kind: s.kind,
      severity: s.severity,
      source: s.source,
    }),
  ]);
  return row.id;
}

/** Checkout risk outcomes (M1.6e) → `purchase_velocity`, `country_mismatch`, `checkout_blocked`, `card_testing`. */
export function checkoutRiskSignals() {
  const name = 'checkin.checkout-risk-signals';
  return defineSubscriber({
    name,
    events: ['order.risk_flagged@1', 'order.checkout_blocked@1'],
    handle: async (tx, event) => {
      if (event.type === 'order.risk_flagged') {
        const p = RiskFlagged.parse(event.payload);
        if (p.rules.length === 0) return;
        await raiseFromSourceTx(tx, name, {
          ...checkoutRiskSignal('review', p.rules),
          orgId: p.orgId,
          source: 'checkout',
          sourceEventId: event.id,
          eventId: p.eventId,
          orderId: p.orderId,
          contactId: p.contactId,
          detail: { rules: p.rules.join(',') },
        });
        return;
      }
      const p = CheckoutBlocked.parse(event.payload);
      const mapped = checkoutRiskSignal('block', p.rules);
      // A card tester retries: one signal per contact (or unknown buyer) and event per window.
      const [recent] = await tx
        .select({ id: fraudSignals.id })
        .from(fraudSignals)
        .where(
          and(
            eq(fraudSignals.eventId, p.eventId),
            eq(fraudSignals.kind, mapped.kind),
            p.contactId ? eq(fraudSignals.contactId, p.contactId) : isNull(fraudSignals.contactId),
            gte(fraudSignals.raisedAt, new Date(Date.now() - BLOCK_REPEAT_WINDOW_MS)),
          ),
        )
        .limit(1);
      if (recent) return;
      await raiseFromSourceTx(tx, name, {
        ...mapped,
        orgId: p.orgId,
        source: 'checkout',
        sourceEventId: event.id,
        eventId: p.eventId,
        contactId: p.contactId,
        detail: { rules: p.rules.join(','), orders: p.emailOrders, failures: p.paymentFailures },
      });
    },
  });
}

/** Chat reports the organizer filed (M1.10) → `chat_abuse` about the contact. */
export function chatReportSignals() {
  const name = 'checkin.chat-report-signals';
  return defineSubscriber({
    name,
    events: ['messaging.report_filed@1'],
    handle: async (tx, event) => {
      const p = ReportFiled.parse(event.payload);
      const mapped = chatReportSignal(p.reporter, p.reason);
      if (!mapped) return;
      await raiseFromSourceTx(tx, name, {
        ...mapped,
        orgId: p.orgId,
        source: 'chat',
        sourceEventId: event.id,
        eventId: p.eventId,
        contactId: p.contactId,
        threadId: p.threadId,
        detail: { reason: p.reason },
      });
    },
  });
}

const SignalRaised = z.object({ orgId: z.uuid(), signalId: z.uuid().nullable() });

/**
 * High-severity signals alert the org's security team (`security.fraud_signal`: in-app, email and
 * push per each member's preferences; email waits out quiet hours). One alert per subject (and
 * event) per hour: the subject is locked while its last alert is read, so concurrent signals
 * about the same ticket or order alert once.
 */
export function fraudSignalAlerts(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'checkin.fraud-alerts',
    events: ['checkin.fraud_signal@1'],
    handle: async (tx, event) => {
      const p = SignalRaised.parse(event.payload);
      if (!p.signalId) return;
      const [s] = await tx.select().from(fraudSignals).where(eq(fraudSignals.id, p.signalId));
      if (s?.status !== 'open' || s.alertedAt) return;
      const subject = signalSubject(s);
      if (!subject) return;
      const col = {
        ticket: fraudSignals.ticketId,
        order: fraudSignals.orderId,
        contact: fraudSignals.contactId,
        thread: fraudSignals.threadId,
        device: fraudSignals.deviceId,
        user: fraudSignals.userId,
        event: fraudSignals.eventId,
      }[subject.type];
      const key = `fraud-alert:${s.eventId ?? 'org'}:${subject.type}:${subject.id}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const [last] = await tx
        .select({
          at: sql<Date | null>`max(${fraudSignals.alertedAt})`.mapWith((v) => (v ? new Date(v) : null)),
        })
        .from(fraudSignals)
        .where(
          and(
            eq(col, subject.id),
            s.eventId ? eq(fraudSignals.eventId, s.eventId) : isNull(fraudSignals.eventId),
            ne(fraudSignals.id, s.id),
          ),
        );
      if (!shouldAlert(s.severity as FraudSeverity, s.raisedAt, last?.at ?? null)) return;
      const ev = s.eventId ? await findEventTx(tx, s.eventId) : null;
      const href = ev
        ? s.orderId
          ? `/e/${ev.slug}/orders/${s.orderId}`
          : `/e/${ev.slug}/onsite/signals`
        : s.threadId
          ? `/messages/${s.threadId}`
          : null;
      await deps.notifier.notifyMembers(tx, {
        kind: 'security.fraud_signal',
        // `none`: an org-level signal (the templates leave the event out).
        params: { signal: s.kind, eventName: ev?.name ?? 'none' },
        dedupeKey: `fraud-alert:${s.id}`,
        href,
        eventId: s.eventId,
      });
      await tx.update(fraudSignals).set({ alertedAt: new Date() }).where(eq(fraudSignals.id, s.id));
    },
  });
}
