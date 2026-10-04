import { createCtx, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type PublishedEvent } from '@yayatoh/platform';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { connections, slackMessages, slackSettings } from '../schema.ts';
import { SLACK_SEVERITIES } from './render.ts';
import { SLACK_CONNECTOR } from './settings.ts';

/**
 * The M3.2b alert engine's "this alert was sent" event (emitted by the alerts module, read here
 * through the outbox: same tier). Ids, a rule key, a severity, a count and the org-relative page
 * that fixes it: no personal data.
 */
export const ALERT_NOTIFIED_EVENT = 'alerts.alert_notified';
export const AlertNotifiedPayload = z.object({
  orgId: z.uuid(),
  alertId: z.uuid(),
  rule: z.string().regex(/^[a-zA-Z]{1,40}$/),
  severity: z.enum(SLACK_SEVERITIES),
  count: z.int(),
  eventId: z.uuid().nullable(),
  /** Which sending of the alert this is (an alert re-sent after its acknowledgement timed out). */
  notifyCount: z.int().min(0),
  /** The org-relative console page that fixes it. */
  href: z.string().regex(/^\/[A-Za-z0-9/_\-.?=&]{0,200}$/),
});

const RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Queue an alert for every active Slack connection whose alerts are on and whose threshold the
 * alert meets (M6.4c). One message per (connection, channel, alert sending): a replayed event,
 * or the same sending seen twice, queues nothing more. The dispatcher sends it.
 */
export const slackAlertsSubscriber = defineSubscriber({
  name: 'integrations.slack-alerts',
  events: ['alerts.alert_notified@1'],
  handle: async (tx, event: PublishedEvent) => {
    const p = AlertNotifiedPayload.safeParse(event.payload);
    if (!p.success) return;
    const a = p.data;
    const ctx = createCtx({
      orgId: event.orgId,
      actor: { type: 'system', name: 'integrations.slack-alerts' },
    });
    const orgId = requireOrg(ctx);
    const targets = await tx
      .select({
        connectionId: slackSettings.connectionId,
        channelId: slackSettings.channelId,
        minSeverity: slackSettings.alertMinSeverity,
      })
      .from(slackSettings)
      .innerJoin(
        connections,
        and(eq(connections.orgId, slackSettings.orgId), eq(connections.id, slackSettings.connectionId)),
      )
      .where(
        and(
          eq(slackSettings.alertsEnabled, true),
          isNotNull(slackSettings.channelId),
          eq(connections.status, 'active'),
          eq(connections.connector, SLACK_CONNECTOR),
        ),
      );
    const rows = targets.flatMap((t) =>
      t.channelId && (RANK[a.severity] ?? 0) >= (RANK[t.minSeverity] ?? 1)
        ? [
            {
              orgId,
              connectionId: t.connectionId,
              channelId: t.channelId,
              kind: 'alert',
              dedupeKey: `alert:${a.alertId}:${a.notifyCount}`,
              payload: {
                alertId: a.alertId,
                rule: a.rule,
                severity: a.severity,
                count: a.count,
                eventId: a.eventId,
                href: a.href,
              },
              nextAttemptAt: ctx.now,
            },
          ]
        : [],
    );
    if (rows.length) await tx.insert(slackMessages).values(rows).onConflictDoNothing();
  },
});
