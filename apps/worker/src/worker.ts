import { consumeEvent, type PublishedEvent, type Subscriber } from '@yayatoh/platform';
import { PgBoss } from 'pg-boss';
import { type JobDefinition, parseJobPayload } from './jobs.ts';
import { subscriberQueue } from './relay.ts';

export interface WorkerOptions {
  readonly connectionString: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogenous job registry
  readonly jobs: readonly JobDefinition<any>[];
  readonly subscribers?: readonly Subscriber[];
}

/** Boot pg-boss, create one queue per job and subscriber, and attach validated handlers. */
export async function startWorker({
  connectionString,
  jobs,
  subscribers = [],
}: WorkerOptions): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'yayatoh:worker' });
  boss.on('error', (err) => console.error('pg-boss error', err));
  await boss.start();
  for (const job of jobs) {
    await boss.createQueue(job.name, {
      retryLimit: job.retryLimit ?? 5,
      retryBackoff: true,
      ...(job.policy ? { policy: job.policy } : {}),
    });
    await boss.work(job.name, { batchSize: 10, pollingIntervalSeconds: 1 }, async (batch) => {
      for (const j of batch) await job.handler(parseJobPayload(job, j.data), { id: j.id, name: j.name });
    });
  }
  for (const sub of subscribers) {
    const queue = subscriberQueue(sub);
    await boss.createQueue(queue, { retryLimit: 10, retryBackoff: true });
    await boss.work<{ orgId: string; event: PublishedEvent }>(
      queue,
      { batchSize: 25, pollingIntervalSeconds: 0.5 },
      async (batch) => {
        for (const j of batch) await consumeEvent(sub, j.data.event);
      },
    );
  }
  return boss;
}
