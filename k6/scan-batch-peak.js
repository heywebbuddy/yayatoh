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
// TWO LOAD MODELS (MODEL=open, the default, or MODEL=closed).
// `open` fixes the requests a second whatever the server does (a constant arrival rate): it finds the
// capacity and the lock contention, but a real phone never behaves like that. `closed` is the Staff
// app (apps/staff/src/scan/scheduler.ts + engine.ts): every device has ONE flush in flight. A scan
// is queued in the outbox and "kicks" a flush; while a flush runs, new scans only queue; when the
// answer arrives, the loop peeks again and sends everything queued, up to 500 (BATCH_SIZE), oldest
// first. So a slow server makes batches grow and requests a second per device fall. A failed flush
// (429, 5xx, offline) waits the app's backoff (2 s, 4 s, 8 s … ±20 %, apps/staff/src/scan/backoff.ts)
// and queued scans keep accumulating. One VU is one door phone (SCAN_DEVICES of them), scans arrive
// per device as a Poisson process at its share of the target (SCANS_PER_SECOND × MULTIPLIER ÷ devices);
// there is no separate offline share: big batches appear only when the server falls behind.
// Extra requests are not the app's: one in REPLAY_EVERY_CLOSED batches (default 20) is replayed to
// check idempotency, tagged `closed_replay`.
// What the closed model measures for the app: `outbox_oldest_age_ms`, the age of the oldest unsynced
// scan when a batch is sent (and `outbox_oldest_age_at_ack_ms`, when the answer arrives), and
// `closed_batch_size`. Budget: outbox_oldest_age_ms p95 < 5 s. That is this project's proposal, not a
// roadmap number: the roadmap gives Command Center tiles ≤ 3 s p95 (§10), counted from the moment
// the data is on the server, so a scan should wait on the phone for not much more than that; 5 s is
// that 3 s plus the network, and half of the app's own 10 s retry tick (scheduler.ts TICK_MS). The
// 300 ms p95 stays for batches of at most 3 scans (a verify's worth); batches of 100 or more scans
// get the 1.5 s budget of the 500-scan batch.
//
// Knobs: SCANS_PER_SECOND (peak, default 30), MULTIPLIER (default 3), OFFLINE_SHARE (0–1, default
// 0.3), OUTBOX_SIZE (default 500), SCAN_DEVICES (default 30), REPLAY_EVERY (default 10),
// CODE_OFFSET (first unused code, default 0), DURATION (default 60s), LOAD_DATA, BASE_URL;
// MODEL (open | closed), REPLAY_EVERY_CLOSED (default 20).
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
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
const CLOSED = (__ENV.MODEL || 'open') === 'closed';
if (!['open', 'closed'].includes(__ENV.MODEL || 'open'))
  throw new Error(`MODEL=${__ENV.MODEL} is not open or closed`);
const REPLAY_EVERY_CLOSED = Math.max(1, envNumber('REPLAY_EVERY_CLOSED', 20));
const BATCH_SIZE = 500;

// Live batches are 1, 2, 3, 1, 2, 3, … scans (mean 2): the request rate that carries the live share.
const LIVE_RATE = (TOTAL * (1 - OFFLINE_SHARE)) / 2;
const OUTBOX_RATE = (TOTAL * OFFLINE_SHARE) / OUTBOX_SIZE;

const replayIdempotent = new Rate('replay_idempotent');
const freshAdmitted = new Rate('fresh_admitted');
const scansPosted = new Counter('scans_posted');
const limited = new Counter('scan_rate_limited');
// Closed model only.
const oldestAge = new Trend('outbox_oldest_age_ms', true);
const oldestAgeAtAck = new Trend('outbox_oldest_age_at_ack_ms', true);
const batchSize = new Trend('closed_batch_size');
const backoffs = new Counter('closed_backoffs');
const codesExhausted = new Counter('closed_codes_exhausted');

function seconds(text) {
  let s = 0;
  for (const m of String(text).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
    s += Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
  return s || 60;
}
const DURATION_S = seconds(DURATION);

const scenarios = {};
// Per device: scans a second, and the codes reserved for it (the mean plus 25 % and 30 for the tail).
const DEVICE_RATE = TOTAL / DEVICES;
const RESERVE = Math.ceil(DEVICE_RATE * DURATION_S * 1.25) + 30;
if (CLOSED)
  scenarios.door_phones = {
    executor: 'constant-vus',
    vus: DEVICES,
    duration: DURATION,
    exec: 'closed',
    gracefulStop: '60s',
  };
if (!CLOSED && LIVE_RATE > 0)
  scenarios.live_batches = {
    executor: 'constant-arrival-rate',
    rate: Math.max(1, Math.round(LIVE_RATE * 100)),
    timeUnit: '100s',
    duration: DURATION,
    preAllocatedVUs: Math.max(10, Math.ceil(LIVE_RATE)),
    maxVUs: Math.max(60, Math.ceil(LIVE_RATE) * 6),
    exec: 'live',
  };
if (!CLOSED && OUTBOX_RATE > 0)
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

const openThresholds = {
  // Online verify SLO (roadmap §10): small live batches.
  'http_req_duration{name:scan_batch_small}': ['p(95)<300'],
  'http_req_duration{name:scan_batch_small_replay}': ['p(95)<300'],
  // Offline outbox sync: this project's budget (3 ms a scan), not a roadmap SLO.
  'http_req_duration{name:scan_batch_500}': ['p(95)<1500'],
  'http_req_duration{name:scan_batch_500_replay}': ['p(95)<1500'],
};
const closedThresholds = {
  // The verify SLO only for batches of at most 3 scans; the 500-scan budget for 100 or more.
  'http_req_duration{name:closed_small}': ['p(95)<300'],
  'http_req_duration{name:closed_large}': ['p(95)<1500'],
  // What matters at the door: how long the oldest unsynced scan waited (project proposal, see above).
  outbox_oldest_age_ms: ['p(95)<5000'],
};

export const options = {
  scenarios,
  thresholds: {
    ...(CLOSED ? closedThresholds : openThresholds),
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
  const needed = CLOSED ? CODE_OFFSET + DEVICES * RESERVE : OUTBOX_BASE + OUTBOX_ITERATIONS * OUTBOX_SIZE;
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

/* ------------------------------------------------------------------ closed model: door phones ---- */

/** The app's retry delay after `failures` failed flushes in a row (backoff.ts, with its ±20 % jitter). */
function backoffMs(failures) {
  const raw = Math.min(300000, 2000 * 2 ** (failures - 1));
  return Math.round(raw * (0.8 + 0.4 * Math.random()));
}

/** Gap to the next scan at this device: exponential, mean 1 ÷ its rate. */
const gapMs = () => (-Math.log(1 - Math.random()) / DEVICE_RATE) * 1000;

let phone = null; // per VU: this door phone's outbox and state

function arrivals(p, now) {
  while (p.next <= now) {
    if (p.seq < RESERVE) {
      p.queue.push({
        scanId: uuid(),
        code: code(CODE_OFFSET + p.index * RESERVE + p.seq),
        at: Math.floor(p.next),
      });
      p.seq += 1;
    } else {
      codesExhausted.add(1);
    }
    p.next += gapMs();
  }
}

const asScans = (entries) =>
  entries.map((e) => ({
    scanId: e.scanId,
    code: e.code,
    deviceTs: new Date(e.at).toISOString(),
    clockOffsetMs: 0,
    verdict: 'admit',
  }));

const bucket = (n) => (n <= 3 ? 'closed_small' : n >= 100 ? 'closed_large' : 'closed_medium');

export function closed() {
  if (!phone) {
    const index = (exec.vu.idInTest - 1) % DEVICES;
    phone = {
      index,
      token: data.deviceTokens[index],
      queue: [],
      next: Date.now() + gapMs(),
      seq: 0,
      failures: 0,
      retryAt: 0,
      sent: 0,
    };
  }
  const p = phone;
  const end = exec.scenario.startTime + DURATION_S * 1000;
  const wait = (until) => {
    const ms = Math.min(until, end) - Date.now();
    if (ms > 0) sleep(ms / 1000);
  };
  arrivals(p, Date.now());
  // Nothing to send: wait for the next scan (it kicks a flush). Backing off: wait for the retry.
  if (p.queue.length === 0) return wait(p.next);
  if (Date.now() < p.retryAt) return wait(p.retryAt);

  const batch = p.queue.slice(0, BATCH_SIZE);
  const scans = asScans(batch);
  const sentAt = Date.now();
  oldestAge.add(sentAt - batch[0].at);
  batchSize.add(batch.length);
  const res = post(p.token, scans, bucket(batch.length));
  oldestAgeAtAck.add(Date.now() - batch[0].at);
  const body = res.status === 200 ? jsonOf(res) : null;
  if (!body?.results || body.results.length !== batch.length) {
    // 429, 5xx, a lost answer: keep the outbox, wait the app's backoff.
    check(res, { 'closed flush 200': (r) => r.status === 200 });
    p.failures += 1;
    p.retryAt = Date.now() + backoffMs(p.failures);
    backoffs.add(1);
    return;
  }
  checkFirst(res, scans, 'closed flush');
  p.failures = 0;
  p.queue.splice(0, batch.length);
  p.sent += 1;
  if (p.sent % REPLAY_EVERY_CLOSED === 0)
    checkReplay(post(p.token, scans, 'closed_replay'), scans, body, 'closed replay');
}
