// Warehouse ingest (M6.x): rebuild an org's analytics rollups from the source tables (the
// `analytics.backfill` job, drained without its pacing by the dev route), the heaviest write path
// of the `AnalyticsWarehouse` port. Postgres rollups by default; set `ANALYTICS_WAREHOUSE=tinybird`
// on the server for the fake Tinybird adapter. Run after `load:prepare` so the org has tickets.
//
//   k6 run -e BASE_URL=http://localhost:3000 k6/warehouse-ingest.js
import { check } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { BASE } from './lib.js';

const ROUNDS = Number(__ENV.ROUNDS || 3);
const rebuildMs = new Trend('rebuild_ms', true);
const eventsPerSecond = new Trend('events_per_second');
const events = new Counter('events_ingested');

export const options = {
  scenarios: { ingest: { executor: 'per-vu-iterations', vus: 1, iterations: ROUNDS, maxDuration: '15m' } },
  thresholds: {
    // A full rebuild of the busiest seeded org is minutes of background work at worst.
    rebuild_ms: ['p(95)<120000'],
    // The second and later rebuilds are idempotent: same snapshots, nothing rewritten (checked below).
    checks: ['rate==1'],
  },
};

let firstWritten = -1;

export default function () {
  const res = http.post(
    `${BASE}/api/dev/analytics/backfill`,
    { org: __ENV.ORG || 'lakeside-events', start: '1' },
    { timeout: '900s' },
  );
  const body = res.status === 200 ? res.json() : {};
  check(res, {
    'rebuild finished': () => body.state === 'done',
    'events were read': () => body.events > 0,
  });
  rebuildMs.add(body.ms || 0);
  events.add(body.events || 0);
  if (body.ms > 0) eventsPerSecond.add((body.events * 1000) / body.ms);
  if (firstWritten < 0) firstWritten = body.written;
  else
    check(body, { 'idempotent: a repeat rewrites no more than the first': (b) => b.written <= firstWritten });
}
