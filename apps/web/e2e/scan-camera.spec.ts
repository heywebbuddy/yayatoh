import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { qrPath } from '@yayatoh/pdf';
import { signIn } from './helpers.ts';

function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A one-frame Y4M video of the QR for `code`, for Chromium's fake camera. */
function qrVideo(code: string): string {
  const [w, h] = [640, 480];
  const { size, d } = qrPath(code);
  const scale = Math.floor(400 / size);
  const [ox, oy] = [(w - size * scale) >> 1, (h - size * scale) >> 1];
  const y = Buffer.alloc(w * h, 235);
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const [mx, my] = [Number(m[1]), Number(m[2])];
    for (let dy = 0; dy < scale; dy++)
      y.fill(
        16,
        (oy + my * scale + dy) * w + ox + mx * scale,
        (oy + my * scale + dy) * w + ox + (mx + 1) * scale,
      );
  }
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128);
  const file = join(mkdtempSync(join(tmpdir(), 'yy-cam-')), 'qr.y4m');
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma]);
  writeFileSync(file, Buffer.concat([header, frame, frame, frame]));
  return file;
}

test.describe('Scan PWA camera', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('without BarcodeDetector (iOS Safari), the zxing fallback reads a ticket QR from the camera', async ({
    page,
    browser,
    baseURL,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name').fill(`Camera ${stamp}`);
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('Starts').fill(chicago(-1));
    await page.getByLabel('Ends').fill(chicago(3));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/camera-\d+$/);
    const base = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Lens pass');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Lens pass' })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${base.split('/').pop()}`);
    await guest.getByLabel('Quantity — Lens pass').selectOption('1');
    await guest.getByLabel('Full name').fill(`Cam ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`cam+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    const code = (await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';

    await page.goto(`${base}/onsite`);
    await page.getByLabel('Device name').fill(`Lens ${stamp}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';

    // A separate browser whose camera "sees" the ticket's QR; BarcodeDetector removed.
    const camBrowser = await chromium.launch({
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${qrVideo(code)}`,
      ],
    });
    try {
      const ctx = await camBrowser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      await ctx.grantPermissions(['camera']);
      await ctx.addInitScript(() => {
        delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
      });
      const device = await ctx.newPage();
      const wasm: string[] = [];
      device.on('request', (r) => {
        if (r.url().endsWith('.wasm')) wasm.push(new URL(r.url()).origin);
      });
      await device.goto(new URL(link, baseURL).pathname + new URL(link, baseURL).hash);
      await expect(device.getByRole('heading', { name: `Camera ${stamp}` })).toBeVisible();
      await device.getByRole('button', { name: 'Use camera' }).click();
      const result = device.getByRole('status').filter({ has: device.locator('[data-result]') });
      await expect(result).toContainText('Welcome in', { timeout: 20_000 });
      await expect(result).toContainText(`Cam ${stamp}`);
      // The decoder came from our own origin, not a CDN.
      expect(wasm).toEqual([new URL(baseURL ?? '').origin]);
    } finally {
      await camBrowser.close();
    }
  });
});
