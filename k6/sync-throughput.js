// Integration sync throughput (M6.x): the sync engine pulls a provider's contacts into the CRM
// through the fake IntegrationAuth port and the demo connector (no network, no vendor account).
// The numbers are for one `next start` process and Postgres on the same machine; they size the
// worker's pg-boss `integrations.sync` jobs (exclusive per connection), not the vendors' limits.
//
//   k6 run -e BASE_URL=http://localhost:3000 k6/sync-throughput.js
// Knobs: RECORDS (default 1500; a run pulls at most 1 000 (20 pages of 50), the next continues), ROUNDS (default 3).
import { check } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { BASE } from './lib.js';

const RECORDS = Number(__ENV.RECORDS || 1500);
const ROUNDS = Number(__ENV.ROUNDS || 3);
const syncMs = new Trend('sync_ms', true);
const perSecond = new Trend('records_per_second');
const pulled = new Counter('records_pulled');

export const options = {
  scenarios: { sync: { executor: 'per-vu-iterations', vus: 1, iterations: ROUNDS, maxDuration: '15m' } },
  thresholds: {
    // Roadmap §10: a 1 500-contact pull is background work, but it must stay well inside a worker
    // job's budget and never lose a record.
    sync_ms: ['p(95)<60000'],
    records_per_second: ['p(5)>25'],
    checks: ['rate==1'],
  },
};

export default function () {
  const load = http.post(
    `${BASE}/api/dev/integrations/load`,
    { records: String(RECORDS) },
    { timeout: '120s' },
  );
  if (!check(load, { 'connected and seeded': (r) => r.status === 200 })) return;
  const { connectionId } = load.json();
  // One run pulls at most 20 pages of 50 (engine MAX_PAGES); the cursor carries on in the next run.
  let total = 0;
  let failed = 0;
  let ms = 0;
  let last = {};
  for (let i = 0; i < 6 && total < RECORDS; i++) {
    const run = http.post(
      `${BASE}/api/dev/integrations/load`,
      { action: 'run', connection: connectionId },
      { timeout: '600s' },
    );
    last = run.status === 200 ? run.json() : {};
    total += last.pulled || 0;
    failed = Math.max(failed, last.failed || 0); // the one broken demo record is retried every run
    ms += last.ms || 0;
    if (!last.pulled) break;
  }
  const body = { pulled: total, failed, ms, status: last.status };
  check(body, {
    'run finished': (b) => b.status === 'succeeded' || b.status === 'partial',
    // The demo seed has one record the mapping rejects (broken-record); load records are all valid.
    'every record pulled': (b) => b.pulled >= RECORDS,
    'no failures beyond the demo seed': (b) => b.failed <= 1,
  });
  syncMs.add(body.ms || 0);
  pulled.add(body.pulled || 0);
  if (body.ms > 0) perSecond.add((body.pulled * 1000) / body.ms);
}
