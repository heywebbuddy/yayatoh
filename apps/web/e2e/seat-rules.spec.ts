import { expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';
import {
  addGuests,
  createGala,
  quickPlan,
  seatBox,
  seatedGala,
  unique,
  waitLive,
} from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** Mark seats of a table accessible in the plan editor's list (autosaved). */
async function markAccessible(page: Page, base: string, table: string, labels: string) {
  await page.goto(`${base}/seating`);
  const field = page.getByLabel(`Accessible seats of ${table}`);
  await field.fill(labels);
  await field.press('Enter');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
}

async function setRules(
  page: Page,
  base: string,
  r: { ada?: { days: string; enforce?: boolean }; cap?: { max: string; enforce?: boolean } },
) {
  await page.goto(`${base}/seating/rules`);
  const ada = page.getByRole('group', { name: 'Accessible seats' });
  const cap = page.getByRole('group', { name: 'Seats per order' });
  const on = async (group: typeof ada, label: string, want: boolean) => {
    const box = group.getByLabel(label);
    if ((await box.isChecked()) !== want) await box.click();
  };
  await on(ada, 'Keep accessible seats for guests who need them', Boolean(r.ada));
  if (r.ada) {
    await ada.getByLabel('Until how many days before the event').fill(r.ada.days);
    await ada.getByRole('radio', { name: r.ada.enforce ? 'Enforce' : 'Warn (recommended)' }).check();
  }
  await on(cap, 'Limit the seats in one order', Boolean(r.cap));
  if (r.cap) {
    await cap.getByLabel('At most').fill(r.cap.max);
    await cap.getByRole('radio', { name: r.cap.enforce ? 'Enforce' : 'Warn (recommended)' }).check();
  }
  await page.getByRole('button', { name: 'Save rules' }).click();
}

test.describe('seating rules (M1.7f)', () => {
  // Each test builds its own seated event through the UI first.
  test.describe.configure({ timeout: 120_000 });

  test('an organizer sets the rules: bad values are explained, saved rules persist; viewers read only', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    // No plan yet: nothing to set.
    const bare = await createGala(page, unique('Bare Rules Gala'));
    await page.goto(`${bare}/seating/rules`);
    await expect(
      page.getByText('This event has no seating plan yet. Create one first, then set its rules here.'),
    ).toBeVisible();
    await expectAccessible(page);

    const base = await createGala(page, unique('Rules Gala'));
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Rules' })
      .click();
    await expect(page.getByRole('heading', { name: 'Seating rules', level: 1 })).toBeVisible();
    await expect(page.getByText('No rules: buyers can choose any free seat.')).toBeVisible();
    await expectAccessible(page);

    // Out of range: each field says why, and nothing is saved.
    await setRules(page, base, { ada: { days: '400', enforce: true }, cap: { max: '0' } });
    const days = page.getByLabel('Until how many days before the event');
    await expect(page.getByText('Enter a whole number of days from 0 to 365.')).toBeVisible();
    await expect(days).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Please fix the highlighted field.' }),
    ).toBeVisible();
    await expect(days).toHaveValue('400');
    await expectAccessible(page);
    await days.fill('10');
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('Enter a whole number from 1 to 50.')).toBeVisible();
    await page.getByLabel('At most').fill('4');
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('Seating rules saved.')).toBeVisible();
    const now = page.getByRole('list', { name: 'Rules in force' });
    await expect(now).toContainText(
      /Accessible seats kept for guests who need them until 10 days before the event \(.+\) · enforced/,
    );
    await expect(now).toContainText('At most 4 seats per order · warns');

    // It persisted.
    await page.reload();
    await expect(page.getByLabel('Keep accessible seats for guests who need them')).toBeChecked();
    await expect(page.getByLabel('Until how many days before the event')).toHaveValue('10');
    await expect(
      page.getByRole('group', { name: 'Accessible seats' }).getByRole('radio', { name: 'Enforce' }),
    ).toBeChecked();
    await expect(page.getByLabel('At most')).toHaveValue('4');

    // A viewer sees the rules, not the form; a stale page's save is refused.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/rules`);
    await expect(viewer.getByText('You can see the rules but not change them.')).toBeVisible();
    await expect(viewer.getByRole('list', { name: 'Rules in force' })).toContainText(
      'At most 4 seats per order',
    );
    await expect(viewer.getByRole('button', { name: 'Save rules' })).toHaveCount(0);
    await expectAccessible(viewer);
    await signIn(page, VIEWER);
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'You can see the rules but not change them.' }),
    ).toBeVisible();

    // Arabic, right to left.
    await signIn(page);
    await page.goto(`/ar${base}/seating/rules`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قواعد الجلوس', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('buyers are warned as they choose; enforced rules keep accessible seats back (live) and cap the choice', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Warn Gala'));
    await markAccessible(page, base, '1', '1');
    await markAccessible(page, base, '2', '1');
    await setRules(page, base, { ada: { days: '7' }, cap: { max: '2' } });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();

    const buyer = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await buyer.goto(`/events/${slug}`);
    await waitLive(buyer);
    await expect(
      buyer.getByText(
        /^Accessible seats are kept for guests who need them until .+\. Please choose one only if/,
      ),
    ).toBeVisible();
    await expect(buyer.getByText('The organizer asks for at most 2 seats per order.')).toBeVisible();
    await seatBox(buyer, 'Table 1 · 1').check();
    await expect(
      buyer.getByText(
        'Table 1 · 1 is an accessible seat, kept for guests who need them. Please choose it only if needed.',
      ),
    ).toBeVisible();
    await seatBox(buyer, 'Table 1 · 2').check();
    await seatBox(buyer, 'Table 1 · 3').check();
    await expect(
      buyer.getByText('3 seats chosen: the organizer asks for at most 2 per order.'),
    ).toBeVisible();
    await expectAccessible(buyer);
    // Warnings never stop the buyer.
    await buyer.getByLabel('Full name').fill(`Wendy Warned ${Date.now()}`);
    const wendy = `wendy.${Date.now()}@example.test`;
    await buyer.getByLabel('Email for your tickets').fill(wendy);
    await continueToPayment(buyer, wendy);
    await expect(buyer.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();

    // Enforced: a buyer watching sees the kept-back seat go, live.
    const watcher = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await watcher.goto(`/events/${slug}`);
    await waitLive(watcher);
    await expect(seatBox(watcher, 'Table 2 · 1')).toBeEnabled();
    await setRules(page, base, { ada: { days: '7', enforce: true }, cap: { max: '2', enforce: true } });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();
    await expect(seatBox(watcher, 'Table 2 · 1')).toBeDisabled();
    await watcher.reload();
    await expect(
      watcher.getByText(/and can't be booked online before then\. Contact the organizer if you need one\.$/),
    ).toBeVisible();
    await expect(watcher.getByText('Up to 2 seats per order.')).toBeVisible();
    await expect(watcher.locator('label').filter({ hasText: 'Table 2 · 1' })).toContainText(
      /Kept back until/,
    );
    // The cap: a third seat is not taken, and the buyer is told why.
    await seatBox(watcher, 'Table 2 · 2').check();
    await seatBox(watcher, 'Table 2 · 3').check();
    await seatBox(watcher, 'Table 2 · 4').click();
    await expect(seatBox(watcher, 'Table 2 · 4')).not.toBeChecked();
    await expect(watcher.getByTestId('seat-notice')).toHaveText(
      "That's the most one order can have: 2 seats.",
    );
    await expectAccessible(watcher);
  });

  test('seating guests: a kept-back accessible seat warns, and when enforced needs the organizer’s confirmation', async ({
    page,
  }) => {
    await signIn(page);
    const name = unique('ADA Gala');
    const [ann, ben] = ['Ann', 'Ben'].map((n) => `${n} ${name}`) as [string, string];
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await markAccessible(page, base, '1', '1');
    await addGuests(page, base, [ann, ben]);
    await setRules(page, base, { ada: { days: '7' } });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();

    await page.goto(`${base}/seating/assign`);
    await expect(
      page.getByText(
        /^Accessible seats \(outlined\) are kept for guests who need them until .+\. Seating someone there shows a warning\.$/,
      ),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: ann }).check();
    await page.getByLabel('Table or row').selectOption({ label: 'Table 1 — 4 of 4 free' });
    await page.getByLabel('Seat', { exact: true }).selectOption({ label: 'Table 1 · 1 · accessible' });
    await page.getByRole('button', { name: 'Seat them' }).click();
    const feedback = page.locator('[aria-live="polite"]').getByRole('status');
    await expect(feedback).toHaveText(
      /^Seated 1 person at Table 1\. Note: Table 1 · 1 is an accessible seat kept for guests who need them until .+\.$/,
    );
    await expectAccessible(page);
    await page.getByRole('button', { name: `Remove ${ann} from Table 1` }).click();
    await expect(feedback).toHaveText(`${ann} no longer has a seat.`);

    await setRules(page, base, { ada: { days: '7', enforce: true } });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();
    await page.goto(`${base}/seating/assign`);
    await page.getByRole('checkbox', { name: ben }).check();
    await page.getByLabel('Table or row').selectOption({ label: 'Table 1 — 4 of 4 free' });
    await page.getByLabel('Seat', { exact: true }).selectOption({ label: 'Table 1 · 1 · accessible' });
    const confirm = page.getByLabel('This guest needs an accessible seat');
    await expect(confirm).toBeVisible();
    await page.getByRole('button', { name: 'Seat them' }).click();
    await expect(page.locator('[aria-live="polite"]').getByRole('alert')).toHaveText(
      'That seat is kept for guests who need an accessible seat. Tick “This guest needs an accessible seat” to seat them there.',
    );
    await expectAccessible(page);
    await confirm.check();
    await page.getByRole('button', { name: 'Seat them' }).click();
    await expect(feedback).toHaveText(
      /^Seated 1 person at Table 1\. Note: Table 1 · 1 is an accessible seat/,
    );
    await expect(page.getByRole('region', { name: 'Table 1', exact: true })).toContainText(ben);
  });
});
