import { createServer } from 'node:net';
import { chromium, expect, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { guestHubScenario } from '@yayatoh/testing';
import lighthouse from 'lighthouse';

/**
 * M4.7a acceptance: "Lighthouse mobile thresholds met". Real Lighthouse runs (its default mobile
 * profile: a mid-range phone, simulated slow 4G and 4× CPU throttling) against the built app, on a
 * party's hub with a seat and a ticket. Its own Playwright project, run alone
 * (`pnpm --filter @yayatoh/web e2e:lighthouse`): Lighthouse times the CPU, so tests running beside
 * it would skew the score. SEO is not scored: the page is `noindex` on purpose (P4-3).
 */

/**
 * The thresholds: Lighthouse category scores (0–1) at the roadmap's public-page bar (performance
 * ≥ 90, §M1.11) and 95 for accessibility and best practices; layout shift at Core Web Vitals'
 * "good" (≤ 0.1). LCP and TBT are recorded with each run (the attachment): the performance score
 * already weighs them, and on this page Lighthouse's simulated LCP is set by the framework's own
 * scripts every page loads (about 260 KB), not by the hub (see docs/specs/M4.7/spec.md).
 */
const HUB_LIGHTHOUSE = {
  performance: 0.9,
  accessibility: 0.95,
  bestPractices: 0.95,
  cls: 0.1,
} as const;

test.describe.configure({ timeout: 240_000 });
test.afterAll(async () => {
  await closePools();
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });

/** Lighthouse CI's practice: several runs, judged on the median (one run is noisy). */
const RUNS = 3;
const median = (xs: readonly number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

test('the guest hub meets the Lighthouse mobile thresholds (M4.7a)', async ({ baseURL }, info) => {
  const orgId = (await resolveOrgSlug('lakeside-events'))?.orgId;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  const s = await guestHubScenario(orgId);
  const url = `${baseURL}/hub/${encodeURIComponent(s.garcia.token)}`;
  // Warm the server (fills its caches) without a browser visit, so no service worker is installed
  // before Lighthouse loads the page.
  expect((await fetch(url)).status).toBe(200);

  const runs: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    lcpMs: number;
    tbtMs: number;
    cls: number;
    failing: string[];
    viewport: boolean;
  }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const port = await freePort();
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${port}`],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    });
    try {
      const run = await lighthouse(url, {
        port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
      });
      if (!run) throw new Error('Lighthouse returned nothing');
      const { categories, audits, runtimeError } = run.lhr;
      if (runtimeError) throw new Error(`Lighthouse: ${runtimeError.code} ${runtimeError.message}`);
      const failing = (['accessibility', 'best-practices'] as const).flatMap((cat) =>
        (categories[cat]?.auditRefs ?? [])
          .filter((r) => r.weight > 0 && (audits[r.id]?.score ?? 1) < 1)
          .map((r) => r.id),
      );
      runs.push({
        performance: categories.performance?.score ?? 0,
        accessibility: categories.accessibility?.score ?? 0,
        bestPractices: categories['best-practices']?.score ?? 0,
        lcpMs: audits['largest-contentful-paint']?.numericValue ?? Number.POSITIVE_INFINITY,
        tbtMs: audits['total-blocking-time']?.numericValue ?? Number.POSITIVE_INFINITY,
        cls: audits['cumulative-layout-shift']?.numericValue ?? Number.POSITIVE_INFINITY,
        failing,
        // Phone-ready with no app: a mobile viewport, optimised for phones (no tap delay).
        viewport: audits['meta-viewport']?.score === 1 && audits['viewport-insight']?.score === 1,
      });
    } finally {
      await browser.close();
    }
  }
  const m = {
    performance: median(runs.map((r) => r.performance)),
    accessibility: median(runs.map((r) => r.accessibility)),
    bestPractices: median(runs.map((r) => r.bestPractices)),
    lcpMs: median(runs.map((r) => r.lcpMs)),
    tbtMs: median(runs.map((r) => r.tbtMs)),
    cls: median(runs.map((r) => r.cls)),
  };
  await info.attach('lighthouse', {
    body: JSON.stringify({ median: m, runs }, null, 2),
    contentType: 'application/json',
  });
  const failing = [...new Set(runs.flatMap((r) => r.failing))].join(', ') || 'none';
  expect.soft(m.performance, 'performance score (median)').toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.performance);
  expect
    .soft(m.accessibility, `accessibility score (median; failing audits: ${failing})`)
    .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.accessibility);
  expect
    .soft(m.bestPractices, `best practices score (median; failing audits: ${failing})`)
    .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.bestPractices);
  expect.soft(m.cls, 'cumulative layout shift (median)').toBeLessThanOrEqual(HUB_LIGHTHOUSE.cls);
  expect(runs.every((r) => r.viewport)).toBe(true);
});
