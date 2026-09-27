// Door scanning load test (M1.14d): online verify through the scanner API, the path every door
// device uses when it is online. Roadmap §10 SLO: scan verify online p95 < 300 ms.
//
//   pnpm --filter @yayatoh/web load:prepare        # once, local only
//   k6 run -e BASE_URL=http://localhost:3000 k6/scan.js
import { check } from 'k6';
import http from 'k6/http';
import { BASE, loadData, uuid } from './lib.js';

const data = loadData();
const RATE = Number(__ENV.SCANS_PER_SECOND || 30);

export const options = {
  scenarios: {
    doors: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Math.max(10, RATE),
      maxVUs: RATE * 4,
    },
    manifest: {
      executor: 'constant-vus',
      vus: 2,
      duration: __ENV.DURATION || '60s',
      exec: 'manifest',
    },
  },
  thresholds: {
    'http_req_duration{name:scan}': ['p(95)<300'],
    'http_req_duration{name:manifest}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const auth = { authorization: `Bearer ${data.deviceToken}`, 'content-type': 'application/json' };

export default function () {
  const code = data.codes[(__VU * 7919 + __ITER) % data.codes.length];
  const res = http.post(
    `${BASE}/api/v1/scans/batch`,
    JSON.stringify({
      eventId: data.eventId,
      scans: [
        { scanId: uuid(), code, deviceTs: new Date().toISOString(), clockOffsetMs: 0, verdict: 'admit' },
      ],
    }),
    { headers: auth, tags: { name: 'scan' } },
  );
  check(res, { 'scan accepted': (r) => r.status === 200 });
}

export function manifest() {
  const res = http.get(`${BASE}/api/v1/events/${data.eventId}/manifest?limit=500`, {
    headers: auth,
    tags: { name: 'manifest' },
  });
  check(res, { 'manifest 200': (r) => r.status === 200 });
}
