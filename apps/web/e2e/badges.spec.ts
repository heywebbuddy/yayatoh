import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * M5.5a badges: a conference organizer designs a 4×3 fold-over template by keyboard only, assigns
 * it to a ticket type, runs a batch PDF sorted by company and downloads it; a viewer can preview
 * but is refused on every write; the Arabic console renders right to left.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';

const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now().toString(36)}`;
const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

async function createConference(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${day(40)}T09:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${day(41)}T18:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

async function addFreeTicketType(page: Page, base: string, name: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('50');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

async function addQuestion(page: Page, label: string) {
  await page.getByLabel('Question', { exact: true }).fill(label);
  await page.getByLabel('Answer type').selectOption('short_text');
  await page.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: label })).toBeVisible();
}

/** A guest registers (free) with their company and job title. */
async function register(
  browser: Browser,
  slug: string,
  type: string,
  who: { name: string; company: string; title: string },
) {
  const guest = await (await browser.newContext()).newPage();
  const email = `${who.name.split(' ')[0]?.toLowerCase()}+${Date.now()}@example.test`;
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${type}`).selectOption('1');
  await guest.getByLabel(/^Company/).fill(who.company);
  await guest.getByLabel(/^Job title/).fill(who.title);
  await guest.getByLabel('Full name').fill(who.name);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  await guest.context().close();
}

test.describe('badges (M5.5a)', () => {
  test('design by keyboard, assign to a ticket type, batch PDF by company, download; viewer and Arabic', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createConference(page, `Badge Summit ${s}`);
    await addFreeTicketType(page, base, 'Delegate');
    await addFreeTicketType(page, base, 'Speaker');
    await addQuestion(page, 'Company');
    await addQuestion(page, 'Job title');
    await register(browser, slug, 'Delegate', { name: 'Zoe Adams', company: 'Initech', title: 'CTO' });
    await register(browser, slug, 'Speaker', {
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
      title: 'Countess',
    });
    await register(browser, slug, 'Delegate', { name: 'Bob Baker', company: 'Acme', title: 'Engineer' });

    // The Badges page: in the conference nav, empty at first.
    await page.goto(base);
    if (test.info().project.name === 'desktop-1280')
      await expect(page.getByRole('link', { name: 'Badges', exact: true })).toHaveCount(1);
    await page.goto(`${base}/badges`);
    await expect(page.getByRole('heading', { name: 'Badges', level: 1 })).toBeVisible();
    await expect(page.getByText('No badge templates yet')).toBeVisible();
    await expectAccessible(page);

    // Validation: a template needs a name, and names are unique per event.
    const create = page.getByRole('region', { name: 'New template' });
    await create.getByRole('button', { name: 'Create template' }).click();
    await expect(create.getByText('Enter a template name (up to 80 characters).')).toBeVisible();
    await create.getByLabel('Template name').fill('Attendee badge');
    await create.getByLabel('Badge size').selectOption('fold_4x3');
    await create.getByRole('button', { name: 'Create template' }).click();

    // The designer, by keyboard only.
    await expect(page.getByRole('heading', { name: 'Design: Attendee badge', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${base}/badges/[0-9a-f-]{36}$`));
    const designerUrl = page.url();
    await expectAccessible(page);
    const first = page.getByRole('button', { name: /^First name: / });
    await first.focus();
    await expect(first).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Selected: First name' })).toBeVisible();
    const x = page.getByLabel('From the left (mm)');
    const y = page.getByLabel('From the top (mm)');
    const width = page.getByLabel('Width (mm)');
    const x0 = Number(await x.inputValue());
    const y0 = Number(await y.inputValue());
    const w0 = Number(await width.inputValue());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(x).toHaveValue(String(x0 + 2));
    await expect(y).toHaveValue(String(y0 + 5));
    await expect(width).toHaveValue(String(w0 - 1));
    // Numeric input is the other alternative to dragging.
    await x.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10');
    await expect(first).toBeVisible();
    // The back of the fold-over.
    await page.getByRole('radio', { name: 'Back' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Badge preview: Back' })).toBeVisible();
    await page.getByRole('radio', { name: 'Front' }).focus();
    await page.keyboard.press('Space');
    // Ribbons by ticket type (token colours) and where company and job title come from.
    await page.getByLabel('Ribbon colour for Speaker').selectOption('orange');
    await page.getByLabel('Ribbon text for Speaker').fill('SPEAKER');
    await page.getByLabel('Company comes from').selectOption({ label: 'Company' });
    await page.getByLabel('Job title comes from').selectOption({ label: 'Job title' });
    // The live preview in Arabic: mirrored, sample Arabic names (shaped by the browser).
    const onBadge = page.locator('[data-element="first"]');
    const firstBox = await onBadge.boundingBox();
    await page.getByRole('radio', { name: 'Arabic (العربية)' }).focus();
    await page.keyboard.press('Space');
    const arFirst = page.getByRole('button', { name: /^First name: ليلى/ });
    await expect(arFirst).toBeVisible();
    await expect(onBadge.locator('span')).toHaveText('ليلى');
    const arBox = await onBadge.boundingBox();
    expect(Math.round(arBox?.x ?? 0)).not.toBe(Math.round(firstBox?.x ?? 0));
    await expectAccessible(page);
    await page.getByRole('radio', { name: 'English' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Save template' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Saved. Version 2.')).toBeVisible();
    // Persisted after a reload.
    await page.reload();
    await page.getByRole('button', { name: /^First name: / }).focus();
    await expect(page.getByLabel('From the left (mm)')).toHaveValue('10');
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Company comes from')).toHaveValue('company');

    // A duplicate name is refused.
    await page.goto(`${base}/badges`);
    await create.getByLabel('Template name').fill('ATTENDEE BADGE');
    await create.getByRole('button', { name: 'Create template' }).click();
    await expect(create.getByText('Another template of this event has this name.')).toBeVisible();

    // Assign the template to the Speaker ticket type.
    const assign = page.getByRole('region', { name: 'Templates by ticket type' });
    await assign.getByLabel('Template for Speaker').selectOption({ label: 'Attendee badge' });
    await assign.getByRole('button', { name: 'Save for Speaker' }).click();
    await expect(assign.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(assign.getByLabel('Template for Speaker')).toHaveValue(/[0-9a-f-]{36}/);

    // A batch PDF sorted by company, then downloaded through its signed link.
    const batch = page.getByRole('region', { name: 'Batch PDF' });
    await batch.getByRole('radio', { name: 'Company, A to Z' }).check();
    await batch.getByRole('button', { name: 'Create PDF' }).click();
    const ready = batch.getByRole('listitem').filter({ hasText: 'Ready to download' }).first();
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await expect(ready).toContainText('Company, A to Z');
    await expect(ready).toContainText('3 badges');
    await expectAccessible(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      ready.getByRole('link', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('badges.pdf');
    const bytes = readFileSync((await download.path()) ?? '');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // One page per badge (a 4×3 fold-over sheet each): the page tree counts 3.
    expect(bytes.toString('latin1')).toMatch(/\/Count 3\b/);

    // One badge for the desk.
    const one = page.getByRole('region', { name: 'One badge' });
    await one.getByLabel('Name or ticket number').fill('Ada');
    await one.getByRole('button', { name: 'Find' }).click();
    const badgeLink = page.getByRole('link', { name: 'Badge PDF for Ada Lovelace' });
    await expect(badgeLink).toBeVisible();
    const oneHref = (await badgeLink.getAttribute('href')) ?? '';
    const onePdf = await page.request.get(oneHref);
    expect(onePdf.headers()['content-type']).toBe('application/pdf');
    const downloadHref = (await ready.getByRole('link', { name: 'Download PDF' }).getAttribute('href')) ?? '';

    // A viewer can preview (page, designer, sample PDF) but every write is hidden and refused.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/badges`);
    await expect(
      viewer.getByText('You can preview badges. Only organizers who can edit the event can change them.'),
    ).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'New template' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Create PDF' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Save for / })).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'One badge' })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.getByRole('link', { name: 'Preview: Attendee badge' }).click();
    await expect(viewer.getByRole('heading', { name: 'Preview: Attendee badge', level: 1 })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save template' })).toHaveCount(0);
    await expect(viewer.getByLabel('From the left (mm)')).toHaveCount(0);
    await expectAccessible(viewer);
    const sample = await viewer.request.get(
      `${await viewer.getByRole('link', { name: 'Sample PDF in Arabic: Attendee badge' }).getAttribute('href')}`,
    );
    expect(sample.status()).toBe(200);
    expect(sample.headers()['content-type']).toBe('application/pdf');
    // Direct URLs for writes and exports are refused.
    expect((await viewer.request.get(downloadHref, { maxRedirects: 0 })).status()).toBe(403);
    expect((await viewer.request.get(oneHref)).status()).toBe(403);
    await viewer.goto(designerUrl);
    await expect(viewer.getByRole('button', { name: 'Save template' })).toHaveCount(0);
    await viewer.context().close();

    // The Arabic console renders right to left.
    await page.goto(`/ar${base}/badges`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الشارات', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${new URL(designerUrl).pathname}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });

  test('only events whose profile lists Badges have the page', async ({ page }) => {
    await signIn(page);
    const res = await page.goto(`${OPEN_HOUSE}/badges`);
    expect(res?.status()).toBe(404);
  });

  test('a download link without a valid signature is refused', async ({ page }) => {
    const res = await page.request.get(
      '/api/badges/00000000-0000-7000-8000-000000000000~00000000-0000-7000-8000-000000000001~zzzzzz~forged',
    );
    expect(res.status()).toBe(404);
  });
});
