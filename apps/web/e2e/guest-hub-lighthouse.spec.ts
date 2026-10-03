import { createServer } from 'node:net';
import { chromium, expect, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { guestHubScenario } from '@yayatoh/testing';
import lighthouse from 'lighthouse';

/**
 * M4.7a acceptance: "Lighthouse mobile thresholds met". A real Lighthouse run (its default mobile
 * profile: a mid-range phone, simulated slow 4G and 4× CPU throttling) against the built app, on a
 * party's hub with a seat and a ticket. Lighthouse emulates the phone itself, so it runs once, in
 * the mobile project. SEO is not scored: the page is `noindex` on purpose (P4-3).
 */

/**
 * The thresholds (scores 0–1, LCP in ms, CLS unitless): the roadmap's public-page bar (performance
 * ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.1, §9) plus accessibility and best practices at 95.
 */
const HUB_LIGHTHOUSE = {
  performance: 0.9,
  accessibility: 0.95,
  bestPractices: 0.95,
  lcpMs: 2_500,
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

test('the guest hub meets the Lighthouse mobile thresholds (M4.7a)', async ({ baseURL }, info) => {
  test.skip(info.project.name !== 'mobile-375', 'Lighthouse emulates the phone itself: one run');
  const orgId = (await resolveOrgSlug('lakeside-events'))?.orgId;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  const s = await guestHubScenario(orgId);
  const url = `${baseURL}/hub/${encodeURIComponent(s.garcia.token)}`;

  const port = await freePort();
  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${port}`],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  try {
    // Warm the server (fills its caches) without a browser visit, so no service worker is installed
    // before Lighthouse loads the page.
    expect((await fetch(url)).status).toBe(200);
    const run = await lighthouse(url, {
      port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
    });
    if (!run) throw new Error('Lighthouse returned nothing');
    const { categories, audits } = run.lhr;
    const scores = {
      performance: categories.performance?.score ?? 0,
      accessibility: categories.accessibility?.score ?? 0,
      bestPractices: categories['best-practices']?.score ?? 0,
      lcpMs: audits['largest-contentful-paint']?.numericValue ?? Number.POSITIVE_INFINITY,
      tbtMs: audits['total-blocking-time']?.numericValue ?? Number.POSITIVE_INFINITY,
      fcpMs: audits['first-contentful-paint']?.numericValue ?? Number.POSITIVE_INFINITY,
      cls: audits['cumulative-layout-shift']?.numericValue ?? Number.POSITIVE_INFINITY,
    };
    const failing = (cat: 'accessibility' | 'best-practices') =>
      (categories[cat]?.auditRefs ?? [])
        .filter((r) => r.weight > 0 && (audits[r.id]?.score ?? 1) < 1)
        .map((r) => r.id);
    await info.attach('lighthouse-scores', {
      body: JSON.stringify(
        {
          ...scores,
          failingAccessibility: failing('accessibility'),
          failingBestPractices: failing('best-practices'),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect.soft(scores.performance, 'performance score').toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.performance);
    expect
      .soft(scores.accessibility, `accessibility score (failing: ${failing('accessibility').join(', ')})`)
      .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.accessibility);
    expect
      .soft(scores.bestPractices, `best practices score (failing: ${failing('best-practices').join(', ')})`)
      .toBeGreaterThanOrEqual(HUB_LIGHTHOUSE.bestPractices);
    expect.soft(scores.lcpMs, 'largest contentful paint').toBeLessThanOrEqual(HUB_LIGHTHOUSE.lcpMs);
    expect.soft(scores.cls, 'cumulative layout shift').toBeLessThanOrEqual(HUB_LIGHTHOUSE.cls);
    // Phone-ready with no app: a mobile viewport, optimised for phones (no tap delay).
    expect(audits['meta-viewport']?.score).toBe(1);
    expect(audits['viewport-insight']?.score).toBe(1);
  } finally {
    await browser.close();
  }
});
