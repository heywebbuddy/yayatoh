import { setPlatformAuditSink, tryAcquireLeadership } from '@yayatoh/db/platform';
import { fakePaymentProvider } from '@yayatoh/payments';
import { purgeRealtimeMessages } from '@yayatoh/platform';
import { runDueBulkOperations } from './bulk.ts';
import { dispatchNotifications, userEmails, userLocales, workerTransports } from './notifications.ts';
import { runReconciliation } from './reconciliation.ts';
import { JOBS, subscribers } from './registry.ts';
import { relayOnce } from './relay.ts';
import { runRetention } from './retention.ts';
import { runSettlements } from './settlements.ts';
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

// Payout Release job (M1.6c): release due funds and transfer them, every 10 minutes (leader only).
// Stripe arrives with the owner's account; until then dev/preview use the fake provider.
const fakeSecret = process.env.FAKE_PAYMENTS_SECRET;
const payments = fakeSecret
  ? fakePaymentProvider({
      secret: fakeSecret,
      appOrigin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    })
  : null;
if (!payments) console.warn('settlements: no payment provider configured; the release job is off');
let settling = false;
setInterval(() => {
  if (!payments || !release || stopping || settling) return;
  settling = true;
  runSettlements(payments)
    .then((r) => {
      if (r.transferred || r.failed) console.info(JSON.stringify({ job: 'settlements', ...r }));
    })
    .catch((err) => console.error('settlements', err))
    .finally(() => {
      settling = false;
    });
}, 10 * 60_000).unref();

// Daily reconciliation (M1.6e): the previous UTC day, hourly attempts (idempotent per org and
// day, so only the first run of a day does work), leader only. The fake provider without a
// balance store cannot list balance transactions: the job then does nothing.
let reconciling = false;
const reconcile = () => {
  if (!payments || !release || stopping || reconciling) return;
  reconciling = true;
  runReconciliation(payments)
    .then((r) => {
      if (r?.items || r?.unattributed) console.info(JSON.stringify({ job: 'reconciliation', ...r }));
    })
    .catch((err) => console.error('reconciliation', err))
    .finally(() => {
      reconciling = false;
    });
};
setTimeout(reconcile, 5 * 60_000).unref();
setInterval(reconcile, 3_600_000).unref();

// Notifications (M1.10): send due messages every 2 s (leader only; rows are claimed with SKIP LOCKED).
const transports = workerTransports();
if (!transports) console.warn('notifications: no channel adapters configured; messages stay queued');
const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';
let dispatching = false;
setInterval(() => {
  if (!transports || !release || stopping || dispatching) return;
  dispatching = true;
  dispatchNotifications({ transports, appOrigin, userEmails, userLocales })
    .catch((err) => console.error('notifications', err))
    .finally(() => {
      dispatching = false;
    });
}, 2_000).unref();
// Retention (M1.14c): once a day, first run 10 minutes after start (leader only).
let retaining = false;
const retain = () => {
  if (!release || stopping || retaining) return;
  retaining = true;
  runRetention()
    .then((r) => console.info(JSON.stringify({ job: 'retention', ...r })))
    .catch((err) => console.error('retention', err))
    .finally(() => {
      retaining = false;
    });
};
setTimeout(retain, 10 * 60_000).unref();
setInterval(retain, 24 * 3_600_000).unref();

// Realtime message log (M3.1b): keep an hour for resumptions; prune every 5 minutes (leader only).
setInterval(() => {
  if (!release || stopping) return;
  purgeRealtimeMessages().catch((err) => console.error('realtime purge', err));
}, 5 * 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopping = true;
    await release?.();
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  });
}
