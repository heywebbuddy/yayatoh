import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const STAFF = 'omar@yayatoh.test';
const NOT_STAFF = 'pani@lakeside.test';

async function signIn(page: Page, email: string) {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))).toEqual(
    [],
  );
}

test('an organizer account is not staff: no console', async ({ page }) => {
  await signIn(page, NOT_STAFF);
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('heading', { name: 'Not a staff account' })).toBeVisible();
  await expectAccessible(page);
});

test('staff pause ticket sales for a tenant; the public page shows it at once; resuming restores sales', async ({
  page,
  browser,
}) => {
  await signIn(page, STAFF);
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  await expect(page.getByRole('heading', { name: 'Lakeside Events' })).toBeVisible();
  await expectAccessible(page);

  const sales = page.locator('form').filter({ hasText: 'Ticket sales' });
  // A previous failed run may have left it paused.
  const resume = sales.getByRole('button', { name: 'Resume Ticket sales' });
  if (await resume.isVisible()) {
    await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: reset');
    await resume.click();
  }
  await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: chargeback spike');
  await sales.getByRole('button', { name: 'Pause Ticket sales' }).click();
  await expect(page.getByText("Paused. It applies to the organizer's next request.")).toBeVisible();
  await expect(sales.getByText('Paused', { exact: true })).toBeVisible();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`${WEB}/events/lakeside-open-house`);
  await expect(guest.getByText('Ticket sales are paused')).toBeVisible();

  await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: resolved');
  await sales.getByRole('button', { name: 'Resume Ticket sales' }).click();
  await expect(page.getByText('Resumed.')).toBeVisible();
  await guest.reload();
  await expect(guest.getByText('Ticket sales are paused')).toHaveCount(0);

  // Every cross-tenant read is in the access log, with who did it.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: search tenants "lakeside"' }).first(),
  ).toBeVisible();
  await expectAccessible(page);
});
