// Screenshots of the public pages in both themes at desktop and phone width, with a console check.
//   node scripts/theme-shots.mjs [baseUrl] [outDir]
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3130';
const out = process.argv[3] ?? '../../docs/qa/themes';
mkdirSync(out, { recursive: true });
const PAGES = (
  process.env.PAGES ??
  '/,/events,/events/harbor-spring-concert,/solutions/concerts,/pricing,/help,/contact,/features,/for-organizers,/blogs,/status,/privacy,/sign-in,/my-tickets,/nope'
).split(',');
const SIZES = [
  ['desktop', 1280, 800],
  ['phone', 375, 812],
];
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome' });
const rows = [];
for (const scheme of ['light', 'dark']) {
  for (const [label, width, height] of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    for (const path of PAGES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)));
      await page.goto(base + path, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const theme = await page.evaluate(() => getComputedStyle(document.body).colorScheme);
      const name = `${path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')}-${label}-${scheme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: false });
      // WCAG AA text contrast (axe), on the page as drawn in this theme.
      const axe = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      const contrast = axe.violations
        .flatMap((v) => v.nodes)
        .map((n) => `${n.target.join(' ')} ${n.any[0]?.data?.contrastRatio ?? ''}`);
      rows.push({
        path,
        label,
        scheme,
        theme,
        overflow,
        errors: errors.length,
        first: errors[0] ?? '',
        contrast,
      });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
for (const r of rows) {
  console.info(
    `${r.scheme.padEnd(5)} ${r.label.padEnd(7)} ${r.path.padEnd(32)} scheme=${r.theme} overflow=${r.overflow} errors=${r.errors} contrast=${r.contrast.length} ${r.first}`,
  );
  for (const c of r.contrast.slice(0, 4)) console.info(`        ${c}`);
}
