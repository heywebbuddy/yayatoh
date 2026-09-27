import { PgBoss } from 'pg-boss';
import { type JobDefinition, parseJobPayload } from './jobs.ts';

export interface WorkerOptions {
  readonly connectionString: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogenous job registry
  readonly jobs: readonly JobDefinition<any>[];
}

/** Boot pg-boss, create one queue per job and attach validated handlers. */
export async function startWorker({ connectionString, jobs }: WorkerOptions): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'yayatoh:worker' });
  boss.on('error', (err) => console.error('pg-boss error', err));
  await boss.start();
  for (const job of jobs) {
    await boss.createQueue(job.name, { retryLimit: job.retryLimit ?? 5, retryBackoff: true });
    await boss.work(job.name, async (batch) => {
      for (const j of batch) await job.handler(parseJobPayload(job, j.data), { id: j.id, name: j.name });
    });
  }
  return boss;
}
