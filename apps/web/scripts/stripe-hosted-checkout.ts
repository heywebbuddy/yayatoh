import { randomUUID } from 'node:crypto';
import { chromium, type Request } from '@playwright/test';
import { stripePaymentProvider } from '@yayatoh/payments';

/**
 * Manual check (M1.5e3, not CI): pay a real Stripe TEST-mode hosted Checkout Session with the
 * 4242 test card in headless Chromium, through this environment's egress proxy. Needs the owner's
 * test key in STRIPE_SECRET_KEY. Reports which hosts the hosted page needed and which the network
 * refused; it does not work around a refused host.
 *   node scripts/stripe-hosted-checkout.ts
 */
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key)) throw new Error('Set a Stripe TEST key in STRIPE_SECRET_KEY (never a live key)');
const provider = stripePaymentProvider({ secretKey: key, webhookSecrets: ['whsec_unused_for_outbound_calls'] });
const orderId = randomUUID();
const session = await provider.createPayment({
  orgId: randomUUID(),
  orderId,
  amount: { amount: 1250, currency: 'USD' },
  fundsFlow: 'platform_mor',
  connectedAccountId: null,
  applicationFee: { amount: 0, currency: 'USD' },
  buyerEmail: 'hosted-checkout@example.test',
  description: 'Yayatoh hosted checkout check',
  idempotencyKey: `hosted:${orderId}`,
  returnUrl: 'https://example.test/orders/hosted',
});
console.info('session', session.providerPaymentId);

const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
const page = await browser.newPage();
const hosts = new Map<string, { ok: number; failed: number; errors: Set<string> }>();
const note = (r: Request, failure?: string) => {
  const h = new URL(r.url()).host;
  const e = hosts.get(h) ?? { ok: 0, failed: 0, errors: new Set<string>() };
  if (failure) {
    e.failed++;
    e.errors.add(failure);
  } else e.ok++;
  hosts.set(h, e);
};
page.on('requestfinished', (r) => note(r));
page.on('requestfailed', (r) => note(r, r.failure()?.errorText ?? 'failed'));
let outcome = 'not paid';
try {
  await page.goto(session.redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Stripe's page may list payment methods first: pick Card when it does.
  const cardNumber = page.locator('#cardNumber');
  const card = page.getByRole('radio', { name: 'Card' });
  await card.or(cardNumber).first().waitFor({ timeout: 60_000 });
  if (!(await cardNumber.isVisible())) await card.click({ force: true });
  // No Link sign-up (it would ask for a phone number).
  const link = page.getByRole('checkbox', { name: /save my information/i });
  if (await link.isChecked().catch(() => false)) await link.uncheck();
  await cardNumber.fill('4242 4242 4242 4242', { timeout: 30_000 });
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  const name = page.locator('#billingName');
  if (await name.isVisible().catch(() => false)) await name.fill('Test Buyer');
  const zip = page.locator('#billingPostalCode');
  if (await zip.isVisible().catch(() => false)) await zip.fill('20001');
  await page.getByTestId('hosted-payment-submit-button').click();
  // The return URL's host need not be reachable: the navigation to it is the success signal.
  await page.waitForRequest((r) => r.url().startsWith('https://example.test/orders/hosted'), { timeout: 90_000 });
  outcome = 'paid: redirected to the return URL';
} catch (err) {
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  outcome = `stopped: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`;
}
const s = await (
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.providerPaymentId}`, {
    headers: { authorization: `Bearer ${key}` },
  })
).json();
console.info('outcome:', outcome);
console.info('session payment_status:', s.payment_status, 'status:', s.status);
for (const [h, e] of [...hosts].sort())
  console.info(`  ${h}: ${e.ok} ok, ${e.failed} failed ${e.errors.size ? [...e.errors].join(', ') : ''}`);
await browser.close();
