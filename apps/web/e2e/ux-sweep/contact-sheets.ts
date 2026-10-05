/**
 * Builds the U11 contact sheets from the sweep's full-size screenshots (docs/ux/sweep/full/):
 * one JPEG per width, theme and group of routes, with the route name under each thumbnail, plus
 * docs/ux/sweep/index.md. Run: `node apps/web/e2e/ux-sweep/contact-sheets.ts` after the sweep.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { REPO } from './routes.ts';

const OUT = join(REPO, 'docs/ux/sweep');
const FULL = join(OUT, 'full');
const SHEETS = join(OUT, 'sheets');
const PER_SHEET = 24;
const COLS = 6;
const THUMB = 250;

const files = readdirSync(FULL).filter((f) => f.endsWith('.jpg'));
const routes = [...new Set(files.map((f) => f.split('__')[0] ?? ''))].sort();
mkdirSync(SHEETS, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: COLS * (THUMB + 12) + 12, height: 800 } });
const index: string[] = [
  '# UX sweep contact sheets (U11)',
  '',
  `${routes.length} routes. Full-size shots are local (docs/ux/sweep/full, not committed); \`findings.json\` has the metrics.`,
  '',
];
for (const width of [1440, 1024, 390]) {
  for (const theme of ['light', 'dark']) {
    index.push(`## ${width} px, ${theme}`, '');
    for (let i = 0; i * PER_SHEET < routes.length; i++) {
      const group = routes.slice(i * PER_SHEET, (i + 1) * PER_SHEET);
      const cells = group
        .map((r) => {
          const f = join(FULL, `${r}__${width}__${theme}.jpg`);
          let src = '';
          try {
            src = `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
          } catch {
            return `<figure><div class="missing">missing</div><figcaption>${r}</figcaption></figure>`;
          }
          return `<figure><img src="${src}" alt=""><figcaption>${r}</figcaption></figure>`;
        })
        .join('');
      await page.setContent(
        `<style>body{margin:0;padding:12px;background:#fff;font:11px/1.2 system-ui;display:grid;grid-template-columns:repeat(${COLS},${THUMB}px);gap:12px}figure{margin:0}img{width:${THUMB}px;max-height:${THUMB * 1.6}px;object-fit:cover;object-position:top;border:1px solid #888;display:block}figcaption{word-break:break-all;margin-top:2px}.missing{height:60px;border:1px dashed red}</style>${cells}`,
      );
      const name = `${width}-${theme}-${String(i + 1).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: join(SHEETS, name), type: 'jpeg', quality: 60, fullPage: true });
      index.push(`- [${name}](sheets/${name}): ${group[0]} … ${group.at(-1)}`);
    }
    index.push('');
  }
}
await browser.close();
writeFileSync(join(OUT, 'index.md'), `${index.join('\n')}\n`);
process.stdout.write(`contact sheets: ${routes.length} routes\n`);
