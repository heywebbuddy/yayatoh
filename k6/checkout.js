// Checkout load test (M1.14d): the public event page, then starting a checkout through the
// no-JavaScript form post (the same Server Action the page runs), for a free ticket that is paid
// at once. Thresholds follow roadmap §10 performance budgets.
//
//   pnpm --filter @yayatoh/web load:prepare        # once, local only
//   k6 run -e BASE_URL=http://localhost:3000 k6/checkout.js
import { check, group, sleep } from 'k6';
import { parseHTML } from 'k6/html';
import http from 'k6/http';
import { BASE, loadData, visitorHeaders } from './lib.js';

const data = loadData();
const PEAK = Number(__ENV.PEAK_VUS || 10);

export const options = {
  scenarios: {
    buyers: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: __ENV.RAMP || '20s', target: PEAK },
        { duration: __ENV.HOLD || '40s', target: PEAK },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Public event page (API read budget ×2 for a full SSR page).
    'http_req_duration{name:event_page}': ['p(95)<400'],
    // Checkout start → order (roadmap: hold → PaymentIntent ≤ 800 ms p95).
    'http_req_duration{name:checkout}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  http.cookieJar().clear(BASE);
  const headers = visitorHeaders();
  let form;
  group('event page', () => {
    const res = http.get(`${BASE}/events/${data.eventSlug}`, { headers, tags: { name: 'event_page' } });
    check(res, {
      'page 200': (r) => r.status === 200,
      'page has a CSP nonce': (r) =>
        /'nonce-[A-Za-z0-9+/=]+'/.test(r.headers['Content-Security-Policy'] || ''),
    });
    const doc = parseHTML(res.body);
    form = doc.find(`form:has(select[name="qty:${data.ticketTypeId}"])`).first();
  });
  // A buyer reads the page and picks tickets (THINK=0 for a no-pause stress run).
  sleep(Number(__ENV.THINK ?? 1 + Math.random() * 2));
  group('checkout', () => {
    const fields = {};
    form.find('input[type=hidden]').each((_, el) => {
      const name = el.attributes().name?.value;
      if (name) fields[name] = el.attributes().value?.value ?? '';
    });
    fields[`qty:${data.ticketTypeId}`] = '1';
    fields.name = `k6 buyer ${__VU}-${__ITER}`;
    fields.email = `k6+${__VU}-${__ITER}-${Date.now()}@example.test`;
    // Browsers post Server Action forms as multipart; a file part makes k6 do the same.
    fields.k6 = http.file('', 'k6.txt', 'text/plain');
    const res = http.post(`${BASE}/events/${data.eventSlug}`, fields, {
      headers: { ...headers, origin: BASE },
      redirects: 0,
      tags: { name: 'checkout' },
    });
    check(res, {
      'checkout redirects to the order': (r) =>
        r.status === 303 && /\/orders\/[A-Za-z0-9_-]{43}$/.test(r.headers.Location || ''),
    });
  });
}
