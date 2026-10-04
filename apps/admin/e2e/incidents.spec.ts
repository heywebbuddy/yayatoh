import { expect, test } from '@playwright/test';
import { expectAccessible, MARKET, makeStaff, pickOption, signInStaff, webPage, webUser } from './helpers.ts';

// Incidents are platform-wide: one run posts and resolves its own, one project at a time.
test.describe.configure({ mode: 'serial' });

test('staff post an incident: validation, it appears on the status page and in the marketplace banner, updates close it', async ({
  page,
  browser,
}) => {
  test.skip(test.info().project.name !== 'desktop-1280', 'platform-wide state: one project posts incidents');
  test.setTimeout(120_000);
  const title = `Checkout slow ${Date.now()}`;
  await signInStaff(page);
  await page
    .getByRole('navigation', { name: 'Staff console' })
    .getByRole('link', { name: 'Incidents' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Status incidents' })).toBeVisible();
  await expectAccessible(page);

  // Validation: nothing typed.
  const form = page.getByRole('form', { name: 'Post an incident' });
  await form.getByRole('button', { name: 'Post incident' }).click();
  await expect(form.getByText('Give the incident a title (up to 160 characters).')).toBeVisible();
  await expect(form.getByText('Write the update (up to 2,000 characters).')).toBeVisible();

  // Keyboard: fill and submit without the mouse.
  await form.getByLabel('Title (shown publicly)').fill(title);
  await pickOption(form.getByLabel('Impact'), 'critical');
  await form.getByRole('checkbox', { name: 'Checkout' }).check();
  await form.getByLabel('First update (shown publicly)').fill('We are looking into slow checkouts.');
  await form.getByRole('button', { name: 'Post incident' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Incident posted. It is on the status page now.')).toBeVisible();
  const card = page.locator('section[aria-labelledby="incidents-list"] > div').filter({ hasText: title });
  await expect(card.getByText('Investigating').first()).toBeVisible();
  await expectAccessible(page);

  // The public status page and the marketplace banner show it.
  const web = await webPage(browser);
  await web.goto(`${MARKET}/status`);
  const open = web.locator('section[aria-labelledby="status-open"]');
  await expect(open.getByRole('heading', { name: title })).toBeVisible();
  await expect(web.locator('[data-component="checkout"]')).toContainText('Major outage');
  await web.goto(`${MARKET}/`);
  await expect(web.getByRole('region', { name: 'Service status' })).toBeVisible();

  // Close it with an update.
  const update = page.getByRole('form', { name: `Update ${title}` });
  await pickOption(update.getByLabel('New status'), 'resolved');
  await update.getByLabel('Update (shown publicly)').fill('Fixed: checkouts are fast again.');
  await update.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByRole('form', { name: `Update ${title}` })).toHaveCount(0);
  await expect(card.getByText('Fixed: checkouts are fast again.')).toBeVisible();

  await web.goto(`${MARKET}/status`);
  await expect(
    web.locator('section[aria-labelledby="status-past"]').getByRole('heading', { name: title }),
  ).toBeVisible();
  await expect(
    web.locator('section[aria-labelledby="status-open"]').getByRole('heading', { name: title }),
  ).toHaveCount(0);
  await web.close();

  // Every staff write is in the access log.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: `staff console: post status incident (critical): ${title}` }),
  ).toBeVisible();
});

test('finance staff have no incidents page (link hidden, page refused)', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const web = await webPage(browser);
  const finance = await webUser(web, { signIn: false });
  await web.close();
  makeStaff(finance.email, 'finance');
  await signInStaff(page, finance.email);
  await expect(
    page.getByRole('navigation', { name: 'Staff console' }).getByRole('link', { name: 'Incidents' }),
  ).toHaveCount(0);
  await page.goto('/incidents');
  await expect(page).toHaveURL(/\/not-staff$/);
});
