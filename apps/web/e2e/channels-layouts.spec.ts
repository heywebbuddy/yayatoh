import { expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';
import { createGala, holdSeats, quickPlan, seatBox, seatedGala, unique } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Seating views' });
const saved = (page: Page) =>
  expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible({ timeout: 10_000 });

/** A one-page PDF floor plan (a rectangle), built byte by byte with a correct cross-reference table. */
function floorPlanPdf(): Buffer {
  const stream = '0 0 0 RG 6 w 40 40 520 220 re S 300 40 m 300 260 l S';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test.describe('channels, revisions and the layout library (M6.11b)', () => {
  // Each test builds its own seated event through the UI first.
  test.describe.configure({ timeout: 180_000 });

  test('an organizer allots a block to a promoter code; buyers buy it only through the promoter’s link; viewers read only', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Channel Gala'), { rows: 2, seatsPerRow: 6 });
    await page.goto(`${base}/seating`);
    await views(page).getByRole('link', { name: 'Channels' }).click();
    await expect(page.getByRole('heading', { name: 'Sales channels', level: 1 })).toBeVisible();
    // Empty state: what to do next.
    await expect(page.getByText('No sales channels yet')).toBeVisible();
    await expect(page.getByText(/^Add a channel below, then allot seats to it\./)).toBeVisible();
    await expectAccessible(page);

    // Every validation error, at its field.
    const form = page.getByRole('region', { name: 'Add a channel' });
    await form.getByLabel('Kind').selectOption('promoter');
    await form.getByLabel('Name', { exact: true }).fill('DJ Kai');
    await form.getByRole('button', { name: 'Add channel' }).click();
    await expect(form.getByText('Sponsors and promoters need a code.')).toBeVisible();
    await expect(form.getByLabel('Code', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText('Please fix the highlighted field.')).toBeVisible();
    await expectAccessible(page);
    await form.getByLabel('Code', { exact: true }).fill('a b');
    await form.getByRole('button', { name: 'Add channel' }).click();
    await expect(form.getByText('Use 3 to 32 letters, digits, dashes or underscores.')).toBeVisible();
    const code = `KAI-${Date.now().toString(36)}`;
    await form.getByLabel('Code', { exact: true }).fill(code);
    await form.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(form.getByText('Channel added.')).toBeVisible();
    const row = page.getByTestId('channel-row').filter({ hasText: 'DJ Kai' });
    await expect(row).toBeVisible();
    await expect(row.getByText(code.toUpperCase(), { exact: true })).toBeVisible();
    await expect(row.getByLabel('Link for DJ Kai')).toHaveValue(
      `/events/${slug}?channel=${code.toUpperCase()}`,
    );
    // The same code twice, and a second box office, are refused.
    await form.getByLabel('Kind').selectOption('sponsor');
    await form.getByLabel('Name', { exact: true }).fill('Acme');
    await form.getByLabel('Code', { exact: true }).fill(code.toUpperCase());
    await form.getByRole('button', { name: 'Add channel' }).click();
    await expect(form.getByText('Another channel of this event has that code.')).toBeVisible();

    // Allot seats 1–3 of row A, by keyboard only.
    const allot = page.getByRole('region', { name: 'Allot seats' });
    await expect(allot.getByLabel('Channel', { exact: true })).toHaveValue(/.+/);
    await allot.getByRole('checkbox', { name: /^Row A \(6 seats\)/ }).focus();
    await page.keyboard.press('Space');
    await allot.getByLabel('Only these seats (optional)').focus();
    await page.keyboard.type('1-3');
    await allot.getByRole('button', { name: 'Allot seats' }).focus();
    await page.keyboard.press('Enter');
    await expect(allot.getByText('3 seats allotted.')).toBeVisible();
    // The form starts afresh; nothing chosen is explained.
    await expect(allot.getByRole('checkbox', { name: /^Row A \(6 seats\)/ })).not.toBeChecked();
    await allot.getByRole('button', { name: 'Allot seats' }).click();
    await expect(
      allot.getByText('Choose at least one row or table, and seat numbers that exist in it.'),
    ).toBeVisible();
    await expectAccessible(page);
    // It persisted.
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Allot seats' }).getByText('3 seats in DJ Kai'),
    ).toBeVisible();
    await expect(
      page.getByTestId('channel-row').filter({ hasText: 'DJ Kai' }).getByRole('cell').nth(3),
    ).toHaveText('3');

    // The public: the promoter's seats can't be chosen without the link.
    const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const buyer = await ctx.newPage();
    await buyer.goto(`/events/${slug}`);
    await expect(seatBox(buyer, 'Row A · 1')).toBeDisabled();
    await expect(seatBox(buyer, 'Row A · 4')).toBeEnabled();
    // A wrong link says so and falls back to the seats open to everyone.
    await buyer.goto(`/events/${slug}?channel=NOPE-0000`);
    await expect(
      buyer.getByText(
        "This sales link isn't valid for this event. You can still choose from the seats open to everyone.",
      ),
    ).toBeVisible();
    await expect(seatBox(buyer, 'Row A · 1')).toBeDisabled();
    // Through the promoter's link: the block opens, and the buyer buys a seat of it by keyboard.
    await buyer.goto(`/events/${slug}?channel=${code.toUpperCase()}`);
    await expect(
      buyer.getByText("You're buying through DJ Kai: seats kept for DJ Kai are open to you too."),
    ).toBeVisible();
    await expectAccessible(buyer);
    await seatBox(buyer, 'Row A · 2').focus();
    await buyer.keyboard.press('Space');
    await expect(seatBox(buyer, 'Row A · 2')).toBeChecked();
    const who = `Kai Fan ${Date.now()}`;
    const email = `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;
    await buyer.getByLabel('Full name').focus();
    await buyer.keyboard.type(who);
    await buyer.getByLabel('Email for your tickets').focus();
    await buyer.keyboard.type(email);
    await continueToPayment(buyer, email);
    await expect(buyer.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await buyer.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(buyer).toHaveURL(/\/orders\//);
    await expect(buyer.getByText('Seat: Row A · 2')).toBeVisible();
    await ctx.close();

    // The channel's report counts the sale.
    await page.reload();
    await expect(page.getByTestId('channel-row').filter({ hasText: 'DJ Kai' })).toContainText(
      '1 order · 1 seat',
    );

    // Edit: a release time; then the channel is removed and its seats go back to everyone.
    await page.getByRole('link', { name: 'Edit DJ Kai' }).click();
    const edit = page.getByRole('region', { name: 'Edit DJ Kai' });
    await edit.getByLabel('Release unsold seats at (optional)').fill('2027-12-01T09:00');
    await edit.getByRole('button', { name: 'Save channel' }).click();
    await expect(page.getByText('Channel saved.')).toBeVisible();
    await expect(page.getByTestId('channel-row').filter({ hasText: 'DJ Kai' })).toContainText('2027');

    // A viewer reads only: no forms, and the edit link's page has none either.
    const vctx = await browser.newContext();
    const viewer = await vctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/channels`);
    await expect(viewer.getByText('You can see the channels but not change them.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Add channel' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Allot seats' })).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: 'Edit DJ Kai' })).toHaveCount(0);
    await viewer.goto(`${base}/seating/channels?edit=${'0'.repeat(8)}-0000-7000-8000-000000000000`);
    await expect(viewer.getByRole('button', { name: 'Save channel' })).toHaveCount(0);
    await vctx.close();

    await page.getByRole('button', { name: 'Remove DJ Kai' }).click();
    await expect(page.getByText('Channel removed. Its seats are open to every channel again.')).toBeVisible();

    // Arabic, right to left.
    await page.goto(`/ar${base}/seating/channels`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قنوات البيع', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('every save is a revision; an organizer rolls back by keyboard; held seats stop a restore that would lose them', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Revision Gala'), { rows: 2, seatsPerRow: 4 });
    // The plan editor's list (the keyboard alternative to the canvas): rename row A.
    await page.goto(`${base}/seating`);
    const label = page.getByLabel('Label of A', { exact: true });
    await label.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('AA');
    await page.keyboard.press('Tab');
    await saved(page);

    await views(page).getByRole('link', { name: 'Revisions' }).click();
    await expect(page.getByRole('heading', { name: 'Plan revisions', level: 1 })).toBeVisible();
    // The newest revision is shown, with what it changed.
    await expect(page.getByRole('heading', { name: 'Revision 2' })).toBeVisible();
    await expect(page.getByText('This is the plan as it is now.')).toBeVisible();
    const list = page.getByRole('table', { name: 'All revisions' });
    await expect(list.getByRole('row').filter({ hasText: 'Revision 2' })).toContainText('4 seats renumbered');
    await expect(list.getByRole('row').filter({ hasText: 'Revision 1' })).toContainText(
      'The first revision kept.',
    );
    await expectAccessible(page);

    // Open revision 1 by keyboard and restore it.
    await list.getByRole('link', { name: 'Revision 1' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Revision 1' })).toBeVisible();
    const detail = page.getByRole('region', { name: 'Revision 1' });
    await expect(detail.getByText('Restoring it would change')).toBeVisible();
    await expect(detail.getByText('4 seats renumbered')).toBeVisible();
    await detail.getByText('Seats renumbered (4)').click();
    await expect(detail.getByText('Row AA · 1 → Row A · 1')).toBeVisible();
    await expect(detail.getByText('No seats are held or sold: nothing stands in the way.')).toBeVisible();
    await expectAccessible(page);
    await detail.getByRole('button', { name: 'Restore revision 1' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Revision 1 restored. The plan now is revision 3.')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'All revisions' }).getByRole('row').filter({ hasText: 'Revision 3' }),
    ).toContainText('Restored revision 1');
    // The plan is back (persisted).
    await page.goto(`${base}/seating`);
    await expect(page.getByLabel('Label of A', { exact: true })).toHaveValue('A');

    // A buyer holds Row A · 1; revision 2 would rename it, so it can't be restored now.
    const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await holdSeats(await ctx.newPage(), slug, ['Row A · 1'], `Holder ${Date.now()}`);
    await page.goto(`${base}/seating/revisions?rev=2`);
    const blocked = page.getByRole('region', { name: 'Revision 2' });
    await expect(
      blocked.getByText("This revision can't be restored: 1 held or sold seat would be lost."),
    ).toBeVisible();
    await expect(
      blocked.getByText('Row A · 1 is held by a buyer and would become Row AA · 1.'),
    ).toBeVisible();
    await expect(blocked.getByRole('button', { name: 'Restore revision 2' })).toHaveCount(0);
    await expectAccessible(page);
    await ctx.close();

    // A viewer reads the revisions but can't restore.
    const vctx = await browser.newContext();
    const viewer = await vctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/revisions?rev=1`);
    await expect(viewer.getByText('You can see the revisions but not restore them.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Restore revision 1' })).toHaveCount(0);
    await vctx.close();

    // Arabic, right to left.
    await page.goto(`/ar${base}/seating/revisions`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'نسخ المخطط', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a plan saved to the library starts a new event; the library renames and removes plans', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const base = await createGala(page, unique('Library Source Gala'));
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    const name = unique('Ballroom');
    const keep = page.getByRole('region', { name: 'Save as a reusable plan' });
    await keep.getByLabel('Name', { exact: true }).fill(name);
    await keep.getByRole('button', { name: 'Save plan' }).click();
    await expect(keep.getByText('Saved. You can use it for other events.')).toBeVisible();

    // The library, from the venues page.
    await page.goto('/o/lakeside-events/venues');
    await page.getByRole('link', { name: 'Seating library' }).click();
    await expect(page.getByRole('heading', { name: 'Seating library', level: 1 })).toBeVisible();
    const card = page.getByTestId('library-layout').filter({ hasText: name });
    await expect(card).toContainText('8 seats · 2 tables');
    await expect(card).toContainText('Not used by an event yet');
    await expectAccessible(page);

    // Start a new event from it: every validation error first, then by keyboard.
    await card.getByRole('link', { name: `Start an event from ${name}` }).click();
    const start = page.getByRole('region', { name: 'Start a new event from a plan' });
    await expect(start.getByLabel('Plan', { exact: true })).toHaveValue(/.+/);
    await expect(start.getByLabel('Plan', { exact: true }).locator('option:checked')).toHaveText(
      `${name} (8 seats)`,
    );
    await start.getByRole('button', { name: 'Create the event' }).click();
    await expect(start.getByText('Give the event a name (2 to 160 characters).')).toBeVisible();
    await expect(start.getByLabel('Event name')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    const eventName = unique('From Library Gala');
    await start.getByLabel('Event name').fill(eventName);
    await start.getByLabel('Kind of event').selectOption({ label: 'Gala' });
    await start.getByLabel('Starts').fill('2027-11-05T18:00');
    await start.getByLabel('Ends').fill('2027-11-05T17:00');
    await start.getByRole('button', { name: 'Create the event' }).click();
    await expect(start.getByText('Enter when the event ends, after it starts.')).toBeVisible();
    await start.getByLabel('Ends').fill('2027-11-05T23:00');
    await start.getByRole('button', { name: 'Create the event' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+\/seating\?fromLibrary=1$/);
    await expect(
      page.getByText('This event starts from your saved plan. Price its seats, then put them on sale.'),
    ).toBeVisible();
    await expect(page.getByLabel('Label of 1', { exact: true })).toHaveValue('1');
    await expect(page.getByRole('application', { name: 'Seating plan' })).toBeVisible();

    // The library counts it; rename (persisted), then remove.
    await page.goto('/o/lakeside-events/seating-library');
    const used = page.getByTestId('library-layout').filter({ hasText: name });
    await expect(used).toContainText('Used by 1 event');
    const renamed = `${name} B`;
    await used.getByLabel(`Name of ${name}`).fill('');
    await used.getByRole('button', { name: 'Rename' }).click();
    await expect(used.getByText('Give the plan a name (up to 120 characters).')).toBeVisible();
    await used.getByLabel(`Name of ${name}`).fill(renamed);
    await used.getByRole('button', { name: 'Rename' }).click();
    await expect(used.getByText('Renamed.')).toBeVisible();
    await page.reload();
    const card2 = page.getByTestId('library-layout').filter({ hasText: renamed });
    await expect(card2.getByRole('heading', { name: renamed })).toBeVisible();

    // A viewer reads the library only.
    const vctx = await browser.newContext();
    const viewer = await vctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto('/o/lakeside-events/seating-library');
    await expect(viewer.getByRole('heading', { name: 'Seating library', level: 1 })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Create the event' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: `Remove ${renamed}` })).toHaveCount(0);
    await vctx.close();

    await card2.getByRole('button', { name: `Remove ${renamed}` }).click();
    await expect(
      page.getByText('Plan removed from the library. Events that used it keep their copy.'),
    ).toBeVisible();
    await expect(page.getByTestId('library-layout').filter({ hasText: renamed })).toHaveCount(0);

    // Arabic, right to left.
    await page.goto('/ar/o/lakeside-events/seating-library');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مكتبة المخططات', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('underlay tracing: a page of a PDF floor plan goes under the editor, at an opacity set by keyboard', async ({
    page,
  }) => {
    await signIn(page);
    const base = await createGala(page, unique('PDF Underlay Gala'));
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    const panel = page.getByRole('region', { name: 'Floor plan image' });
    const file = { name: 'hall-plan.pdf', mimeType: 'application/pdf', buffer: floorPlanPdf() };
    await panel.getByLabel('Floor plan image', { exact: true }).setInputFiles(file);
    // A page the PDF doesn't have: explained.
    await panel.getByLabel('Page (PDF)').fill('2');
    await panel.getByRole('button', { name: 'Upload image' }).click();
    await expect(panel.getByText("That page doesn't exist: the PDF has 1 page.")).toBeVisible();
    await expect(panel.getByLabel('Page (PDF)')).toHaveAttribute('aria-invalid', 'true');
    // Not a PDF at all: explained.
    await panel
      .getByLabel('Floor plan image', { exact: true })
      .setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
    await panel.getByLabel('Page (PDF)').fill('1');
    await panel.getByRole('button', { name: 'Upload image' }).click();
    await expect(
      panel.getByText("This PDF can't be read. Export the plan as an image or another PDF and try again."),
    ).toBeVisible();
    // Page 1: drawn in the browser, uploaded as an image, placed under the plan.
    await panel.getByLabel('Floor plan image', { exact: true }).setInputFiles(file);
    await panel.getByRole('button', { name: 'Upload image' }).click();
    await expect(panel.getByText('Image added under the plan.')).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(/^Scale: 1 pixel = /)).toBeVisible();
    await saved(page);
    // The opacity, by keyboard.
    const opacity = panel.getByLabel(/^Opacity: 50 %/);
    await opacity.focus();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByLabel(/^Opacity: 55 %/)).toBeVisible();
    await saved(page);
    await expectAccessible(page);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Floor plan image' }).getByLabel(/^Opacity: 55 %/),
    ).toBeVisible();
    await expect(page.locator('[data-underlay^="/media/"]')).toHaveCount(1);
  });
});
