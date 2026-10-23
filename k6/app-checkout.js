// "App checkout start at peak" (M7.x, M7.2f): signed-in attendees starting a checkout from the app,
// POST /v1/public/events/{slug}/checkout with an Idempotency-Key, for the load event's free pass
// (the fake payment provider: a free cart is paid at once, `action: paid`, tickets issued).
//
//   pnpm --filter @yayatoh/web load:prepare
//   k6 run -e BASE_URL=http://localhost:3000 k6/app-checkout.js
//
// PEAK MODEL. The web checkout test (checkout.js, M1.14d) runs ~10 starts a second at its realistic
// pace; the app is the secondary channel to the web page, so the app peak is a third of that:
// PEAK_CHECKOUTS = 3 per second (about 180 a minute). Staging at 3× expected peak (roadmap §7.6)
// passes `-e PEAK_CHECKOUTS=9`. One Idempotency-Key per iteration; every iteration then replays the
// same request (a phone retrying after a dropped connection) and must get the same order back, not
// a second one. Every iteration is a different attendee (round robin), from its own client IP.
//
// RATE LIMIT. The route counts against the web's `checkoutStart` policy per signed-in person: 20
// starts per 10 minutes (device bucket, `user-<id>`), the replay included, plus an IP ceiling
// (600 per 10 minutes per IP) that one-IP-per-iteration never reaches. Below that budget there must
// be no 429: the main scenario counts them in `checkout_rate_limited` and the threshold is zero.
// The script refuses to start when PEAK × DURATION would put an attendee over the budget (use more
// accounts: LOAD_ATTENDEES at prepare time). The limiter keeps its counters for 10 minutes, so run
// the script again after that, or with more accounts. A second scenario, `limit_probe`, then shows
// the policy does trigger: one dedicated attendee starts checkouts back to back and must be
// stopped with a well-formed 429 (problem+json `rate_limited`, Retry-After) once the budget is
// spent, never with a 5xx. Those 429s are counted separately in `probe_rate_limited`. The probe
// starts checkouts for an event that does not exist: the limiter counts a start before the event
// is looked up, so each start that passes it answers 404 and makes no order, and the 21st answers
// 429. (Real orders could not reach the limit: see the next paragraph.)
//
// RISK RULES. The same route applies the web's pre-checkout risk rules (M1.6e): the 10th order of
// one email address within an hour is refused (`403 risk_blocked`, rule `email_velocity_block`),
// and from the 4th the orders are flagged for review. The prepared attendees already have one order
// each, so the script allows 8 starts per attendee per run and refuses to start above that; a run
// repeated within the hour adds to it. For staging at 3× prepare more accounts (LOAD_ATTENDEES=500).
//
// Knobs: PEAK_CHECKOUTS (per second, default 3), DURATION (default 60s), ATTENDEES (accounts used,
// default all prepared but one, which is kept for the probe), CHECKOUT_BUDGET (default 20),
// ORDERS_PER_ATTENDEE (risk-rule allowance per run, default 8), PROBE=0 (no probe), LOAD_DATA,
// BASE_URL, SIGNIN_PACE (lib.js).
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { attendeeTokens, BASE, bearer, envNumber, isProblem, jsonOf, loadMobileData, uuid } from './lib.js';

const data = loadMobileData(['attendees', 'attendeePassword', 'eventSlug', 'ticketTypeId']);
const PEAK = envNumber('PEAK_CHECKOUTS', 3);
const DURATION = __ENV.DURATION || '60s';
const BUDGET = envNumber('CHECKOUT_BUDGET', 20);
const PROBE = envNumber('PROBE', 1) === 1;
const CLIENT = 'yayatoh-ios';
// One account is kept for the probe, so the main scenario never spends its budget.
const MAIN_USERS = Math.min(
  envNumber('ATTENDEES', data.attendees.length - (PROBE ? 1 : 0)),
  data.attendees.length - (PROBE ? 1 : 0),
);
const PROBE_ATTEMPTS = BUDGET + 8;
const ORDERS_PER_ATTENDEE = envNumber('ORDERS_PER_ATTENDEE', 8);

const rateLimited = new Counter('checkout_rate_limited');
const probeLimited = new Counter('probe_rate_limited');
const probeStarted = new Counter('probe_started');
const orders = new Counter('checkout_orders');

/** "60s" / "5m" in seconds (what k6's duration strings mean), for the budget arithmetic. */
function seconds(text) {
  let s = 0;
  for (const m of String(text).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
    s += Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
  return s || 60;
}

const scenarios = {
  checkout: {
    executor: 'constant-arrival-rate',
    rate: PEAK,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: Math.max(10, PEAK * 2),
    maxVUs: Math.max(40, PEAK * 8),
    exec: 'checkout',
  },
};
if (PROBE)
  scenarios.limit_probe = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 1,
    startTime: DURATION,
    maxDuration: '2m',
    exec: 'probe',
  };

export const options = {
  scenarios,
  thresholds: {
    // Roadmap §10: checkout hold → payment ≤ 800 ms p95 (the web budget).
    'http_req_duration{name:checkout}': ['p(95)<800'],
    'http_req_duration{name:checkout_replay}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Below the policy budget the limiter must stay quiet…
    checkout_rate_limited: ['count==0'],
    // …and the probe proves it does trigger, at the policy's budget and not before it.
    ...(PROBE ? { probe_rate_limited: ['count>=1'], probe_started: [`count<=${BUDGET}`] } : {}),
  },
};

export function setup() {
  const iterations = Math.ceil(PEAK * seconds(DURATION));
  // The replay is a second start for the limiter.
  const perUser = Math.ceil((iterations * 2) / MAIN_USERS);
  if (perUser > BUDGET - 2)
    exec.test.abort(
      `${iterations} checkouts + replays over ${MAIN_USERS} attendees is ${perUser} starts each, past the ` +
        `checkoutStart budget of ${BUDGET} per 10 minutes. Prepare more accounts (LOAD_ATTENDEES) or lower PEAK_CHECKOUTS / DURATION.`,
    );
  const orders = Math.ceil(iterations / MAIN_USERS);
  if (orders > ORDERS_PER_ATTENDEE)
    exec.test.abort(
      `${iterations} checkouts over ${MAIN_USERS} attendees is ${orders} orders each: the 10th order of an email address in an hour ` +
        `is refused by the risk rules (email_velocity_block). Prepare more accounts (LOAD_ATTENDEES) or lower PEAK_CHECKOUTS / DURATION.`,
    );
  const users = attendeeTokens(data, MAIN_USERS + (PROBE ? 1 : 0), seconds(DURATION) * 1000 + 150000);
  return { users: users.slice(0, MAIN_USERS), probe: PROBE ? users[MAIN_USERS] : null };
}

function start(token, key, name, tags = {}, expected = [201], slug = data.eventSlug) {
  const body = JSON.stringify({
    items: [{ ticketTypeId: data.ticketTypeId, quantity: 1 }],
    name: 'k6 attendee',
  });
  return http.post(`${BASE}/api/v1/public/events/${slug}/checkout`, body, {
    headers: bearer(token, CLIENT, { 'idempotency-key': key }),
    tags: { name, ...tags },
    responseCallback: http.expectedStatuses(...expected),
  });
}

export function checkout(s) {
  const me = s.users[exec.scenario.iterationInTest % s.users.length];
  const key = uuid();
  const first = start(me.token, key, 'checkout');
  if (first.status === 429) rateLimited.add(1);
  const a = jsonOf(first);
  const ok = check(first, {
    'checkout 201': (r) => r.status === 201,
    'a free cart is paid at once': () => Boolean(a && a.action === 'paid' && a.orderId),
  });
  if (!ok || !a) return;
  orders.add(1);
  // The same request again, as a phone retries: the same order, not another one.
  const again = start(me.token, key, 'checkout_replay');
  if (again.status === 429) rateLimited.add(1);
  const b = jsonOf(again);
  check(again, {
    'replay 201': (r) => r.status === 201,
    'replay returns the same order': () => Boolean(b && b.orderId === a.orderId && b.action === 'paid'),
  });
}

export function probe(s) {
  if (!s.probe) return;
  for (let i = 0; i < PROBE_ATTEMPTS; i++) {
    // 404 = the limiter let the start through (no such event, no order); 429 = the budget is spent.
    const res = start(
      s.probe.token,
      uuid(),
      'checkout_probe',
      {},
      [404, 429],
      'k6-limit-probe-no-such-event',
    );
    if (res.status === 404) {
      probeStarted.add(1);
    } else if (res.status === 429) {
      probeLimited.add(1);
      check(res, {
        'a limited start is a problem+json rate_limited': (r) => isProblem(r, 'rate_limited'),
        'a limited start says when to retry': (r) => Number(r.headers['Retry-After']) >= 1,
      });
    } else {
      check(res, { 'the probe is answered 404 or 429': () => false });
    }
  }
}
