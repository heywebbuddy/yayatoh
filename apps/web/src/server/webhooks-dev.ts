import 'server-only';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { consumeEvent, processedPairsTx, recentEventsTx } from '@yayatoh/platform';
import { PUBLIC_SOURCES, webhookPublisherSubscriber, webhooksRuntime } from '@yayatoh/webhooks';
import './ports.ts';

/**
 * Development and CI only (`/api/dev/webhooks/drain`): hand this org's recent public events to the
 * webhook publisher now, as the worker's relay would, and run the fake publisher's due retries.
 * Its own drain, apart from the message drain, so the shared e2e org's message events are never
 * crowded out of that drain's window. Exactly-once holds through processed_events.
 */
export async function drainOrgWebhooks(orgId: string): Promise<{ published: number; retried: number }> {
  const publisher = webhooksRuntime().publisher;
  const sub = webhookPublisherSubscriber({ publisher: () => publisher });
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'dev.webhooks-drain' } });
  const types = [...new Set(PUBLIC_SOURCES.map((k) => k.split('@')[0] as string))];
  const events = await withTenant(ctx, (tx) => recentEventsTx(tx, orgId, types, 3600_000));
  const done = await withTenant(ctx, (tx) =>
    processedPairsTx(
      tx,
      [sub.name],
      events.map((e) => e.id),
    ),
  );
  let published = 0;
  for (const e of events)
    if (
      sub.events.includes(`${e.type}@${e.version}`) &&
      !done.has(`${sub.name}|${e.id}`) &&
      (await consumeEvent(sub, e))
    )
      published += 1;
  const retried =
    publisher && 'runDueRetries' in publisher
      ? await (publisher as { runDueRetries: () => Promise<number> }).runDueRetries()
      : 0;
  return { published, retried };
}
