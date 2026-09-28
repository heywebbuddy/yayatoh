import { expect, test } from '@playwright/test';
import { expectAccessible, makeStaff, signInStaff, WEB, webPage, webUser } from './helpers.ts';

/** Signup codes in the staff console (M1.3f): create (shown once), use, revoke; who may. */
test('staff create a signup code (shown once), a newcomer signs up with it, and staff revoke it', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const note = `e2e code ${stamp}`;
  await signInStaff(page);
  await page
    .getByRole('navigation', { name: 'Staff console' })
    .getByRole('link', { name: 'Signup codes' })
    .click();
  await expect(page).toHaveURL(/\/signup-codes$/);
  await expect(page.getByRole('heading', { name: 'Signup codes', level: 1 })).toBeVisible();
  await expectAccessible(page);

  // Every field is checked, with its own message; what was typed stays.
  const form = page.getByRole('form', { name: 'Create a signup code' });
  await form.getByLabel('Uses', { exact: true }).fill('0');
  await form.getByLabel('Valid for (days)', { exact: true }).fill('400');
  await form.getByLabel('Note', { exact: true }).fill('   ');
  await form.getByRole('button', { name: 'Create code' }).click();
  await expect(form.getByText('Uses must be a whole number from 1 to 1000.')).toBeVisible();
  await expect(form.getByText('Days must be a whole number from 1 to 365.')).toBeVisible();
  await expect(form.getByText('Add a note of up to 200 characters.')).toBeVisible();
  await expect(form.getByLabel('Uses', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Uses', { exact: true })).toHaveValue('0');
  await expectAccessible(page);

  // Keyboard only: fill and submit.
  await form.getByLabel('Uses', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type(note);
  await page.keyboard.press('Enter');
  const created = page.getByRole('region', { name: 'New signup code' });
  await expect(created).toContainText("Copy it now: it won't be shown again.");
  const code = (await created.locator('.font-mono').innerText()).trim();
  expect(code).toMatch(/^YY-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const row = page.getByRole('row').filter({ hasText: note });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('2 of 2');
  await expect(row).toContainText('Omar');
  await expectAccessible(page);

  // Shown once: after a reload only the note is listed.
  await page.reload();
  await expect(page.getByText(code)).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: note })).toContainText('2 of 2');

  // A newcomer signs up with it on the web app.
  const newcomer = await webPage(browser);
  await webUser(newcomer, { twoFactor: true });
  await newcomer.goto(`/signup?code=${code}`);
  await newcomer.getByLabel('Organization name', { exact: true }).fill(`Code Org ${stamp}`);
  await newcomer.getByRole('radio', { name: /Conference/ }).check();
  await newcomer.getByLabel(/I agree to the Terms of Service/).check();
  await newcomer.getByRole('button', { name: 'Create organization' }).click();
  await expect(newcomer).toHaveURL(new RegExp(`/o/code-org-${stamp}$`));
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: note })).toContainText('1 of 2');

  // Revoke with the keyboard: it stops working at once.
  const revoke = page.getByRole('button', { name: `Revoke the code “${note}”` });
  await revoke.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Code revoked. It no longer works for new signups.')).toBeVisible();
  const revoked = page.getByRole('row').filter({ hasText: note });
  await expect(revoked).toContainText('Revoked');
  await expect(revoked).toContainText(/Revoked by Omar .* on /);
  await expect(revoked.getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
  await newcomer.goto(`/signup?code=${code}`);
  await expect(newcomer.getByText("This signup code isn't valid")).toBeVisible();
  await newcomer.close();

  // Both are in the access log.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: `staff console: create signup code (2 uses, 10 days): ${note}` }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: /^staff console: revoke signup code / }).first()).toBeVisible();
});

test('finance staff have no signup codes (link hidden, page refused); support staff do', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const web = await webPage(browser);
  const finance = await webUser(web, { signIn: false });
  const support = await webUser(web, { signIn: false });
  await web.close();
  makeStaff(finance.email, 'finance');
  makeStaff(support.email, 'support');

  await signInStaff(page, finance.email);
  const nav = page.getByRole('navigation', { name: 'Staff console' });
  await expect(nav.getByRole('link', { name: 'Tenants' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Signup codes' })).toHaveCount(0);
  await page.goto('/signup-codes');
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('form', { name: 'Create a signup code' })).toHaveCount(0);

  const other = await (await browser.newContext({ baseURL: page.url().split('/not-staff')[0] })).newPage();
  await signInStaff(other, support.email);
  await other
    .getByRole('navigation', { name: 'Staff console' })
    .getByRole('link', { name: 'Signup codes' })
    .click();
  await expect(other.getByRole('form', { name: 'Create a signup code' })).toBeVisible();
  expect(WEB).toContain('localhost');
  await other.close();
});
