import { expect, type Page, test } from '@playwright/test';
import { parseCsp } from '@yayatoh/platform/security';
import { signInStaff } from './helpers.ts';

/** Collect CSP violations the page reports (installed before any script runs). */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  const console: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) console.push(m.text());
  });
  return async () => [
    ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
    ...console,
  ];
}

test('staff console pages carry the strict nonce CSP and the console security headers (M1.3f)', async ({
  page,
  request,
}) => {
  const first = await request.get('/sign-in');
  const second = await request.get('/sign-in');
  expect(first.status()).toBe(200);
  const h = first.headers();
  const csp = parseCsp(h['content-security-policy'] ?? '');
  const script = csp.get('script-src') ?? [];
  const nonce = script.find((s) => s.startsWith("'nonce-"));
  expect(nonce).toMatch(/^'nonce-[A-Za-z0-9+/_-]{16,}={0,2}'$/);
  expect(script).toContain("'strict-dynamic'");
  expect(script.join(' ')).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(csp.get('style-src')).toEqual(["'self'", nonce]);
  expect(csp.get('style-src-attr')).toEqual(["'none'"]);
  expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  expect(csp.get('object-src')).toEqual(["'none'"]);
  expect(csp.get('base-uri')).toEqual(["'none'"]);
  expect(csp.get('form-action')).toEqual(["'self'"]);
  expect(csp.get('report-uri')).toEqual(['/api/csp-report']);
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['cross-origin-resource-policy']).toBe('same-origin');
  expect(h['x-powered-by']).toBeUndefined();
  // A fresh nonce on every response.
  expect(second.headers()['content-security-policy']).not.toBe(h['content-security-policy']);

  // Every script Next renders carries this response's nonce; nothing is blocked while staff sign
  // in, open a tenant, and run a Server Action.
  const violations = await watchViolations(page);
  const res = await page.goto('/sign-in');
  const pageNonce = /'nonce-([^']+)'/.exec(res?.headers()['content-security-policy'] ?? '')?.[1];
  const nonces = await page.evaluate(() => [...document.scripts].map((s) => s.nonce));
  expect(nonces.length).toBeGreaterThan(0);
  expect(new Set(nonces)).toEqual(new Set([pageNonce]));
  // No style attributes in the server's HTML (style-src-attr 'none'; Next's own runtime elements
  // are styled through the CSSOM, which the policy allows).
  expect(await (await page.request.get('/sign-in')).text()).not.toMatch(/\sstyle="/);
  await signInStaff(page);
  await page.goto('/?q=lakeside');
  await page.getByRole('link', { name: 'Lakeside Events', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lakeside Events', level: 1 })).toBeVisible();
  await page.goto('/signup-codes');
  await page
    .getByRole('form', { name: 'Create a signup code' })
    .getByLabel('Uses', { exact: true })
    .fill('0');
  await page.getByRole('button', { name: 'Create code' }).click();
  await expect(page.getByText('Uses must be a whole number from 1 to 1000.')).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('API routes get the locked-down policy; the CSP report endpoint takes both formats', async ({
  request,
}) => {
  const session = await request.get('/api/auth/get-session');
  expect(session.headers()['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(session.headers()['x-frame-options']).toBe('DENY');
  const legacy = await request.post('/api/csp-report', {
    headers: { 'content-type': 'application/csp-report' },
    data: JSON.stringify({
      'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.test/x.js?token=1' },
    }),
  });
  expect(legacy.status()).toBe(204);
  const modern = await request.post('/api/csp-report', {
    headers: { 'content-type': 'application/reports+json' },
    data: JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'style-src-attr' } }]),
  });
  expect(modern.status()).toBe(204);
  const wrongType = await request.post('/api/csp-report', {
    headers: { 'content-type': 'text/plain' },
    data: 'x',
  });
  expect(wrongType.status()).toBe(415);
  const empty = await request.post('/api/csp-report', {
    headers: { 'content-type': 'application/json' },
    data: '[]',
  });
  expect(empty.status()).toBe(400);
});
