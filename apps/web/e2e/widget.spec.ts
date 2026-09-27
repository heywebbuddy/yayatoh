import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
/**
 * An organizer's own website, served for real by a small server in each test worker (one port
 * per project so parallel projects never collide). Every project allows all three shop origins,
 * so their saves agree. `evil.localhost` on the same server is a website nobody allowed.
 */
const SHOP_PORTS: Record<string, number> = { 'mobile-375': 4991, 'tablet-768': 4992, 'desktop-1280': 4993 };
const ALLOWED = Object.values(SHOP_PORTS).map((p) => `http://shop.localhost:${p}`);
const shopPort = () => SHOP_PORTS[test.info().project.name] ?? 4993;
const pages = new Map<string, string>();
let server: Server | null = null;

/** Put the organizer's snippet on a page of the shop server; returns its path. */
function hostPage(snippet: string): string {
  const path = `/tickets-${pages.size}`;
  pages.set(
    path,
    `<!doctype html><html lang="en"><head><title>Shop</title></head><body><main><h1>Our shop</h1>${snippet}</main></body></html>`,
  );
  return path;
}

test.describe('public site settings (M1.11a/c)', () => {
  test('an owner opens Public site from the console and sees the listing and widget sections', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events');
    // Small screens keep the console navigation behind a menu; the address works everywhere.
    const nav = page.getByRole('link', { name: 'Public site' }).first();
    if (await nav.isVisible()) await nav.click();
    else await page.goto('/o/lakeside-events/site');
    await expect(page).toHaveURL(/\/o\/lakeside-events\/site$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Public site');
    await expect(page.getByLabel('List my public events on the Yayatoh marketplace')).toBeChecked();
    await expect(page.getByLabel(/Use my own site at lakeside-events\.yayatoh\.events/)).not.toBeChecked();
    const snippets = page.getByRole('list', { name: 'Widget snippets' });
    await expect(snippets.getByLabel('Snippet for Lakeside Open House')).toHaveValue(
      /<iframe src="http:\/\/localhost:\d+\/embed\/lakeside-open-house"[^>]*data-yayatoh-widget/,
    );
    await expectAccessible(page);
  });

  test('allowed websites: a bad address is refused with a message; a good one persists', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/site');
    const form = page.locator('section', { has: page.getByRole('heading', { name: 'Ticket widget' }) });
    const origins = page.getByLabel('Websites allowed to show the widget');
    await origins.fill('http://not-https.example.com');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await origins.fill(`${ALLOWED.join('\n')}\n\n`);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(origins).toHaveValue(ALLOWED.join('\n'));
    await expectAccessible(page);
  });

  test('the snippet copies with the keyboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await page.goto('/o/lakeside-events/site');
    const copy = page.getByRole('button', { name: 'Copy snippet Snippet for Lakeside Open House' });
    await copy.focus();
    await page.keyboard.press('Enter');
    const item = page.getByRole('listitem').filter({ has: copy });
    await expect(item.getByText('Copied.')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('/embed/lakeside-open-house');
  });

  test('marketplace enrollment and the tenant site switch persist after reload', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-1280', 'changes org-wide settings');
    await signIn(page, 'maya@rosewood.test');
    await page.goto('/o/rosewood-weddings/site');
    const list = page.getByLabel('List my public events on the Yayatoh marketplace');
    const site = page.getByLabel(/Use my own site at rosewood-weddings/);
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Listing' }) });
    await list.check();
    await site.check();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(list).toBeChecked();
    await expect(site).toBeChecked();
    await list.uncheck();
    await site.uncheck();
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(list).not.toBeChecked();
    await expect(site).not.toBeChecked();
  });

  test('a viewer sees the settings read-only, with no controls to change them', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/site');
    await expect(page.getByText('Only owners and admins can change these settings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByLabel('List my public events on the Yayatoh marketplace')).toBeDisabled();
    await expect(page.getByLabel('Websites allowed to show the widget')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Arabic Public site renders right to left', async ({ page }) => {
    await signIn(page);
    await page.goto('/ar/o/lakeside-events/site');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الموقع العام');
    await expectAccessible(page);
  });
});

test.describe('embeddable ticket widget (M1.11c)', () => {
  // One worker per project runs this group, so each project's shop server owns its port.
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      const body = pages.get(req.url ?? '/');
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body ?? 'not found');
    });
    await new Promise<void>((resolve) => server?.listen(shopPort(), '127.0.0.1', resolve));
  });
  test.afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/site');
    const origins = page.getByLabel('Websites allowed to show the widget');
    if ((await origins.inputValue()) !== ALLOWED.join('\n')) {
      await origins.fill(ALLOWED.join('\n'));
      const form = page.locator('section', { has: page.getByRole('heading', { name: 'Ticket widget' }) });
      await form.getByRole('button', { name: 'Save' }).click();
      await expect(form.getByText('Saved.')).toBeVisible();
    }
  });

  test('the snippet on an allowed website shows the passes, resizes, and opens checkout', async ({
    page,
  }) => {
    const snippet = await page
      .getByRole('list', { name: 'Widget snippets' })
      .getByLabel('Snippet for Lakeside Jazz Night')
      .inputValue();
    await page.goto(`http://shop.localhost:${shopPort()}${hostPage(snippet)}`);
    const frame = page.frameLocator('iframe[data-yayatoh-widget]');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText('Lakeside Jazz Night');
    const passes = frame.getByRole('list', { name: 'Passes' });
    await expect(passes.getByText('Stalls')).toBeVisible();
    await expect(passes.getByText('Standing')).toBeVisible();
    // widget.js sets the iframe's height from the widget's postMessage.
    await expect
      .poll(async () =>
        page.locator('iframe[data-yayatoh-widget]').evaluate((f) => (f as HTMLElement).style.height),
      )
      .toMatch(/^\d+px$/);
    const get = frame.getByRole('link', { name: /Get tickets/ });
    await expect(get).toHaveAttribute('target', '_blank');
    const [checkout] = await Promise.all([page.context().waitForEvent('page'), get.click()]);
    await checkout.waitForLoadState();
    expect(checkout.url()).toBe(`http://localhost:${PORT}/events/lakeside-jazz-night#passes`);
    await expect(checkout.getByRole('heading', { name: 'Choose your pass' })).toBeVisible();
  });

  test('a website that is not allowed cannot frame the widget (CSP frame-ancestors)', async ({ page }) => {
    const res = await page.request.get('/embed/lakeside-open-house');
    // The full page CSP (M1.14a), with frame-ancestors widened to exactly the allowed origins.
    const csp = res.headers()['content-security-policy'] ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .find(([k]) => k === name)
        ?.slice(1);
    expect(directive('frame-ancestors')).toEqual(["'self'", ...ALLOWED]);
    expect(directive('script-src')?.some((v) => v.startsWith("'nonce-"))).toBe(true);
    expect(res.headers()['x-frame-options']).toBeUndefined();
    const snippet = await page
      .getByRole('list', { name: 'Widget snippets' })
      .getByLabel('Snippet for Lakeside Open House')
      .inputValue();
    await page.goto(`http://evil.localhost:${shopPort()}${hostPage(snippet)}`);
    await expect(page.getByRole('heading', { name: 'Our shop' })).toBeVisible();
    const frame = page.frameLocator('iframe[data-yayatoh-widget]');
    await expect(frame.getByRole('link', { name: /Get tickets/ })).toHaveCount(0, { timeout: 3000 });
    // Nothing was allowed to resize: the frame keeps the snippet's own height.
    expect(
      await page.locator('iframe[data-yayatoh-widget]').evaluate((f) => (f as HTMLElement).style.height),
    ).toBe('');
  });

  test('the widget page itself is accessible, in English and Arabic', async ({ page }) => {
    await page.goto('/embed/lakeside-open-house');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lakeside Open House');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectAccessible(page);
    await page.goto('/ar/embed/lakeside-open-house');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    expect((await page.goto('/embed/harper-and-theo'))?.status()).toBe(404);
  });
});
