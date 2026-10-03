import { createServer } from 'node:net';
import { chromium, expect, test } from '@playwright/test';
import lighthouse from 'lighthouse';

/**
 * M5.10a acceptance: "Lighthouse mobile thresholds met". Real Lighthouse runs (its default mobile
 * profile: a mid-range phone, simulated slow 4G and 4× CPU throttling) against the built app, on a
 * registrant's conference hub: the today view (sessions on now and next, polls and Q&A, tools)
 * and the agenda (every session with its star and enrolment buttons). Its own Playwright project,
 * run alone (`pnpm --filter @yayatoh/web e2e:lighthouse`): Lighthouse times the CPU, so tests
 * running beside it would skew the score. SEO is not scored: the page is private (`noindex`).
 */

/**
 * The thresholds (as M4.7a's guest hub): performance ≥ 90 (the roadmap's public-page bar),
 * accessibility and best practices ≥ 95, layout shift ≤ 0.1 (Core Web Vitals "good"). LCP and TBT
 * are recorded with each run (the attachment); the performance score already weighs them.
 */
const HUB_LIGHTHOUSE = {
  performance: 0.9,
  accessibility: 0.95,
  bestPractices: 0.95,
  cls: 0.1,
} as const;

test.describe.configure({ timeout: 360_000 });

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

for (const view of ['today', 'agenda'] as const)
  test(`the conference hub (${view}) meets the Lighthouse mobile thresholds (M5.10a)`, async ({
    baseURL,
  }, info) => {
    const setup = await fetch(`${baseURL}/api/dev/conference-hub`, {
      method: 'POST',
      body: new URLSearchParams({
        org: 'lakeside-events',
        name: `Lighthouse Summit ${Date.now().toString(36)}`,
      }),
    });
    expect(setup.ok).toBe(true);
    const f = (await setup.json()) as { people: { token: string }[] };
    const token = f.people[0]?.token;
    if (!token) throw new Error('no registrant');
    const url = `${baseURL}/orders/${token}/hub${view === 'today' ? '' : `?view=${view}`}`;
    // Warm the server without a browser visit, so no service worker is installed before Lighthouse.
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
          viewport: audits['meta-viewport']?.score === 1,
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
    await info.attach(`lighthouse-${view}`, {
      body: JSON.stringify({ median: m, runs }, null, 2),
      contentType: 'application/json',
    });
    process.stdout.write(`conference hub (${view}) median ${JSON.stringify(m)}\n`);
    const failing = [...new Set(runs.flatMap((r) => r.failing))].join(', ') || 'none';
    expect
      .soft(m.performance, 'performance score (median)')
      .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.performance);
    expect
      .soft(m.accessibility, `accessibility score (median; failing audits: ${failing})`)
      .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.accessibility);
    expect
      .soft(m.bestPractices, `best practices score (median; failing audits: ${failing})`)
      .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.bestPractices);
    expect.soft(m.cls, 'cumulative layout shift (median)').toBeLessThanOrEqual(HUB_LIGHTHOUSE.cls);
    expect(runs.every((r) => r.viewport)).toBe(true);
  });
