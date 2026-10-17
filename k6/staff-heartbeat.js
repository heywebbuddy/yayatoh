// "Staff heartbeat from 500 devices" (M7.x): every enrolled Staff device posts its health every 30 s
// (POST /v1/devices/heartbeat: battery, queue depth, clock offset, event, app version — the body of
// apps/staff/src/device/session.ts, HEARTBEAT_MS = 30 000), while some phones have the staff
// screen open and read the device board (GET /v1/staff/events/{eventId}/overview).
//
//   pnpm --filter @yayatoh/web load:prepare        # enrols 500 devices (LOAD_DEVICES)
//   k6 run -e BASE_URL=http://localhost:3000 k6/staff-heartbeat.js
//
// PEAK MODEL. The largest event in the plan runs 500 devices (docs/agent-briefs/m7.x.md): 500 / 30 s
// = 16.7 heartbeats a second, each from a distinct device token. The Staff app refreshes the board
// every 15 s (REFRESH_MS.overview in apps/staff/src/tools/queries.ts) only while the staff screen is
// open: BOARD_READERS = 25 devices (5 %) do, 1.7 reads a second; each read returns the counts,
// all 500 devices of the board and the alerts. `setup()` sends one unmeasured heartbeat per device
// so the board lists every device from the start, as it would after the doors opened.
//
// THRESHOLDS. Heartbeat p95 < 300 ms (the same bar as the verify path: it is one row update and an
// outbox event), errors < 1 %, and NO 429: the heartbeat must never be rate limited at this size.
// The device bucket (packages/api-v1/src/index.ts) is 3 000 requests a minute per token; a device
// sends 2 heartbeats and 4 board reads a minute, so it never gets near it. The board read is an
// aggregate over the event (check-in counts + 500 device rows + alerts): p95 < 1 s, an engineering
// target stricter than the roadmap's 3 s for Command Center tiles (§10), because the phone shows it
// as the supervisor's screen.
//
// Knobs: DEVICES (default 500, at most the prepared ones), INTERVAL (seconds between a device's
// beats, default 30), DURATION (default 3m), BOARD_READERS (default 25; 0 = none), LOAD_DATA, BASE_URL.
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { BASE, bearer, envNumber, jsonOf, loadMobileData, randomIntBetween } from './lib.js';

const data = loadMobileData(['eventId', 'deviceTokens']);
const DEVICES = Math.min(envNumber('DEVICES', 500), data.deviceTokens.length);
const INTERVAL = envNumber('INTERVAL', 30);
const DURATION = __ENV.DURATION || '3m';
const BOARD_READERS = Math.min(envNumber('BOARD_READERS', 25), DEVICES);
const BOARD_INTERVAL = 15;
const CLIENT = 'yayatoh-staff-ios';

const limited = new Counter('heartbeat_rate_limited');

const scenarios = {
  heartbeats: {
    // DEVICES beats every INTERVAL seconds, round robin: each device beats once per interval.
    executor: 'constant-arrival-rate',
    rate: DEVICES,
    timeUnit: `${INTERVAL}s`,
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 200,
    exec: 'heartbeat',
  },
};
if (BOARD_READERS > 0)
  scenarios.board = {
    executor: 'constant-arrival-rate',
    rate: BOARD_READERS,
    timeUnit: `${BOARD_INTERVAL}s`,
    duration: DURATION,
    preAllocatedVUs: 5,
    maxVUs: 60,
    exec: 'board',
  };

export const options = {
  scenarios,
  thresholds: {
    'http_req_duration{name:heartbeat}': ['p(95)<300'],
    'http_req_duration{name:board}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Never rate limited at 500 devices / 30 s.
    heartbeat_rate_limited: ['count==0'],
  },
};

/** What a device reports: it drains a little battery, mostly has nothing queued, drifts a little. */
function health(index, round) {
  const busy = randomIntBetween(0, 9) === 0;
  return {
    batteryPct: Math.max(5, 100 - ((index * 7) % 60) - round * 2),
    queueDepth: busy ? randomIntBetween(1, 40) : 0,
    clockOffsetMs: randomIntBetween(-900, 900),
    eventId: data.eventId,
    checkpointId: null,
    appVersion: '1.0.0',
  };
}

function beat(index, name) {
  const round = Math.floor(exec.scenario.iterationInTest / DEVICES);
  const res = http.post(`${BASE}/api/v1/devices/heartbeat`, JSON.stringify(health(index, round)), {
    headers: bearer(data.deviceTokens[index], CLIENT),
    tags: { name },
    responseCallback: http.expectedStatuses(200, 429),
  });
  if (res.status === 429) limited.add(1);
  return res;
}

export function setup() {
  // One unmeasured heartbeat per device, in groups of 50: every token must be accepted (a missing
  // or revoked device fails the run here, not as a mystery error rate), and the board fills up.
  for (let from = 0; from < DEVICES; from += 50) {
    const batch = [];
    for (let i = from; i < Math.min(from + 50, DEVICES); i++)
      batch.push([
        'POST',
        `${BASE}/api/v1/devices/heartbeat`,
        JSON.stringify(health(i, 0)),
        { headers: bearer(data.deviceTokens[i], CLIENT), tags: { name: 'setup_beat' } },
      ]);
    for (const res of http.batch(batch))
      if (res.status !== 200)
        exec.test.abort(
          `A prepared device is refused (${res.status} ${res.body}). The ${DEVICES} devices must be enrolled on the target: pnpm --filter @yayatoh/web load:prepare`,
        );
  }
}

export function heartbeat() {
  const index = exec.scenario.iterationInTest % DEVICES;
  const res = beat(index, 'heartbeat');
  const body = jsonOf(res);
  check(res, {
    'heartbeat 200': (r) => r.status === 200,
    'heartbeat answers with the server time and the commands': () =>
      Boolean(body?.serverTime && Array.isArray(body.commands)),
  });
}

export function board() {
  const index = exec.scenario.iterationInTest % BOARD_READERS;
  const res = http.get(`${BASE}/api/v1/staff/events/${data.eventId}/overview`, {
    headers: bearer(data.deviceTokens[index], CLIENT),
    tags: { name: 'board' },
    responseCallback: http.expectedStatuses(200, 429),
  });
  if (res.status === 429) limited.add(1);
  const body = jsonOf(res);
  check(res, {
    'board 200': (r) => r.status === 200,
    'board lists every device': () =>
      Boolean(body && Array.isArray(body.devices) && body.devices.length >= DEVICES),
  });
}
