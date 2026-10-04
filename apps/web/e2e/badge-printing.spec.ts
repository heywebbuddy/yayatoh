import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  pickOption,
  signIn,
} from './helpers.ts';

/**
 * M5.5b printing and the print log: printers per event, a print station's heartbeat keeping its
 * printer online (and offline after 90 s of silence), onsite print and reprint from the attendee's
 * profile (a reprint needs a reason), the desk print page, PrintNode through the fake, the print
 * log with every print and reprint and its reason, a viewer's limits, and the Arabic console.
 */
const ORG = '/o/lakeside-events';
const ORG_SLUG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';

const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now().toString(36)}`;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function createConference(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'conference');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${day(30)}T09:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${day(31)}T18:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Delegate');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('50');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Delegate' })).toBeVisible();
  // A default badge template (the first one is the default).
  await page.goto(`${base}/badges`);
  const create = page.getByRole('region', { name: 'New template' });
  await create.getByLabel('Template name').fill('Attendee badge');
  await create.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('heading', { name: 'Design: Attendee badge', level: 1 })).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

async function register(browser: Browser, slug: string, name: string) {
  const guest = await (await browser.newContext()).newPage();
  const email = `${name.split(' ')[0]?.toLowerCase()}+${Date.now()}@example.test`;
  await guest.goto(`/events/${slug}`);
  await pickOption(guest.getByLabel('Quantity — Delegate'), '1');
  await guest.getByLabel('Full name').fill(name);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  await guest.context().close();
}

const dev = (page: Page, form: Record<string, string>) =>
  page.request.post('/api/dev/printers', { form: { org: ORG_SLUG, ...form } });

test.describe('badge printing and print log (M5.5b)', () => {
  test('printers, station heartbeat and offline, print and reprint with reasons, the log; viewer and Arabic', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createConference(page, `Print Summit ${s}`);
    await register(browser, slug, 'Ada Lovelace');
    await register(browser, slug, 'Bob Baker');

    // The Badges page leads to printers and the print log.
    await page.goto(`${base}/badges`);
    await page.getByRole('link', { name: 'Printers and print log' }).click();
    await expect(page.getByRole('heading', { name: 'Printers and print log', level: 1 })).toBeVisible();
    await expect(page.getByText('No printers yet')).toBeVisible();
    await expect(page.getByText('Nothing printed yet')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Validation: a printer needs a name, and names are unique per event.
    const add = page.getByRole('region', { name: 'Add printer' });
    await add.getByRole('button', { name: 'Add printer' }).click();
    await expect(add.getByText('Give the printer a name (up to 60 characters).')).toBeVisible();
    await expect(add.getByLabel('Printer name')).toHaveAttribute('aria-invalid', 'true');
    await add.getByLabel('Printer name').fill('Front desk');
    await add.getByLabel('Printer name').press('Enter');
    await expect(add.getByText('Printer added.')).toBeVisible();
    const printers = page.getByRole('region', { name: 'Printers' });
    const desk = printers.getByRole('listitem').filter({ hasText: 'Front desk' });
    await expect(desk).toContainText('Not connected yet');
    await expect(desk).toContainText('No heartbeat yet');
    await add.getByLabel('Printer name').fill('FRONT DESK');
    await add.getByRole('button', { name: 'Add printer' }).click();
    await expect(add.getByText('This event already has a printer with that name.')).toBeVisible();
    // Persisted after a reload.
    await page.reload();
    await expect(desk).toBeVisible();

    // The print station, by keyboard: its heartbeat brings the printer online.
    const station = desk.getByRole('link', { name: 'Open print station: Front desk' });
    const deskId = (await station.getAttribute('href'))?.split('/').pop() ?? '';
    await station.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Print station: Front desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Heartbeat sent at' })).toBeVisible();
    await expect(page.getByText('Nothing printed on this printer yet.')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`${base}/badges/printing`);
    await expect(desk).toContainText('Online');
    await expect(desk).toContainText('Last heard from');

    // Silent for 90 s (the dev drain runs the worker's watchdog with the clock ahead): offline.
    const watched = await dev(page, { op: 'watch', aheadMs: '91000', printerId: deskId });
    expect(watched.ok()).toBe(true);
    await page.reload();
    await expect(desk).toContainText('Offline');
    await expect(desk).toContainText('Offline since');

    // Onsite print from the attendee's profile.
    await page.goto(`${base}/attendees?q=Ada`);
    await page
      .getByRole('table')
      .getByRole('link', { name: /Ada Lovelace/ })
      .click();
    const panel = page.getByRole('region', { name: 'Badge' });
    await expect(panel.getByText('Not printed yet.')).toBeVisible();
    await expect(panel.getByLabel('Why print it again?')).toHaveCount(0);
    await pickOption(panel.getByLabel('Printer'), { label: 'Front desk · Offline' });
    await panel.getByRole('button', { name: 'Print badge for Ada Lovelace' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      panel.getByText('Logged. Open the badge PDF and print it at actual size (100%).'),
    ).toBeVisible();
    const pdfLink = panel.getByRole('link', { name: 'Open badge PDF for Ada Lovelace' });
    const pdfHref = (await pdfLink.getAttribute('href')) ?? '';
    const pdf = await page.request.get(pdfHref);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(panel.getByText('Printed once, last on')).toBeVisible();
    await expectAccessible(page);

    // A reprint needs a reason ("Other" also a note).
    await panel.getByRole('button', { name: 'Reprint badge for Ada Lovelace' }).click();
    await expect(panel.getByText('Choose why this badge is printed again.')).toBeVisible();
    await expect(panel.getByLabel('Why print it again?')).toHaveAttribute('aria-invalid', 'true');
    await pickOption(panel.getByLabel('Why print it again?'), { label: 'Other' });
    await panel.getByRole('button', { name: 'Reprint badge for Ada Lovelace' }).click();
    await expect(panel.getByText('For “Other”, say why in a few words.')).toBeVisible();
    await pickOption(panel.getByLabel('Why print it again?'), { label: 'Damaged' });
    await panel.getByRole('button', { name: 'Reprint badge for Ada Lovelace' }).click();
    await expect(panel.getByText('Printed 2 times, last on')).toBeVisible();
    const history = panel.getByRole('list').last();
    await expect(history).toContainText('Reprint');
    await expect(history).toContainText('Damaged');
    await expectAccessible(page);

    // The desk print page, from the Badges page's badge search.
    await page.goto(`${base}/badges`);
    const one = page.getByRole('region', { name: 'One badge' });
    await one.getByLabel('Name or ticket number').fill('Bob');
    await one.getByRole('button', { name: 'Find' }).click();
    await page.getByRole('link', { name: 'Print badge for Bob Baker' }).click();
    await expect(page.getByRole('heading', { name: 'Print badge: Bob Baker', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Print badge for Bob Baker' }).click();
    await expect(page.getByRole('link', { name: 'Open badge PDF for Bob Baker' })).toBeVisible();
    await expect(page).toHaveURL(/\?printed=[0-9a-f-]{36}$/);
    // Reloading the confirmation does not print again.
    await page.reload();
    await expect(page.getByText('Printed once, last on')).toBeVisible();

    // PrintNode (the fake): switched on for the org, a printer by its PrintNode number.
    const pnId = String(2000 + Math.floor(Math.random() * 7000));
    expect((await dev(page, { op: 'printnode', enabled: '1' })).ok()).toBe(true);
    await page.goto(`${base}/badges/printing`);
    await add.getByLabel('Printer name').fill('Zebra');
    await pickOption(add.getByLabel('How it prints'), 'printnode');
    await add.getByRole('button', { name: 'Add printer' }).click();
    await expect(add.getByText("Enter the printer's PrintNode number.")).toBeVisible();
    await add.getByLabel('PrintNode printer number').fill(pnId);
    await add.getByRole('button', { name: 'Add printer' }).click();
    await expect(add.getByText('Printer added.')).toBeVisible();
    const zebra = printers.getByRole('listitem').filter({ hasText: 'Zebra' });
    await expect(zebra).toContainText(`PrintNode no. ${pnId}`);
    await expect(zebra.getByRole('link', { name: /Open print station/ })).toHaveCount(0);
    expect((await dev(page, { op: 'poll' })).ok()).toBe(true);
    await page.reload();
    await expect(zebra).toContainText('Online');

    await page.goto(`${base}/badges`);
    await one.getByLabel('Name or ticket number').fill('Bob');
    await one.getByRole('button', { name: 'Find' }).click();
    await page.getByRole('link', { name: 'Print badge for Bob Baker' }).click();
    await pickOption(page.getByLabel('Printer'), { label: 'Zebra · Online' });
    await pickOption(page.getByLabel('Why print it again?'), { label: 'Lost' });
    await page.getByRole('button', { name: 'Reprint badge for Bob Baker' }).click();
    await expect(page.getByText('Badge sent to Zebra.')).toBeVisible();
    // A printer that refuses: the job fails, is logged, and does not count.
    expect((await dev(page, { op: 'fake-state', printerId: pnId, state: 'rejects' })).ok()).toBe(true);
    await pickOption(page.getByLabel('Printer'), { label: 'Zebra · Online' });
    await pickOption(page.getByLabel('Why print it again?'), { label: 'Printer problem' });
    await page.getByRole('button', { name: 'Reprint badge for Bob Baker' }).click();
    await expect(
      page.getByText('The badge could not be sent (printer_rejected).', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Printed 2 times, last on')).toBeVisible();

    // The print log: every print and reprint, with its reason.
    await page.goto(`${base}/badges/printing`);
    const log = page.getByRole('region', { name: 'Print log' });
    await expect(log.getByText('2 first prints · 2 reprints')).toBeVisible();
    const rows = log.getByRole('row');
    await expect(rows.filter({ hasText: 'Ada Lovelace' }).filter({ hasText: 'Damaged' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Bob Baker' }).filter({ hasText: 'Lost' })).toContainText('Zebra');
    await expect(rows.filter({ hasText: 'Printer problem' })).toContainText('Failed');
    await expect(rows.filter({ hasText: 'First print' })).toHaveCount(2);
    await log.getByRole('link', { name: 'Reprints' }).click();
    await expect(log.getByRole('link', { name: 'Reprints' })).toHaveAttribute('aria-current', 'page');
    await expect(log.getByRole('row').filter({ hasText: 'First print' })).toHaveCount(0);
    await expect(log.getByRole('row').filter({ hasText: 'Damaged' })).toHaveCount(1);
    await expectAccessibleBothModes(page);

    // Archive a printer: it leaves the list.
    await page.goto(`${base}/badges/printing`);
    await add.getByLabel('Printer name').fill('Spare');
    await add.getByRole('button', { name: 'Add printer' }).click();
    const spare = printers.getByRole('listitem').filter({ hasText: 'Spare' });
    await spare.getByRole('button', { name: 'Archive Spare' }).click();
    await expect(page.getByText('Printer archived.')).toBeVisible();
    await page.reload();
    await expect(printers.getByRole('listitem').filter({ hasText: 'Spare' })).toHaveCount(0);
    const stationUrl = `${base}/badges/printing/${(await desk.getByRole('link', { name: /Open print station/ }).getAttribute('href'))?.split('/').pop()}`;

    // A viewer sees printers and the log, but cannot add, archive, open a station or print.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/badges/printing`);
    await expect(viewer.getByRole('heading', { name: 'Printers and print log', level: 1 })).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Print log' }).getByText('Damaged')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add printer' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Archive / })).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: /Open print station/ })).toHaveCount(0);
    await expectAccessible(viewer);
    expect((await viewer.goto(stationUrl))?.status()).toBe(404);
    expect((await viewer.request.get(pdfHref)).status()).toBe(403);
    await viewer.goto(`${base}/attendees?q=Ada`);
    await viewer
      .getByRole('table')
      .getByRole('link', { name: /Ada Lovelace/ })
      .click();
    await expect(viewer.getByRole('complementary')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Badge' })).toHaveCount(0);
    await viewer.context().close();

    // The Arabic console renders right to left.
    await page.goto(`/ar${base}/badges/printing`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${stationUrl}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });

  test('pages for unknown printers and tickets are not found', async ({ page }) => {
    await signIn(page);
    const summit = `${ORG}/e/midwest-leadership-summit-2027/badges`;
    const r1 = await page.goto(`${summit}/printing/00000000-0000-7000-8000-000000000000`);
    const r2 = await page.goto(`${summit}/print/not-a-uuid`);
    const r3 = await page.request.get(`${summit}/jobs/00000000-0000-7000-8000-000000000000/pdf`);
    for (const r of [r1?.status(), r2?.status(), r3.status()]) expect(r).toBe(404);
  });
});
