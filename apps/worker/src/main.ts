import { setPlatformAuditSink, tryAcquireLeadership } from '@yayatoh/db/platform';
import { createNotifier } from '@yayatoh/notifications';
import { fakePaymentProvider } from '@yayatoh/payments';
import { purgeRealtimeMessages } from '@yayatoh/platform';
import { fakeDomainProvider } from '@yayatoh/tenancy';
import { sweepAlerts } from './alerts.ts';
import { runDueBulkOperations } from './bulk.ts';
import { bossRelease, campaignReleaseJob, campaignTick } from './campaigns.ts';
import { domainRecheckJob } from './domains.ts';
import { endExpiredImpersonations } from './impersonations.ts';
import { enqueueJourneyWork } from './journeys.ts';
import { enqueueDueMassRefunds, massRefundJob } from './mass-refunds.ts';
import {
  dispatchNotifications,
  dispatchStaffPushes,
  sweepOverdueTasks,
  userEmails,
  userLocales,
  workerTransports,
} from './notifications.ts';
import { runReconciliation } from './reconciliation.ts';
import { JOBS, subscribers } from './registry.ts';
import { relayOnce } from './relay.ts';
import { runRetention } from './retention.ts';
import { runSettlements } from './settlements.ts';
import { alertDisputeDeadlines, sweepExpiredHolds, sweepWaitlists } from './sweeper.ts';
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

// Stripe arrives with the owner's account; until then dev/preview use the fake provider.
const fakeSecret = process.env.FAKE_PAYMENTS_SECRET;
const payments = fakeSecret
  ? fakePaymentProvider({
      secret: fakeSecret,
      appOrigin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    })
  : null;

const SUBSCRIBERS = subscribers();
// Mass refunds (M3.10b) need the payment provider.
const jobs = payments
  ? [...JOBS, campaignReleaseJob, massRefundJob(payments)]
  : [...JOBS, campaignReleaseJob];
const boss = await startWorker({ connectionString, jobs, subscribers: SUBSCRIBERS });
console.info(`worker started: ${jobs.length} job(s), ${SUBSCRIBERS.length} subscriber(s)`);

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
  // Then waitlists (M3.10a): stock a lapsed hold just freed goes to the next person in line.
  sweepExpiredHolds()
    .catch((err) => console.error('sweeper', err))
    .then(() => sweepWaitlists())
    .catch((err) => console.error('waitlist sweeper', err));
}, 30_000).unref();

// Dispute evidence deadline alerts (M3.10c): hourly (leader only); each level is raised once.
setInterval(() => {
  if (!release || stopping) return;
  alertDisputeDeadlines().catch((err) => console.error('dispute alerts', err));
}, 3_600_000).unref();

// Staff impersonations end after an hour (M1.2e): record the end in the org's audit log (leader only).
setInterval(() => {
  if (!release || stopping) return;
  endExpiredImpersonations().catch((err) => console.error('impersonations', err));
}, 60_000).unref();

// Overdue portal tasks (M5.3a): once a minute, one event per overdue assignee (leader only).
setInterval(() => {
  if (!release || stopping) return;
  sweepOverdueTasks().catch((err) => console.error('overdue tasks', err));
}, 60_000).unref();

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

// Mass refunds (M3.10b): queue a batch job for each running run every 3 s (leader only); the
// exclusive queue keeps one job per run, and a paused run is simply not queued.
let queueingRefunds = false;
setInterval(() => {
  if (!payments || !release || stopping || queueingRefunds) return;
  queueingRefunds = true;
  enqueueDueMassRefunds(boss)
    .catch((err) => console.error('mass-refunds', err))
    .finally(() => {
      queueingRefunds = false;
    });
}, 3_000).unref();

// Journeys (M3.7a): queue a job for each org with due steps every 5 s (leader only); the
// exclusive queue keeps one job per org.
let queueingJourneys = false;
setInterval(() => {
  if (!release || stopping || queueingJourneys) return;
  queueingJourneys = true;
  enqueueJourneyWork(boss)
    .catch((err) => console.error('journeys', err))
    .finally(() => {
      queueingJourneys = false;
    });
}, 5_000).unref();

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

// Pending custom domains (M1.3f): check them again every minute on their backoff schedule, so a
// domain goes live without "Check now" (leader only; the fake provider until the owner's Vercel).
const domainJob = fakeSecret
  ? domainRecheckJob({ provider: fakeDomainProvider({ secret: fakeSecret }), payments })
  : null;
if (!domainJob)
  console.warn('domains: no domain provider configured; pending domains are checked by hand only');
let rechecking = false;
setInterval(() => {
  if (!domainJob || !release || stopping || rechecking) return;
  rechecking = true;
  domainJob
    .tick()
    .then((r) => {
      if (r && (r.checked || r.failed || r.rateLimited))
        console.info(JSON.stringify({ job: 'domains.recheck', ...r }));
    })
    .catch((err) => console.error('domains.recheck', err))
    .finally(() => {
      rechecking = false;
    });
}, 60_000).unref();

// Notifications (M1.10): send due messages every 2 s (leader only; rows are claimed with SKIP LOCKED).
const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';
const transports = workerTransports(process.env, appOrigin);
if (!transports) console.warn('notifications: no channel adapters configured; messages stay queued');
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
// Staff alert pushes (M3.4a): every 5 s (leader only; rows claimed with SKIP LOCKED).
let pushingStaff = false;
setInterval(() => {
  if (!transports || !release || stopping || pushingStaff) return;
  pushingStaff = true;
  dispatchStaffPushes(transports)
    .catch((err) => console.error('staff pushes', err))
    .finally(() => {
      pushingStaff = false;
    });
}, 5_000).unref();

// Campaigns (M3.6b): every 2 s the leader starts due schedules, hands out recipients to sending
// campaigns with the fair scheduler (pg-boss `campaigns.release` jobs) and finalizes finished ones.
let campaigning = false;
let campaignTicks = 0;
setInterval(() => {
  if (!release || stopping || campaigning) return;
  campaigning = true;
  campaignTick({ tick: campaignTicks++, release: bossRelease(boss) })
    .catch((err) => console.error('campaigns', err))
    .finally(() => {
      campaigning = false;
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

// Alert engine (M3.2b): live and pre-show events every 30 s, everything else every 5 minutes (leader only).
const alertDeps = { notifier: createNotifier() };
let sweepingAlerts = false;
let alertTicks = 0;
setInterval(() => {
  if (!release || stopping || sweepingAlerts) return;
  sweepingAlerts = true;
  const full = alertTicks++ % 10 === 0;
  sweepAlerts(alertDeps, { full })
    .then((r) => {
      if (r.changes) console.info(JSON.stringify({ job: 'alerts.sweep', full, ...r }));
    })
    .catch((err) => console.error('alerts sweep', err))
    .finally(() => {
      sweepingAlerts = false;
    });
}, 30_000).unref();

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
