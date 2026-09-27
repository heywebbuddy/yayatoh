import { type Browser, expect, type Page, test } from '@playwright/test';
import { EVENT, expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * M1.14a request protection: CSP profiles with per-response nonces, the other security headers,
 * zero CSP violations on key pages, rate limits (429 + Retry-After + localized UI) and the CSP
 * report endpoint.
 */

/** Collect CSP violations (the DOM event and the console message) from the page's first byte. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return violations;
}

function directives(header: string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (header ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

/** A client IP of this test's own (TEST-NET-3), so per-IP ceilings never collide across tests. */
const testIp = () => `203.0.113.${1 + Math.floor(Math.random() * 254)}`;
const ipContext = (browser: Browser) => browser.newContext({ extraHTTPHeaders: { 'x-real-ip': testIp() } });

const unique = () => `${test.info().project.name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe('security headers and CSP', () => {
  test('console pages: strict nonce profile, fresh nonce per response, stamped on every script', async ({
    page,
  }) => {
    await signIn(page);
    const res = await page.goto('/o/lakeside-events');
    const h = res?.headers() ?? {};
    const csp = directives(h['content-security-policy']);
    const script = csp.get('script-src') ?? [];
    expect(script).toContain("'strict-dynamic'");
    expect(script.join(' ')).not.toMatch(/unsafe-inline|unsafe-eval/);
    const nonce = script.find((s) => s.startsWith("'nonce-"))?.slice(7, -1);
    expect(nonce).toBeTruthy();
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('style-src-attr')).toEqual(["'none'"]);
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['reporting-endpoints']).toContain('/api/csp-report');

    // Every script element carries this response's nonce (browsers hide it from getAttribute
    // once applied; the `nonce` property keeps it).
    const nonces = await page
      .locator('script')
      .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(nonces.length).toBeGreaterThan(0);
    for (const n of nonces) expect(n).toBe(nonce);

    const again = await page.goto('/o/lakeside-events');
    const next = directives(again?.headers()['content-security-policy']).get('script-src') ?? [];
    expect(next.find((s) => s.startsWith("'nonce-"))).not.toBe(`'nonce-${nonce}'`);
  });

  test('public pages: host-allowlist profile without strict-dynamic, same-origin framing', async ({
    page,
  }) => {
    const res = await page.goto(OPEN_HOUSE.replace('/o/lakeside-events/e/', '/events/'));
    const h = res?.headers() ?? {};
    const csp = directives(h['content-security-policy']);
    expect(csp.get('script-src')?.[0]).toBe("'self'");
    expect(csp.get('script-src')).not.toContain("'strict-dynamic'");
    expect(csp.get('frame-ancestors')).toEqual(["'self'"]);
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('token pages never leak their URL through Referer; the scanner may use the camera', async ({
    page,
  }) => {
    const token = await page.goto(`/orders/${'x'.repeat(43)}`);
    expect(token?.headers()['referrer-policy']).toBe('no-referrer');
    await signIn(page);
    const scan = await page.goto('/scan');
    expect(scan?.headers()['permissions-policy']).toContain('camera=(self)');
    expect(scan?.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  });

  test('API responses cannot render or be framed', async ({ request }) => {
    const res = await request.post('/api/csp-report', {
      data: 'nope',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('a device cookie is issued once, HttpOnly and SameSite=Lax', async ({ page, context }) => {
    await page.goto('/sign-in');
    const c = (await context.cookies()).find((x) => x.name === 'yy_did');
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
    await page.goto('/sign-in');
    expect((await context.cookies()).find((x) => x.name === 'yy_did')?.value).toBe(c?.value);
  });
});

test.describe('no CSP violations on key pages', () => {
  const consolePages = [
    '/o/lakeside-events',
    '/o/lakeside-events/settings',
    '/o/lakeside-events/team',
    EVENT,
    `${EVENT}/attendees`,
    `${EVENT}/analysis`,
    `${OPEN_HOUSE}/seating`,
    `${OPEN_HOUSE}/tickets-orders`,
    '/ar/o/lakeside-events',
    '/scan',
  ];
  for (const path of consolePages) {
    test(`console ${path}`, async ({ page }) => {
      const violations = await watchCsp(page);
      await signIn(page);
      await page.goto(path);
      await expect(page).toHaveTitle(/\S/);
      // Let hydration and any lazy chunks run.
      await page.waitForLoadState('networkidle');
      expect(violations).toEqual([]);
    });
  }

  const publicPages = ['/', '/sign-in', '/events/lakeside-open-house', '/ar/events/lakeside-open-house'];
  for (const path of publicPages) {
    test(`public ${path}`, async ({ page }) => {
      const violations = await watchCsp(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(violations).toEqual([]);
    });
  }

  test('client navigation and a Server Action run under the CSP', async ({ page }) => {
    const violations = await watchCsp(page);
    await signIn(page);
    await page.goto('/o/lakeside-events/settings');
    // The brand preview is coloured through the CSSOM, never a style attribute.
    await page.getByLabel('Brand colour', { exact: true }).fill('#1d4ed8');
    await expect(page.getByTestId('brand-preview')).toHaveCSS('background-color', 'rgb(29, 78, 216)');
    const menu = page.locator('summary').filter({ hasText: 'Open menu' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation').getByRole('link', { name: 'Team' }).locator('visible=true').click();
    await expect(page).toHaveURL(/\/team$/);
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
});

test.describe('rate limits', () => {
  test('sign-in: a 429 after 10 rapid attempts, with a localized message and Retry-After', async ({
    browser,
  }) => {
    const page = await (await ipContext(browser)).newPage();
    await page.goto('/sign-in');
    const email = `limit-${unique()}@example.test`;
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong-password-1');
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });
    for (let i = 0; i < 10; i++) {
      const res = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/email'));
      await submit.click();
      expect((await res).status()).toBe(401);
      await expect(page.getByRole('alert').filter({ hasText: "don't match" })).toBeVisible();
    }
    const limited = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/email'));
    await submit.click();
    const res = await limited;
    expect(res.status()).toBe(429);
    expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
    await expect(
      page.getByRole('alert').filter({ hasText: /Too many sign-in attempts\. Try again in \d+ minutes?\./ }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('sign-in 429 in Arabic (RTL)', async ({ browser }) => {
    const page = await (await ipContext(browser)).newPage();
    await page.goto('/ar/sign-in');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const email = `limit-ar-${unique()}@example.test`;
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill('wrong-password-1');
    const submit = page.locator('button[type=submit]');
    let status = 0;
    for (let i = 0; i < 11 && status !== 429; i++) {
      const res = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/email'));
      await submit.click();
      status = (await res).status();
    }
    expect(status).toBe(429);
    await expect(page.getByRole('alert').filter({ hasText: 'محاولات تسجيل دخول كثيرة جدًا' })).toBeVisible();
  });

  test('the limit is per device: another device on the same IP is unaffected', async ({
    browser,
    baseURL,
  }) => {
    const email = `limit-dev-${unique()}@example.test`;
    const headers = { origin: baseURL as string };
    // Both devices share one client IP (a venue): only the device bucket separates them.
    const shared = { extraHTTPHeaders: { 'x-real-ip': testIp() } };
    const a = await (await browser.newContext(shared)).newPage();
    await a.goto('/sign-in');
    const attempt = (p: Page, who = email) =>
      p.request.post('/api/auth/sign-in/email', {
        data: { email: who, password: 'x-wrong-password' },
        headers,
      });
    for (let i = 0; i < 10; i++) expect((await attempt(a)).status()).toBe(401);
    const blocked = await attempt(a);
    expect(blocked.status()).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    const b = await (await browser.newContext(shared)).newPage();
    await b.goto('/sign-in');
    expect((await attempt(b, `other-${unique()}@example.test`)).status()).toBe(401);
  });

  test('holder magic link: a localized 429 after 10 requests from one device', async ({ browser }) => {
    const page = await (await ipContext(browser)).newPage();
    await page.goto('/events/lakeside-open-house');
    const email = `holder-${unique()}@example.test`;
    const field = page.getByLabel('Email', { exact: true });
    const send = page.getByRole('button', { name: 'Email me a link' });
    for (let i = 0; i < 10; i++) {
      await field.fill(email);
      await send.click();
      await expect(
        page.getByText('If that email has tickets for this event, a link is on its way.'),
      ).toBeVisible();
      await page.reload();
    }
    await field.fill(email);
    await send.click();
    await expect(
      page.getByRole('alert').filter({ hasText: /Too many attempts\. Try again in \d+ minutes?\./ }),
    ).toBeVisible();
  });

  test('forged webhooks: 400, then 429 with Retry-After', async ({ browser, baseURL }) => {
    // A device of its own, so reruns and parallel projects never share the bucket.
    const context = await ipContext(browser);
    const device = `e2e${unique().replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40);
    await context.addCookies([{ name: 'yy_did', value: device, url: baseURL as string }]);
    const post = () =>
      context.request.post('/api/webhooks/fake', {
        data: { type: 'payment.succeeded', orderId: 'x' },
        headers: { 'x-fake-signature': 'deadbeef' },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await post()).status());
    expect(statuses).toEqual(Array(30).fill(400));
    const last = await post();
    expect(last.status()).toBe(429);
    expect(Number(last.headers()['retry-after'])).toBeGreaterThan(0);
    await context.close();
  });
});

test.describe('CSP report endpoint', () => {
  test('accepts report-uri and Reporting API bodies; rejects anything else', async ({ request }) => {
    const legacy = await request.post('/api/csp-report', {
      data: JSON.stringify({
        'csp-report': {
          'document-uri': 'http://localhost/orders/secret-token?x=1',
          'violated-directive': 'script-src',
          'blocked-uri': 'inline',
        },
      }),
      headers: { 'content-type': 'application/csp-report' },
    });
    expect(legacy.status()).toBe(204);
    const modern = await request.post('/api/csp-report', {
      data: JSON.stringify([
        {
          type: 'csp-violation',
          body: { documentURL: 'http://localhost/', effectiveDirective: 'script-src-elem' },
        },
      ]),
      headers: { 'content-type': 'application/reports+json' },
    });
    expect(modern.status()).toBe(204);
    expect(
      (
        await request.post('/api/csp-report', {
          data: '{}',
          headers: { 'content-type': 'application/csp-report' },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post('/api/csp-report', { data: 'x', headers: { 'content-type': 'text/plain' } })
      ).status(),
    ).toBe(415);
    expect(
      (
        await request.post('/api/csp-report', {
          data: `{"csp-report":{"x":"${'a'.repeat(20_000)}"}}`,
          headers: { 'content-type': 'application/csp-report' },
        })
      ).status(),
    ).toBe(413);
  });
});
