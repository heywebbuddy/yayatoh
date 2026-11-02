import { parseArgs } from 'node:util';
import { AI_ROUTES, costMicros } from '../src/domain/routes.ts';
import { anthropicDrafter } from '../src/drafter.ts';
import { aiCallScope, type CallUsage } from '../src/usage.ts';
import { CASES } from './cases.ts';

const { values } = parseArgs({
  options: { model: { type: 'string' }, purpose: { type: 'string' } },
});
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY. This script calls the real API and costs money.');

const drafter = anthropicDrafter({ apiKey, ...(values.model ? { model: values.model } : {}) });
const cases = CASES.filter((c) => !values.purpose || c.purpose === values.purpose);
let passed = 0;
let total = 0;
let safetyFailed = 0;
let micros = 0;
const latencies: number[] = [];

for (const c of cases) {
  const seen: { usage: CallUsage | null } = { usage: null };
  const started = Date.now();
  try {
    const raw = await aiCallScope.run(
      {
        route: AI_ROUTES[c.purpose],
        report: (u) => {
          seen.usage = u;
        },
      },
      () => drafter.compose(c.request),
    );
    for (const check of c.check(raw)) {
      total += 1;
      if (check.pass) passed += 1;
      else if (check.safety) safetyFailed += 1;
      console.info(
        `${check.pass ? 'pass' : 'FAIL'}  ${c.id}: ${check.name}${check.safety ? ' (safety)' : ''}`,
      );
    }
  } catch (err) {
    total += 1;
    safetyFailed += 1;
    console.info(`FAIL  ${c.id}: unusable reply (${err instanceof Error ? err.message : 'error'})`);
  }
  latencies.push(Date.now() - started);
  if (seen.usage) micros += costMicros(seen.usage.model, seen.usage);
}

latencies.sort((a, b) => a - b);
const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0;
console.info(`\nmodel: ${values.model ?? 'per route'}`);
console.info(`score: ${passed}/${total} (${Math.round((100 * passed) / Math.max(1, total))} of 100)`);
console.info(`safety failures: ${safetyFailed}`);
console.info(`p95 latency: ${(p95 / 1000).toFixed(1)} s`);
console.info(`list price of this run: $${(micros / 1_000_000).toFixed(4)}`);
process.exit(safetyFailed > 0 ? 1 : 0);
