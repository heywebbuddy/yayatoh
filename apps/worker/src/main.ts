import { JOBS } from './registry.ts';
import { startWorker } from './worker.ts';

const connectionString = process.env.JOBS_DATABASE_URL;
if (!connectionString) throw new Error('JOBS_DATABASE_URL is not set (see .env.example)');
const boss = await startWorker({ connectionString, jobs: JOBS });
console.info(`worker started with ${JOBS.length} job(s)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  });
}
