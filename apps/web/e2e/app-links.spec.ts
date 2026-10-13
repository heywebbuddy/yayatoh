import { readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import {
  APP_TEAM_ID,
  ATTENDEE_BUNDLE,
  ATTENDEE_PACKAGE,
  FINGERPRINT,
  STAFF_BUNDLE,
  STAFF_PACKAGE,
} from './app-links-env.ts';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * App links (M7.2d): the two well-known files on every host the apps' entitlements can list and
 * nowhere else, never redirected, plus the enrolment link as a QR on the device screen. Request
 * checks send a Host header (Node can't resolve the tenant hosts); the browser checks use the page.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const AASA = '/.well-known/apple-app-site-association';
const LINKS = '/.well-known/assetlinks.json';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

/** One request to the e2e server as `host`, redirects not followed. */
function hit(host: string, path: string, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: PORT, path, method, headers: { host: `${host}:${PORT}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// Hosts that can be in the apps' entitlements: the marketplace, the dashboard and a tenant subdomain.
const LINK_HOSTS = ['yayatoh.com', 'app.yayatoh.com', 'lakeside-events.yayatoh.events'];
// Hosts that cannot: an organizer's own domain, a preview and a look-alike of the tenant apex.
const OTHER_HOSTS = [
  'tickets.verified.test',
  'preview-abc.vercel.app',
  'yayatoh.events.evil.test',
  'yayatoh.events',
];

test.describe('well-known app link files', () => {
  for (const host of LINK_HOSTS) {
    test(`${host} serves both files as JSON without a redirect`, async () => {
      for (const path of [AASA, LINKS]) {
        const r = await hit(host, path);
        expect(r.status, `${host}${path}`).toBe(200);
        expect(r.headers['content-type']).toBe('application/json');
        expect(r.headers.location).toBeUndefined();
        expect(r.headers['set-cookie']).toBeUndefined();
        expect(() => JSON.parse(r.text)).not.toThrow();
      }
    });
  }

  test('the Apple file lists both apps, the path allowlist and webcredentials', async () => {
    const aasa = JSON.parse((await hit('app.yayatoh.com', AASA)).text);
    const attendee = `${APP_TEAM_ID}.${ATTENDEE_BUNDLE}`;
    const staff = `${APP_TEAM_ID}.${STAFF_BUNDLE}`;
    const [tickets, door] = aasa.applinks.details;
    expect(tickets.appIDs).toEqual([attendee, `${attendee}.dev`]);
    const paths = tickets.components.map((c: { '/': string }) => c['/']);
    for (const p of [
      '/events/*',
      '/e/*',
      '/my-tickets/*',
      '/orders/*',
      '/claim/*',
      '/ar/events/*',
      '/de/claim/*',
    ])
      expect(paths, p).toContain(p);
    // Sign-in, checkout and the console never open the app.
    expect(paths.some((p: string) => /sign-in|checkout|\/o\//.test(p))).toBe(false);
    expect(door.appIDs).toEqual([staff]);
    // Only an enrolment link (it carries the fragment), not the bare scanner page.
    expect(door.components).toContainEqual({ '/': '/scan', '#': 'e=*' });
    expect(aasa.webcredentials.apps).toEqual([attendee, `${attendee}.dev`, staff]);
  });

  test('the Android file lists both packages with their fingerprints', async () => {
    const links = JSON.parse((await hit('lakeside-events.yayatoh.events', LINKS)).text);
    expect(links.map((l: { target: { package_name: string } }) => l.target.package_name)).toEqual([
      ATTENDEE_PACKAGE,
      STAFF_PACKAGE,
    ]);
    for (const l of links) {
      expect(l.relation).toContain('delegate_permission/common.handle_all_urls');
      expect(l.target.namespace).toBe('android_app');
      expect(l.target.sha256_cert_fingerprints).toEqual([FINGERPRINT]);
    }
  });

  for (const host of OTHER_HOSTS) {
    test(`${host} answers 404 for both files, with no redirect`, async () => {
      for (const path of [AASA, LINKS]) {
        const r = await hit(host, path);
        expect(r.status, `${host}${path}`).toBe(404);
        expect(r.headers.location).toBeUndefined();
        expect(r.headers['content-type']).not.toContain('json');
      }
    });
  }

  test('locale prefixes, trailing slashes and other methods are not served or redirected', async () => {
    for (const path of [`/ar${AASA}`, `/fr${LINKS}`, `${AASA}/`, `${LINKS}/`, `${AASA}.json`]) {
      const r = await hit('app.yayatoh.com', path);
      expect(r.headers['content-type'] ?? '', path).not.toBe('application/json');
    }
    const head = await hit('app.yayatoh.com', AASA, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
    const post = await hit('app.yayatoh.com', AASA, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  test('a front-door host and a signed-out visitor still get the file (nothing intercepts it)', async () => {
    const r = await hit('yay.frontdoor.localhost', AASA);
    expect(r.status).toBe(200);
    expect(r.headers.location).toBeUndefined();
  });
});

test.describe('enrolment link QR', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const screen = `${OPEN_HOUSE}/onsite`;

  test('shows the setup link as a QR that decodes to exactly the text link, and keeps the key out of requests', async ({
    page,
  }) => {
    const stamp = Date.now();
    const urls: string[] = [];
    page.on('request', (req) => urls.push(req.url()));
    await signIn(page);
    await page.goto(screen);
    await expect(page.getByTestId('scan-qr')).toHaveCount(0);
    await page.getByLabel('Device name').fill(`QR ${test.info().project.name} ${stamp}`);
    await page.getByRole('button', { name: 'Add device' }).click();

    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';
    expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);
    const qr = page.getByRole('img', { name: 'QR code of the setup link' });
    await expect(qr).toBeVisible();
    await expect(page.getByText('The key stays in the link and is never sent to the server.')).toBeVisible();
    expect(await decodeQr((await qr.locator('path').getAttribute('d')) ?? '')).toBe(link);
    await expectAccessible(page);

    // The key lives in the fragment: no request, from the page or its server actions, carried it.
    const key = decodeURIComponent(new URL(link).hash.match(/k=([^&]+)/)?.[1] ?? '');
    expect(key).toMatch(/^yyd_/);
    expect(urls.filter((u) => u.includes(key) || u.includes('yyd_'))).toEqual([]);
  });

  test('the Arabic screen renders the QR with a translated label', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${screen}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const label = page.locator('input[name="label"]');
    await label.fill(`AR ${test.info().project.name} ${Date.now()}`);
    // The add-device form's own button: another form (the mobile menu's) can come first in the page.
    await label.locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    const qr = page.getByTestId('scan-qr');
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute('aria-label')).not.toBe('QR code of the setup link');
    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';
    expect(link).toMatch(/\/ar\/scan#e=[0-9a-f-]{36}&k=yyd_/);
    expect(await decodeQr((await qr.locator('path').getAttribute('d')) ?? '')).toBe(link);
    await expectAccessible(page);
  });

  test('a viewer cannot add a device, so no link or QR is shown', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto(screen);
    await expect(page.getByRole('button', { name: 'Add device' })).toHaveCount(0);
    await expect(page.getByTestId('scan-qr')).toHaveCount(0);
  });
});

let zxingReady: Promise<unknown> | null = null;
/** Read the QR back with zxing (the scanner's decoder): rasterise its unit squares. */
async function decodeQr(d: string): Promise<string | undefined> {
  zxingReady ??= (async () => {
    const entry = createRequire(import.meta.url).resolve('zxing-wasm/reader');
    const wasm = readFileSync(join(dirname(entry), '..', '..', 'reader', 'zxing_reader.wasm'));
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
  })();
  await zxingReady;
  const squares = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const size = Math.max(...squares.flat()) + 5;
  const scale = 4;
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [x, y] of squares)
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * width + x * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  const [hit] = await readBarcodes({ data, width, height: width, colorSpace: 'srgb' } as ImageData, {
    formats: ['QRCode'],
    maxNumberOfSymbols: 1,
  });
  return hit?.text;
}
