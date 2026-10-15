// "scans/batch from the Staff app at 3× peak" (M7.x): door devices syncing scans, POST
// /v1/scans/batch with a device token (`yyd_…`), in the two shapes the Staff app sends:
//   - small live batches: a device that is online flushes its outbox after each scan (1–3 scans);
//   - offline outbox syncs: a device that lost its connection uploads up to 500 scans at once
//     (BATCH_SIZE in apps/staff/src/scan/engine.ts, the route's maximum).
// Build on scan.js (the online verify path); the payload is the route's schema (eventId + scans[]
// of {scanId, code, deviceTs, clockOffsetMs, verdict}), exactly what apps/staff/src/scan/api.ts sends.
//
//   pnpm --filter @yayatoh/web load:prepare        # LOAD_TICKETS=6000 for a 60 s run at 3×
//   k6 run -e BASE_URL=http://localhost:3000 k6/scan-batch-peak.js
//
// PEAK MODEL. Peak = scan.js's target, SCANS_PER_SECOND = 30 (roadmap §10 gates 20 scans/s total;
// scan.js runs 30). This run drives MULTIPLIER = 3 times that: 90 scans a second across 30 devices
// (SCAN_DEVICES). 70 % arrive as small live batches (mean 2 scans, ~32 requests a second) and
// OFFLINE_SHARE = 30 % as 500-scan outbox syncs (27 scans a second = one 500-batch every ~18 s).
//
// THRESHOLDS — which is which. The 300 ms p95 is the roadmap's *online verify* SLO (§10); a small
// live batch is one verify's worth of work (1–3 scans) and is held to it. A 500-scan batch is not
// a verify: one transaction applies 500 scans one by one under a per-event advisory lock
// (checkin.syncScans), so it is budgeted at 3 ms a scan = 1.5 s p95. That number is this
// project's, set by the M7.x brief, not by the roadmap; it still has to be small enough that a
// device at the door finishes a sync well inside the 30 s heartbeat interval.
//
// IDEMPOTENCY. Every 500-batch is posted twice (a phone retrying after a lost response), and every
// REPLAY_EVERY-th small batch too. The second answer must have `stored: false` for every scan
// (the server found each scanId and applied nothing), `duplicatesOffline: 0`, and the very same
// verdicts. Rate `replay_idempotent` must be 1. The first post must admit every scan
// (`fresh_admitted` > 99 %): codes are used once per run, so a second run on the same data admits
// nothing new. Prepare again, or move on with CODE_OFFSET.
//
// Knobs: SCANS_PER_SECOND (peak, default 30), MULTIPLIER (default 3), OFFLINE_SHARE (0–1, default
// 0.3), OUTBOX_SIZE (default 500), SCAN_DEVICES (default 30), REPLAY_EVERY (default 10),
// CODE_OFFSET (first unused code, default 0), DURATION (default 60s), LOAD_DATA, BASE_URL.
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { BASE, bearer, envNumber, jsonOf, loadMobileData, uuid } from './lib.js';

const data = loadMobileData(['eventId', 'codes', 'deviceTokens']);
const PEAK = envNumber('SCANS_PER_SECOND', 30);
const MULTIPLIER = envNumber('MULTIPLIER', 3);
const TOTAL = PEAK * MULTIPLIER;
const OFFLINE_SHARE = envNumber('OFFLINE_SHARE', 0.3);
const OUTBOX_SIZE = Math.min(500, envNumber('OUTBOX_SIZE', 500));
const DEVICES = Math.min(envNumber('SCAN_DEVICES', 30), data.deviceTokens.length);
const REPLAY_EVERY = Math.max(1, envNumber('REPLAY_EVERY', 10));
const CODE_OFFSET = envNumber('CODE_OFFSET', 0);
const DURATION = __ENV.DURATION || '60s';
const CLIENT = 'yayatoh-staff-ios';

// Live batches are 1, 2, 3, 1, 2, 3, … scans (mean 2): the request rate that carries the live share.
const LIVE_RATE = (TOTAL * (1 - OFFLINE_SHARE)) / 2;
const OUTBOX_RATE = (TOTAL * OFFLINE_SHARE) / OUTBOX_SIZE;

const replayIdempotent = new Rate('replay_idempotent');
const freshAdmitted = new Rate('fresh_admitted');
const scansPosted = new Counter('scans_posted');
const limited = new Counter('scan_rate_limited');

function seconds(text) {
  let s = 0;
  for (const m of String(text).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
    s += Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
  return s || 60;
}
const DURATION_S = seconds(DURATION);

const scenarios = {};
if (LIVE_RATE > 0)
  scenarios.live_batches = {
    executor: 'constant-arrival-rate',
    rate: Math.max(1, Math.round(LIVE_RATE * 100)),
    timeUnit: '100s',
    duration: DURATION,
    preAllocatedVUs: Math.max(10, Math.ceil(LIVE_RATE)),
    maxVUs: Math.max(60, Math.ceil(LIVE_RATE) * 6),
    exec: 'live',
  };
if (OUTBOX_RATE > 0)
  scenarios.outbox_syncs = {
    executor: 'constant-arrival-rate',
    // k6 wants whole numbers per time unit: scale the unit so a fraction of a batch a second is exact.
    rate: Math.max(1, Math.round(OUTBOX_RATE * 1000)),
    timeUnit: '1000s',
    duration: DURATION,
    preAllocatedVUs: 4,
    maxVUs: 40,
    exec: 'outbox',
  };

export const options = {
  scenarios,
  thresholds: {
    // Online verify SLO (roadmap §10): small live batches.
    'http_req_duration{name:scan_batch_small}': ['p(95)<300'],
    'http_req_duration{name:scan_batch_small_replay}': ['p(95)<300'],
    // Offline outbox sync: this project's budget (3 ms a scan), not a roadmap SLO.
    'http_req_duration{name:scan_batch_500}': ['p(95)<1500'],
    'http_req_duration{name:scan_batch_500_replay}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // A replayed batch applies nothing: every scan `stored: false`, no offline duplicates, same verdicts.
    replay_idempotent: ['rate==1'],
    fresh_admitted: ['rate>0.99'],
    // 30 devices at 90 scans a second are far below the device bucket (3 000 a minute): no 429.
    scan_rate_limited: ['count==0'],
  },
};

/** The n-th live batch's first code index: batches of 1, 2, 3 scans in turn use codes without gaps. */
const liveStart = (i) => 6 * Math.floor(i / 3) + [0, 1, 3][i % 3];
const liveSize = (i) => (i % 3) + 1;
const LIVE_ITERATIONS = Math.ceil(LIVE_RATE * DURATION_S) + 3;
const OUTBOX_ITERATIONS = Math.ceil(OUTBOX_RATE * DURATION_S) + 1;
const LIVE_CODES = LIVE_RATE > 0 ? liveStart(LIVE_ITERATIONS) + 3 : 0;
const OUTBOX_BASE = CODE_OFFSET + LIVE_CODES;

export function setup() {
  const needed = OUTBOX_BASE + OUTBOX_ITERATIONS * OUTBOX_SIZE;
  if (needed > data.codes.length && envNumber('ALLOW_CODE_REUSE', 0) !== 1)
    exec.test.abort(
      `This run scans ${needed - CODE_OFFSET} tickets (from code #${CODE_OFFSET}) but only ${data.codes.length} are prepared. ` +
        `Prepare more (LOAD_TICKETS=${needed}), lower SCANS_PER_SECOND / DURATION, or accept duplicates with -e ALLOW_CODE_REUSE=1.`,
    );
  // The prepared devices must exist and be accepted: one cheap, unmeasured read of the event's board.
  const probe = http.get(`${BASE}/api/v1/staff/events/${data.eventId}/overview`, {
    headers: bearer(data.deviceTokens[0], CLIENT),
    tags: { name: 'setup' },
  });
  if (probe.status !== 200)
    exec.test.abort(
      `The first prepared device token is refused (${probe.status}). The devices must be enrolled on the target: pnpm --filter @yayatoh/web load:prepare`,
    );
}

const code = (index) => data.codes[index % data.codes.length];

function scansFrom(start, count, spreadMs) {
  const now = Date.now();
  const out = [];
  for (let k = 0; k < count; k++)
    out.push({
      scanId: uuid(),
      code: code(start + k),
      // A live scan happened just now; an outbox scan some time in the last few minutes.
      deviceTs: new Date(now - Math.floor((k / count) * spreadMs)).toISOString(),
      clockOffsetMs: 0,
      verdict: 'admit',
    });
  return out;
}

function post(token, scans, name) {
  scansPosted.add(scans.length);
  const res = http.post(`${BASE}/api/v1/scans/batch`, JSON.stringify({ eventId: data.eventId, scans }), {
    headers: bearer(token, CLIENT),
    tags: { name },
    responseCallback: http.expectedStatuses(200, 429),
  });
  if (res.status === 429) limited.add(1);
  return res;
}

/** The first post: every scan stored, and admitted (fresh codes). Returns the verdicts, or null. */
function checkFirst(res, scans, label) {
  const body = jsonOf(res);
  const ok = check(res, {
    [`${label} 200`]: (r) => r.status === 200,
    [`${label} answers every scan`]: () => Boolean(body?.results && body.results.length === scans.length),
  });
  if (!ok || !body) return null;
  for (const r of body.results) {
    freshAdmitted.add(r.stored === true && r.result === 'admitted');
  }
  return body;
}

/** The replay: nothing stored again, no new admission, the same verdicts in the same order. */
function checkReplay(res, scans, first, label) {
  const body = jsonOf(res);
  const answered = check(res, {
    [`${label} 200`]: (r) => r.status === 200,
    [`${label} answers every scan`]: () => Boolean(body?.results && body.results.length === scans.length),
  });
  if (!answered || !body) {
    replayIdempotent.add(false);
    return;
  }
  let same = body.duplicatesOffline === 0;
  for (let k = 0; k < body.results.length; k++) {
    const a = first.results[k];
    const b = body.results[k];
    if (b.scanId !== a.scanId || b.stored !== false || b.result !== a.result) same = false;
  }
  replayIdempotent.add(same);
}

export function live() {
  const i = exec.scenario.iterationInTest;
  const token = data.deviceTokens[i % DEVICES];
  const scans = scansFrom(CODE_OFFSET + liveStart(i), liveSize(i), 2000);
  const first = checkFirst(post(token, scans, 'scan_batch_small'), scans, 'small batch');
  if (first && i % REPLAY_EVERY === 0)
    checkReplay(post(token, scans, 'scan_batch_small_replay'), scans, first, 'small replay');
}

export function outbox() {
  const i = exec.scenario.iterationInTest;
  // The device that lost its connection for a few minutes: scans spread over the last 3 minutes.
  const token = data.deviceTokens[(i * 7) % DEVICES];
  const scans = scansFrom(OUTBOX_BASE + i * OUTBOX_SIZE, OUTBOX_SIZE, 180000);
  const first = checkFirst(post(token, scans, 'scan_batch_500'), scans, 'outbox sync');
  if (first) checkReplay(post(token, scans, 'scan_batch_500_replay'), scans, first, 'outbox replay');
}
