import { setPlatformAuditSink, tryAcquireLeadership } from '@yayatoh/db/platform';
import { runDueBulkOperations } from './bulk.ts';
import { JOBS, subscribers } from './registry.ts';
import { relayOnce } from './relay.ts';
import { sweepExpiredHolds } from './sweeper.ts';
import { startWorker } from './worker.ts';

const connectionString = process.env.JOBS_DATABASE_URL;
if (!connectionString) throw new Error('JOBS_DATABASE_URL is not set (see .env.example)');

// Platform (BYPASSRLS) access is audited as structured log lines, shipped to Axiom once M0.1 accounts exist.
// The relay's per-tick access is summarised once a minute to keep the log readable.
const counts = new Map<string, number>();
setPlatformAuditSink(async ({ actor, reason }) => {
  const key = `${actor}|${reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
});
setInterval(() => {
  for (const [key, n] of counts) {
    const [actor, reason] = key.split('|');
    console.info(JSON.stringify({ audit: 'platform_reader', actor, reason, count: n, window: '60s' }));
  }
  counts.clear();
}, 60_000).unref();

const SUBSCRIBERS = subscribers();
const boss = await startWorker({ connectionString, jobs: JOBS, subscribers: SUBSCRIBERS });
console.info(`worker started: ${JOBS.length} job(s), ${SUBSCRIBERS.length} subscriber(s)`);

let release: (() => Promise<void>) | null = null;
let stopping = false;
async function loop() {
  while (!stopping) {
    if (!release) release = await tryAcquireLeadership('platform.outbox_relay');
    let n = 0;
    if (release) {
      try {
        n = await relayOnce(boss, SUBSCRIBERS);
      } catch (err) {
        console.error('relay', err);
      }
    }
    await new Promise((r) => setTimeout(r, n > 0 ? 50 : release ? 500 : 5_000));
  }
}
void loop();

// Release lapsed checkout holds every 30 s (leader only, so one sweeper runs at a time).
setInterval(() => {
  if (!release || stopping) return;
  sweepExpiredHolds().catch((err) => console.error('sweeper', err));
}, 30_000).unref();

// Bulk actions and exports (M1.8b): keep unfinished operations moving (leader only).
let bulkBusy = false;
setInterval(() => {
  if (!release || stopping || bulkBusy) return;
  bulkBusy = true;
  runDueBulkOperations()
    .catch((err) => console.error('bulk', err))
    .finally(() => {
      bulkBusy = false;
    });
}, 2_000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopping = true;
    await release?.();
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  });
}
