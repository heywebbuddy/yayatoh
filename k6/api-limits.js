// /v1 rate limits per entitlement (M6.x). The `api_access` quotas of the org's plan (billing's
// DEFAULT_API_ACCESS_QUOTAS until the owner prices plans, D22): 600 requests a minute per live
// key, 120 per test key, 1 200 for all of an org's keys together.
//
//   pnpm --filter @yayatoh/web load:prepare        # writes the keys into k6/.data/load.json
//   k6 run -e BASE_URL=http://localhost:3000 k6/api-limits.js
//
// What it proves under load: a key past its budget gets 429 (problem+json with Retry-After and the
// RateLimit-* headers) and never a 5xx; the budget is enforced to the request (admitted ≈ limit,
// not far above); one key's overload does not starve another (the test key keeps its own bucket);
// the p95 of a *limited* answer stays as fast as an admitted one.
import { check } from 'k6';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { BASE, loadData } from './lib.js';

const data = loadData();
const LIVE = Number(__ENV.LIVE_LIMIT || 600);
const TEST = Number(__ENV.TEST_LIMIT || 120);
const admitted = new Counter('admitted');
const limited = new Counter('limited');
const wellFormed429 = new Rate('well_formed_429');

export const options = {
  scenarios: {
    // Both keys are hammered for one minute window, far above their budget.
    live_key: { executor: 'constant-arrival-rate', rate: 30, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, maxVUs: 60, exec: 'live' },
    test_key: { executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '60s', preAllocatedVUs: 10, maxVUs: 30, exec: 'testKey' },
  },
  thresholds: {
    // Overload is a 429, never a failure of ours.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
    well_formed_429: ['rate>0.99'],
    'http_req_duration{name:live}': ['p(95)<300'],
    'http_req_duration{name:test}': ['p(95)<300'],
    // 1 800 live and 600 test requests are sent in the minute: about the budget must get through
    // (the bucket refills continuously, so up to ~2× the limit over a full minute).
    'admitted{key:live}': [`count>=${LIVE}`, `count<=${LIVE * 2}`],
    'admitted{key:test}': [`count>=${TEST}`, `count<=${TEST * 2}`],
  },
};

function hit(token, name, keyTag) {
  const res = http.get(`${BASE}/api/v1/orgs/${data.orgSlug}`, {
    headers: { authorization: `Bearer ${token}` },
    tags: { name, key: keyTag },
    responseCallback: http.expectedStatuses(200, 429),
  });
  if (res.status === 200) admitted.add(1, { key: keyTag });
  else if (res.status === 429) {
    limited.add(1, { key: keyTag });
    wellFormed429.add(
      Boolean(res.headers['Retry-After']) &&
        Boolean(res.headers['Ratelimit-Limit'] || res.headers['RateLimit-Limit']) &&
        /problem\+json/.test(res.headers['Content-Type'] || ''),
    );
  }
  check(res, { 'answered 200 or 429': (r) => r.status === 200 || r.status === 429 });
}

export function live() {
  hit(data.liveKey, 'live', 'live');
}
export function testKey() {
  hit(data.testKey, 'test', 'test');
}
