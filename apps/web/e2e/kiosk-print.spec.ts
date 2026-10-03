import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';

/**
 * M5.5c kiosk self-print: the organizer turns it on for an event (keyboard, persisted, viewer sees
 * no controls); a kiosk (M3.4a) then lets an attendee scan their ticket or confirm a code emailed
 * to them, check their own details and print their badge once — the browser path opens the badge
 * PDF; a second try is sent to the desk; nothing about one attendee stays on screen for the next;
 * offline it still shows the scanned attendee's own badge from the sealed snapshot; the print log
 * shows one kiosk print per attendee. Arabic RTL and axe on every kiosk state.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';

const stamp = () => `${test.info().project.name.split('-')[0]}${Date.now().toString(36)}`;

function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A conference happening now, with a free pass and a default badge template. */
async function conferenceNow(page: Page, name: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(4));
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
  await page.goto(`${base}/badges`);
  const create = page.getByRole('region', { name: 'New template' });
  await create.getByLabel('Template name').fill('Attendee badge');
  await create.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('heading', { name: 'Design: Attendee badge', level: 1 })).toBeVisible();
  return { base, slug: base.split('/').pop() ?? '' };
}

interface Guest {
  readonly name: string;
  readonly email: string;
  readonly code: string;
}

/** A guest registers on the public page; returns their ticket's short code. */
async function register(browser: Browser, slug: string, name: string): Promise<Guest> {
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  const email = `kiosk+${name.split(' ')[0]?.toLowerCase()}${Date.now()}@example.test`;
  await guest.goto(`/events/${slug}`);
  await guest.getByLabel('Quantity — Delegate').selectOption('1');
  await guest.getByLabel('Full name').fill(name);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  const code = (await guest.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
  expect(code).not.toBe('');
  await ctx.close();
  return { name, email, code };
}

/** Enroll a device on the door screen; returns its setup link. */
async function addDevice(page: Page, base: string, label: string): Promise<string> {
  await page.goto(`${base}/onsite`);
  await page.getByLabel('Device name').fill(label);
  await page.getByRole('button', { name: 'Add device' }).click();
  const link = await page.getByTestId('scan-link').getAttribute('href');
  expect(link).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_/);
  return link ?? '';
}

async function openDevice(browser: Browser, link: string, eventName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: eventName })).toBeVisible();
  return { context, page };
}

/** A supervisor on a signed-in phone turns the device into a kiosk (PIN 2468). */
async function startKiosk(browser: Browser, page: Page, base: string, eventName: string, label: string) {
  const kiosk = await openDevice(browser, await addDevice(page, base, label), eventName);
  const phone = await openDevice(browser, await addDevice(page, base, `Phone ${label}`), eventName);
  await signIn(phone.page);
  await phone.page.goto('/scan');
  await phone.page
    .getByRole('navigation', { name: 'Scanner mode' })
    .getByRole('button', { name: 'Supervisor', exact: true })
    .click();
  const card = phone.page
    .getByRole('listitem')
    .filter({ has: phone.page.getByRole('heading', { name: label }) });
  await card.getByLabel(`Kiosk PIN for ${label}`).fill('2468');
  await card.getByRole('button', { name: 'Start kiosk' }).click();
  await expect(phone.page.getByTestId('supervisor-message')).toHaveText(`${label} is now a kiosk.`);
  await phone.context.close();
  await expect(kiosk.page.getByRole('heading', { name: `Welcome to ${eventName}` })).toBeVisible({
    timeout: 20_000,
  });
  return kiosk;
}

const codeField = (k: Page) => k.getByLabel('Scan your ticket or type its code');
async function scanAt(k: Page, code: string) {
  await codeField(k).fill(code);
  await codeField(k).press('Enter');
}

async function enableKioskPrint(page: Page, base: string) {
  await page.goto(`${base}/badges/printing`);
  const section = page.getByRole('region', { name: 'Kiosk self-print' });
  await expect(section.getByText('Off', { exact: true })).toBeVisible();
  // Keyboard only: tick "Let attendees print…" with Space, submit with Enter.
  const enabled = section.getByLabel('Let attendees print their own badge at kiosks');
  await enabled.focus();
  await page.keyboard.press('Space');
  await expect(enabled).toBeChecked();
  await expect(section.getByLabel(/Use your email/)).toBeChecked();
  await expect(section.getByLabel('Kiosks print to')).toHaveValue('');
  await section.getByRole('button', { name: 'Save kiosk settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(section.getByText('Kiosk settings saved.')).toBeVisible();
  await page.reload();
  await expect(section.getByText('On', { exact: true })).toBeVisible();
  await expect(section.getByText(/Prints to The kiosk's own print dialog · Email codes on/)).toBeVisible();
  await expect(section.getByLabel('Let attendees print their own badge at kiosks')).toBeChecked();
  return section;
}

test.describe('kiosk self-print (M5.5c)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('scan, check your details, print once; the desk for a second print; email code; offline; never another attendee; log; Arabic', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const name = `Kiosk Summit ${s}`;
    const { base, slug } = await conferenceNow(page, name);
    const ada = await register(browser, slug, `Ada Kiosk${s}`);
    const bo = await register(browser, slug, `Bo Kiosk${s}`);
    const cy = await register(browser, slug, `Cy Kiosk${s}`);
    const di = await register(browser, slug, `Di Kiosk${s}`);

    // A kiosk before self-print is on: plain self check-in, no email option, no details.
    const kiosk: { context: BrowserContext; page: Page } = await startKiosk(
      browser,
      page,
      base,
      name,
      `Lobby ${s}`,
    );
    const k = kiosk.page;
    await expect(k.getByRole('button', { name: 'No ticket with you? Use your email' })).toHaveCount(0);
    await scanAt(k, di.code);
    await expect(k.locator('[data-kiosk-result]')).toHaveText(/You're checked in\. Enjoy!/);
    await expect(k.locator('[data-kiosk-print]')).toHaveCount(0);
    await expect(k.getByText(di.name)).toHaveCount(0);

    // The organizer turns self-print on (keyboard only; persisted; axe in both modes).
    const section = await enableKioskPrint(page, base);
    await expectAccessibleBothModes(page);
    await expect(section).toBeVisible();

    // The kiosk picks it up (on its next refresh; a reload is the quickest).
    await k.reload();
    const useEmail = k.getByRole('button', { name: 'No ticket with you? Use your email' });
    await expect(useEmail).toBeVisible({ timeout: 20_000 });
    const box = await useEmail.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Ada scans: checked in, and only Ada's details to check.
    await scanAt(k, ada.code);
    await expect(k.locator('[data-kiosk-result]')).toHaveText(/You're checked in\. Enjoy!/);
    await expect(k.getByRole('heading', { name: 'Check your details' })).toBeFocused();
    await expect(k.locator('[data-kiosk-name]')).toHaveText(ada.name);
    await expect(k.getByText('Delegate', { exact: true })).toBeVisible();
    await expect(k.getByText(ada.email)).toHaveCount(0);
    await expect(codeField(k)).toHaveCount(0);
    for (const label of ['Print my badge', "Something's wrong", 'Not me']) {
      const b = await k.getByRole('button', { name: label }).boundingBox();
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectAccessibleBothModes(k);
    // "Not me" ends the visit: nothing about Ada stays.
    await k.getByRole('button', { name: 'Not me' }).click();
    await expect(codeField(k)).toBeFocused();
    await expect(k.getByText(ada.name)).toHaveCount(0);

    // Ada again (already checked in): print by keyboard; the badge PDF opens for the print dialog.
    await scanAt(k, ada.code);
    await expect(k.locator('[data-kiosk-name]')).toHaveText(ada.name);
    const pdf = k.waitForResponse((r) => r.url().includes('/api/scan/kiosk/badges/pdf'));
    await k.getByRole('button', { name: 'Print my badge' }).focus();
    await k.keyboard.press('Enter');
    const pdfRes = await pdf;
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toBe('application/pdf');
    await expect(k.getByRole('heading', { name: 'Your badge is ready to print' })).toBeFocused();
    await expect(k.getByRole('link', { name: 'Open my badge to print' })).toHaveAttribute('href', /^blob:/);
    await expectAccessible(k);
    await k.getByRole('button', { name: 'Done' }).click();
    await expect(k.getByText(ada.name)).toHaveCount(0);

    // A second print is the desk's (a reprint needs a reason): logged once.
    await scanAt(k, ada.code);
    await expect(k.getByRole('heading', { name: 'Please see the desk' })).toBeVisible();
    await expect(k.getByText('Your badge has already been printed.', { exact: false })).toBeVisible();
    await expect(k.getByText(ada.name)).toHaveCount(0);
    await expectAccessible(k);
    await k.getByRole('button', { name: 'Done' }).click();

    // "Something's wrong" sends Cy to the desk without printing.
    await scanAt(k, cy.code);
    await expect(k.locator('[data-kiosk-name]')).toHaveText(cy.name);
    await k.getByRole('button', { name: "Something's wrong" }).click();
    await expect(k.getByText('the desk will correct your details', { exact: false })).toBeVisible();
    await k.getByRole('button', { name: 'Done' }).click();
    await expect(k.getByText(cy.name)).toHaveCount(0);

    // Bo has no ticket with them: the email code, keyboard only, with its validation.
    await useEmail.focus();
    await k.keyboard.press('Enter');
    const email = k.getByLabel('Your email');
    await expect(email).toBeFocused();
    await k.keyboard.press('Enter');
    await expect(k.getByText('Enter your email address, like name@example.com.')).toBeVisible();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(k);
    await email.fill(bo.email);
    await k.keyboard.press('Enter');
    const code = k.getByLabel('6-digit code');
    await expect(code).toBeFocused();
    await expect(k.getByText(`If ${bo.email} has a ticket for this event`, { exact: false })).toBeVisible();
    const sent = (await (
      await page.request.get(`/api/dev/last-code?to=${encodeURIComponent(bo.email)}`)
    ).json()) as {
      code: string;
    };
    expect(sent.code).toMatch(/^\d{6}$/);
    await code.fill(String((Number(sent.code) + 1) % 1_000_000).padStart(6, '0'));
    await k.keyboard.press('Enter');
    await expect(k.getByText("That code isn't right. 4 tries left.")).toBeVisible();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await code.fill(sent.code);
    await k.keyboard.press('Enter');
    await expect(k.locator('[data-kiosk-name]')).toHaveText(bo.name);
    await expect(k.locator('[data-kiosk-result]')).toHaveText(/You're checked in\. Enjoy!/);
    await k.getByRole('button', { name: 'Print my badge' }).click();
    await expect(k.getByRole('heading', { name: 'Your badge is ready to print' })).toBeVisible();
    await k.getByRole('button', { name: 'Done' }).click();
    await expect(k.getByText(bo.name)).toHaveCount(0);

    // An address with nothing here gets the same answer (no enumeration).
    await useEmail.click();
    await k.getByLabel('Your email').fill(`nobody+${s}@example.test`);
    await k.getByRole('button', { name: 'Email me a code' }).click();
    await expect(
      k.getByText(`If nobody+${s}@example.test has a ticket for this event`, { exact: false }),
    ).toBeVisible();
    await k.getByRole('button', { name: 'Cancel' }).click();

    // Arabic kiosk (RTL), with the details panel.
    await k.goto('/ar/scan');
    await expect(k.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(k.getByRole('button', { name: 'ليست معك تذكرتك؟ استخدم بريدك الإلكتروني' })).toBeVisible({
      timeout: 20_000,
    });
    await k.locator('#kiosk-code').fill(cy.code);
    await k.keyboard.press('Enter');
    await expect(k.getByRole('heading', { name: 'راجع بياناتك' })).toBeVisible();
    await expectAccessible(k);
    await k.getByRole('button', { name: 'لست أنا' }).click();
    await k.goto('/scan');

    // Offline: Cy's own badge comes from the sealed snapshot; a print-dialog kiosk sends them to the desk.
    await expect(useEmail).toBeVisible({ timeout: 20_000 });
    await kiosk.context.setOffline(true);
    await scanAt(k, cy.code);
    await expect(k.locator('[data-kiosk-name]')).toHaveText(cy.name);
    await k.getByRole('button', { name: 'Print my badge' }).click();
    await expect(k.getByText('The kiosk is offline right now.', { exact: false })).toBeVisible();
    await k.getByRole('button', { name: 'Done' }).click();
    await expect(k.getByText(cy.name)).toHaveCount(0);
    await kiosk.context.setOffline(false);

    // The print log: one kiosk print each for Ada and Bo, none for Cy or Di.
    await page.goto(`${base}/badges/printing`);
    const log = page.getByRole('region', { name: 'Print log' });
    await expect(log.getByRole('row').filter({ hasText: ada.name })).toHaveCount(1);
    await expect(log.getByRole('row').filter({ hasText: ada.name })).toContainText('Kiosk');
    await expect(log.getByRole('row').filter({ hasText: bo.name })).toHaveCount(1);
    await expect(log.getByRole('row').filter({ hasText: cy.name })).toHaveCount(0);
    await expect(log.getByRole('row').filter({ hasText: di.name })).toHaveCount(0);
    await kiosk.context.close();
  });

  test('a viewer sees the kiosk setting but cannot change it; the kiosk API refuses other devices; Arabic console', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const name = `Kiosk Rules ${s}`;
    const { base } = await conferenceNow(page, name);
    await enableKioskPrint(page, base);

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/badges/printing`);
    const section = viewer.getByRole('region', { name: 'Kiosk self-print' });
    await expect(section.getByText('On', { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Save kiosk settings' })).toHaveCount(0);
    await expect(section.getByLabel('Let attendees print their own badge at kiosks')).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.context().close();

    // A device that is not a kiosk is refused; no token at all is unauthenticated.
    const link = await addDevice(page, base, `Scanner ${s}`);
    const [, eventId, token] = /#e=([0-9a-f-]{36})&k=(yyd_[A-Za-z0-9_-]+)/.exec(link) ?? [];
    const asScanner = await page.request.post('/api/scan/kiosk/badges', {
      headers: { authorization: `Bearer ${token}` },
      data: { action: 'lookup', eventId, code: 'ABCDEFGH' },
    });
    expect(asScanner.status()).toBe(403);
    const snapshot = await page.request.get(`/api/scan/kiosk/badges?eventId=${eventId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.status()).toBe(403);
    const anonymous = await page.request.post('/api/scan/kiosk/badges', {
      data: { action: 'lookup', eventId, code: 'ABCDEFGH' },
    });
    expect(anonymous.status()).toBe(401);

    // The Arabic console renders right to left.
    await page.goto(`/ar${base}/badges/printing`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الطباعة الذاتية في الكشك' })).toBeVisible();
    await expectAccessible(page);
  });
});
