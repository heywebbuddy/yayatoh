// "My tickets and orders at peak" (M7.x): the attendee app at doors-open. A signed-in person opens
// the app (tickets and orders lists), taps a ticket (the QR code must show fast at the door) and
// opens the order. Routes: GET /v1/me/tickets, /me/tickets/{id}, /me/orders, /me/orders/{id}.
//
//   pnpm --filter @yayatoh/web load:prepare        # 200 attendees with a verified email, 2 tickets each
//   k6 run -e BASE_URL=http://localhost:3000 k6/me-tickets.js
//
// PEAK MODEL (documented, tunable). Roadmap §10 sizes the door at 20 scans/s for the whole event
// (the scan SLO is measured at that rate; fixture `load-20k` is a 20 000-ticket event). Every
// person who reaches the door shows a ticket, and about half of them show it in the app, so the
// app sees about 10 ticket openings a second at the surge: PEAK_LAUNCHES = 10 per second. One
// opening is the app's launch (tickets list + orders list, fetched together), a tap on a ticket
// after THINK seconds, and a tap on the order. That is 4 requests, about 40 a second. The staging
// run at 3× expected peak (roadmap §7.6) passes `-e PEAK_LAUNCHES=30`. Every iteration is a
// different attendee (round robin over the prepared accounts, never one hot row), each from its own
// client IP; with 200 accounts and 10 openings a second one account is hit every 20 s.
//
// Knobs: PEAK_LAUNCHES (per second, default 10), DURATION (default 60s), THINK (seconds between
// the lists and the ticket tap, default 1), ATTENDEES (accounts used, default all prepared),
// LOAD_DATA, BASE_URL, SIGNIN_PACE (see lib.js).
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { attendeeTokens, BASE, bearer, envNumber, jsonOf, loadMobileData } from './lib.js';

const data = loadMobileData(['attendees', 'attendeePassword']);
const PEAK = envNumber('PEAK_LAUNCHES', 10);
const THINK = envNumber('THINK', 1);
const DURATION = __ENV.DURATION || '60s';
const ATTENDEES = Math.min(envNumber('ATTENDEES', data.attendees.length), data.attendees.length);
const CLIENT = 'yayatoh-ios';

export const options = {
  scenarios: {
    doors_open: {
      executor: 'constant-arrival-rate',
      rate: PEAK,
      timeUnit: '1s',
      duration: DURATION,
      // An opening lasts about THINK + 3 requests: size the pool for that, with room to spare.
      preAllocatedVUs: Math.ceil(PEAK * (THINK + 1)) + 5,
      maxVUs: Math.ceil(PEAK * (THINK + 1)) * 4 + 20,
    },
  },
  thresholds: {
    // Roadmap §10: API reads p95 ≤ 200 ms on a quiet system; these are the load budgets of the
    // M7.x brief: lists 400 ms, the ticket (its QR code) 300 ms.
    'http_req_duration{name:tickets_list}': ['p(95)<400'],
    'http_req_duration{name:orders_list}': ['p(95)<400'],
    'http_req_duration{name:ticket_detail}': ['p(95)<300'],
    // The order is a list-class read (lines, refund terms, tickets still held): the list budget.
    'http_req_duration{name:order_detail}': ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

/** Parse "60s" / "5m" / "1h30m" (the same values k6 takes) into milliseconds, for the token lifetime check. */
function durationMs(text) {
  let ms = 0;
  for (const m of String(text).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
    ms += Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return ms || 60000;
}

export function setup() {
  // Prepared tokens last 15 minutes: sign in again for any that would lapse during the run.
  return { users: attendeeTokens(data, ATTENDEES, durationMs(DURATION) + THINK * 3000) };
}

export default function (s) {
  const me = s.users[exec.scenario.iterationInTest % s.users.length];
  const headers = bearer(me.token, CLIENT);
  let ticketId;
  let orderId;

  group('launch', () => {
    const [tickets, orders] = http.batch([
      [
        'GET',
        `${BASE}/api/v1/me/tickets?when=upcoming&limit=50`,
        null,
        { headers, tags: { name: 'tickets_list' } },
      ],
      ['GET', `${BASE}/api/v1/me/orders?limit=20`, null, { headers, tags: { name: 'orders_list' } }],
    ]);
    const t = jsonOf(tickets);
    const o = jsonOf(orders);
    check(tickets, {
      'tickets 200': (r) => r.status === 200,
      'tickets: the attendee has tickets': () => Boolean(t?.data && t.data.length >= 1),
    });
    check(orders, {
      'orders 200': (r) => r.status === 200,
      'orders: the attendee has an order': () => Boolean(o?.data && o.data.length >= 1),
    });
    ticketId = t?.data?.[0] ? t.data[0].id : undefined;
    orderId = o?.data?.[0] ? o.data[0].id : undefined;
  });

  // The person looks at the list, then taps their ticket.
  sleep(THINK);

  if (ticketId) {
    const res = http.get(`${BASE}/api/v1/me/tickets/${ticketId}`, {
      headers,
      tags: { name: 'ticket_detail' },
    });
    const body = jsonOf(res);
    check(res, {
      'ticket 200': (r) => r.status === 200,
      'ticket has its QR code': () =>
        Boolean(body && typeof body.qrCode === 'string' && body.qrCode.length > 8),
    });
  }
  if (orderId) {
    const res = http.get(`${BASE}/api/v1/me/orders/${orderId}`, { headers, tags: { name: 'order_detail' } });
    const body = jsonOf(res);
    check(res, {
      'order 200': (r) => r.status === 200,
      'order matches the list': () => Boolean(body && body.id === orderId),
    });
  }
}
