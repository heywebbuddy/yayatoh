import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const bad = new Map();
for (let i = 0; i < 8; i++) {
  const c = await b.newContext({ colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const p = await c.newPage();
  p.on('response', (r) => r.status() >= 400 && bad.set(`${r.status()} ${r.url()}`, (bad.get(`${r.status()} ${r.url()}`) ?? 0) + 1));
  await p.goto('http://localhost:3130/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await c.close();
}
console.info([...bad.entries()]);
await b.close();
