import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { FD_YAY_HOST } from './front-door-env.ts';
import {
  devPassword,
  expectAccessible,
  makeStaff,
  replayForm,
  serverForm,
  signInStaff,
  WEB_PORT,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * The front-door console (M2.4a): the route table per legacy host with flag states and counters,
 * the 404 top list, and moving a route (admins, with a step-up, audited). The web server of this
 * suite forwards the front-door hosts to the local legacy stub (never a live site).
 */
const YAY = `http://${FD_YAY_HOST}:${WEB_PORT}`;
const ROUTE = 'content.pages';

const routesTable = (page: Page) => page.getByRole('table', { name: 'Moved routes' });
const row = (page: Page, host: string, route: string) =>
  routesTable(page).getByRole('row').filter({ hasText: host }).filter({ hasText: route });

/** Keyboard only: host, route, who serves it, reason, password, submit. */
async function moveRoute(
  page: Page,
  state: 'Legacy' | 'Canary (yy_canary cookie only)' | 'New app',
  password: string,
  reason: string,
) {
  const form = page.getByRole('form', { name: 'Move a route' });
  await form.getByLabel('Host', { exact: true }).focus();
  await page.keyboard.type('yay.front');
  await expect(form.getByLabel('Host', { exact: true })).toHaveValue(FD_YAY_HOST);
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Route', { exact: true })).toBeFocused();
  await page.keyboard.type('content.p');
  await expect(form.getByLabel('Route', { exact: true })).toHaveValue(ROUTE);
  await page.keyboard.press('Tab');
  // The radio group: Space checks the first choice, arrows move the choice.
  await page.keyboard.press('Space');
  const order = ['Legacy', 'Canary (yy_canary cookie only)', 'New app'] as const;
  for (let i = 0; i < order.indexOf(state); i++) await page.keyboard.press('ArrowRight');
  await expect(form.getByRole('radio', { name: state, exact: true })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Reason', { exact: true })).toBeFocused();
  await page.keyboard.type(reason);
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Your password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Move route' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForLoadState('load');
}

/** Who answers a page on the front-door host (the stub's pages name the legacy instance). */
async function servedBy(page: Page, path: string): Promise<string | undefined> {
  const res = await page.goto(`${YAY}${path}`);
  return res?.headers()['x-front-door'];
}

test('admins move a route with a step-up; the change is audited, persists and takes effect', async ({
  page,
  browser,
}) => {
  const tag = randomBytes(3).toString('hex');
  await signInStaff(page);
  // Start from legacy (reruns and the other viewport leave it there, but be sure).
  await page.goto('/front-door');
  if (!(await row(page, FD_YAY_HOST, ROUTE).textContent())?.includes('Legacy'))
    await moveRoute(page, 'Legacy', devPassword(), `e2e reset ${tag}`);

  // From the nav.
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Staff console' })
    .getByRole('link', { name: 'Front door' })
    .click();
  await expect(page.getByRole('heading', { name: 'Front door', level: 1 })).toBeVisible();
  await expect(page.getByText('Route table version 2.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Legacy hosts' })).toContainText(FD_YAY_HOST);
  await expect(page.getByRole('list', { name: 'Legacy hosts' })).toContainText(
    'Legacy origin set: front door on',
  );
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('Legacy');
  await expectAccessible(page);

  // A legacy 404 on the front-door host shows up in the top list.
  const web = await webPage(browser);
  const missing = `/missing/fd-console-${tag}`;
  expect((await web.goto(`${YAY}${missing}`))?.status()).toBe(404);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page
          .getByRole('table', { name: '404 top list' })
          .getByRole('row')
          .filter({ hasText: missing })
          .count();
      },
      { timeout: 10_000 },
    )
    .toBe(1);
  await expect(page.getByRole('table', { name: 'Other traffic' })).toContainText('Everything else (legacy)');

  // Before: legacy answers the route.
  expect(await servedBy(web, `/pages/fd-${tag}`)).toBe('legacy');

  // A wrong password changes nothing.
  await moveRoute(page, 'New app', 'not-the-password', `e2e move ${tag}`);
  await expect(
    page.getByRole('alert').filter({ hasText: "That code or password isn't right. Nothing changed." }),
  ).toBeVisible();
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('Legacy');

  // The right one moves it; the table, the audit trail and the web agree, also after a reload.
  await moveRoute(page, 'New app', devPassword(), `e2e move ${tag}`);
  await expect(page.getByRole('status').filter({ hasText: 'Route updated.' })).toBeVisible();
  await page.reload();
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('New app');
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('Omar');
  const changes = page.getByRole('list', { name: 'Recent changes' });
  await expect(changes.getByRole('listitem').filter({ hasText: `e2e move ${tag}` })).toContainText(
    `${FD_YAY_HOST}: ${ROUTE} from Legacy to New app`,
  );
  await expect.poll(() => servedBy(web, `/pages/fd-${tag}`), { timeout: 5_000 }).toBe('next');
  await expectAccessible(page);

  // And back.
  await moveRoute(page, 'Legacy', devPassword(), `e2e back ${tag}`);
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('Legacy');
  await expect.poll(() => servedBy(web, `/pages/fd-${tag}`), { timeout: 5_000 }).toBe('legacy');
  await expect(web.getByRole('heading', { name: `Legacy yay /pages/fd-${tag}` })).toBeVisible();
  await web.context().close();
});

test('support sees the table but no control, and a replayed change is refused', async ({ page, browser }) => {
  const tag = randomBytes(3).toString('hex');
  // The admin's form, as the server rendered it for them.
  await signInStaff(page);
  await page.goto('/front-door');
  const form = await serverForm(page, 'Move a route');

  const web = await webPage(browser);
  const support = await webUser(web, { signIn: false });
  await web.context().close();
  makeStaff(support.email, 'support');
  const other = await (await browser.newContext({ baseURL: page.url() })).newPage();
  await signInStaff(other, support.email);
  await other.goto('/front-door');
  await expect(other.getByRole('heading', { name: 'Front door', level: 1 })).toBeVisible();
  await expect(routesTable(other)).toBeVisible();
  await expect(other.getByText('Only admins can move routes.')).toBeVisible();
  await expect(other.getByRole('form', { name: 'Move a route' })).toHaveCount(0);
  await expectAccessible(other);

  await replayForm(other, form, {
    host: FD_YAY_HOST,
    route: ROUTE,
    state: 'next',
    reason: `e2e support ${tag}`,
    password: devPassword(),
  });
  await expect(other).toHaveURL(/\/not-staff$/);
  await page.reload();
  await expect(row(page, FD_YAY_HOST, ROUTE)).toContainText('Legacy');
  await expect(page.getByRole('list', { name: 'Recent changes' })).not.toContainText(`e2e support ${tag}`);
  await other.context().close();
});

test('the page lays out with logical properties (right to left)', async ({ page }) => {
  // The console is English-only for now (owner inbox); its layout must still hold when mirrored.
  await signInStaff(page);
  await page.goto('/front-door');
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const nav = await page.getByRole('navigation', { name: 'Staff console' }).boundingBox();
  const who = await page.getByText('Omar Ops · Admin', { exact: true }).boundingBox();
  const product = await page.locator('header').getByText('Yayatoh staff', { exact: true }).boundingBox();
  expect(nav && who && product).toBeTruthy();
  // `ms-auto` pushes "signed in as" to the inline end: the left side when right to left. Batch 3c
  // merge: the staff nav now fills a row of its own (openSignup, incidents, front door,
  // maintenance…), so the reference is the product name at the inline start of the header.
  if (who && product && (page.viewportSize()?.width ?? 0) >= 1024)
    expect(who.x + who.width).toBeLessThan(product.x);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expectAccessible(page);
});
