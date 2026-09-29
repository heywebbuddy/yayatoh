import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

// The marketing pages come from the platform CMS (the content org, Harbor Arts in e2e), seeded
// from apps/web/src/content/platform-starter.ts.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://yayatoh.localhost:${PORT}`;
const CONTENT_OWNER = 'lee@harbor.test';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('marketing site (M3.11b)', () => {
  test('home and features show the published CMS sections in order; drafts never show', async ({ page }) => {
    await page.goto(`${APEX}/`);
    const why = page.getByRole('region', { name: 'Why organizers choose Yayatoh' });
    await expect(why.getByRole('heading', { level: 3 })).toHaveText([
      'Prices with every fee included',
      'Your events on your own domain',
      'Doors that keep working offline',
    ]);
    await expectAccessible(page);
    await why.getByRole('link', { name: 'See all features' }).first().click();
    await expect(page).toHaveURL(/\/features$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Everything you need to run your events' }),
    ).toBeVisible();
    await expect(page.locator('main [data-section]')).toHaveCount(5);
    await expect(page.getByText('Coming soon: a feature we have not announced')).toHaveCount(0);
    await expect(page.locator('main [data-section="tickets-and-checkout"] li')).toHaveCount(3);
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await page.locator('main [data-section="money"]').getByRole('link', { name: 'Talk to us' }).click();
    await expect(page).toHaveURL(/\/contact$/);
  });

  test('contact form: field errors, human check, confirmation with focus, then the device limit', async ({
    page,
  }) => {
    const s = stamp();
    await page.goto(`${APEX}/contact`);
    await expect(page.getByRole('heading', { level: 1, name: 'Contact us' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Planning events with Yayatoh?' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Check the highlighted fields.')).toBeVisible();
    await expect(page.getByText("Confirm that you're a person.")).toBeVisible();

    await page.getByRole('combobox', { name: 'Topic' }).selectOption('sales');
    await page.getByRole('textbox', { name: 'Your name' }).fill(`Robin ${s}`);
    await page.getByRole('textbox', { name: 'Email' }).fill(`robin-${s}@example.test`);
    await page.getByRole('textbox', { name: 'Organization' }).fill('Riverside Festivals');
    await page.getByRole('textbox', { name: 'Message' }).fill('short');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Write a message of 10 to 4,000 characters.')).toBeVisible();
    // What was typed is kept.
    await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveValue(`Robin ${s}`);
    await page.getByRole('textbox', { name: 'Message' }).fill(`We run 12 festivals a year. Ref ${s}`);
    await page.getByRole('checkbox').check();
    await page.getByRole('textbox', { name: 'Message' }).press('Tab');
    await page.getByRole('button', { name: 'Send message' }).focus();
    await page.keyboard.press('Enter');
    const done = page.getByRole('status').filter({ hasText: 'Thanks, your message was sent.' });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expectAccessible(page);

    // Three tries per device in ten minutes (contactRequest policy): the fourth is refused.
    await page.reload();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(
      page.getByText(/Too many messages from this device\. Try again in \d+ minutes?\./),
    ).toBeVisible();

    // The content org's team reads it in the console and marks it handled.
    const team = await (await page.context().browser()?.newContext())?.newPage();
    if (!team) throw new Error('no browser');
    await signIn(team, CONTENT_OWNER);
    await team.goto('/o/harbor-arts/marketing?tab=requests');
    const item = team.getByRole('listitem').filter({ hasText: `Ref ${s}` });
    await expect(item).toContainText(`robin-${s}@example.test`);
    await expect(item).toContainText('Sales and demos');
    await item.getByRole('button', { name: 'Mark as handled' }).click();
    await expect(item.getByText('Handled')).toBeVisible();
    await expectAccessible(team);
    await team.close();
  });

  test('Arabic: right to left; untranslated sections fall back to English, marked as English', async ({
    page,
  }) => {
    await page.goto(`${APEX}/ar/features`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main [data-section="seating"]')).toHaveAttribute('lang', 'en');
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await page.goto(`${APEX}/ar/contact`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'إرسال الرسالة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('console: a section goes live on the home page when published and disappears when unpublished', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const s = stamp();
    const heading = `Sell out faster ${s}`;
    await signIn(page, CONTENT_OWNER);
    await page.goto('/o/harbor-arts/marketing');
    await expect(page.getByRole('heading', { level: 1, name: 'Marketing site' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Features page' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'New section' }).click();
    await page.getByRole('combobox', { name: 'Page' }).selectOption('home');
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(heading);
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Queues vanish.');
    await page.getByRole('textbox', { name: 'Button text' }).fill('Go');
    await page.getByRole('textbox', { name: 'Button link' }).fill('javascript:alert(1)');
    await page.getByRole('spinbutton', { name: 'Order' }).fill('90');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(
      page.getByText('Use a page of this site (starting with /) or an https:// address.'),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Button link' }).fill('/help');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

    const pub = await page.context().newPage();
    await pub.goto(`${APEX}/`);
    await expect(pub.getByRole('heading', { name: heading })).toHaveCount(0);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await expect(async () => {
      await pub.goto(`${APEX}/`);
      await expect(pub.getByRole('heading', { name: heading })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    await expect(async () => {
      await pub.goto(`${APEX}/`);
      await expect(pub.getByRole('heading', { name: heading })).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await pub.close();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page).toHaveURL(/\/o\/harbor-arts\/marketing\?deleted=1$/);
  });
});
