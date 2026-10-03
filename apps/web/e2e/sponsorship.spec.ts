import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  signIn,
} from './helpers.ts';

/**
 * M5.4b: sponsor packages and deliverables, the sponsor portal and lead licenses. The organizer
 * sets Gold's terms, grants it or lets a sponsor contact buy it in the portal (the fake provider's
 * hosted page), and the sponsor gets exactly its allowances (comp code, badges, licenses, logo
 * placements, a session slot). Deliverables list overdue ones first; sponsors tick off their own.
 * Exhibitor admins give out lead licenses and buy extra ones. The viewer reads only.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

/** A published conference with a Gold tier, one sponsor per name and one exhibitor. */
async function conference(page: Page, name: string, sponsors: string[], exhibitor?: string) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/sponsors`);
  const tier = page.getByRole('region', { name: 'Add tier' });
  await tier.getByLabel('Tier name').fill('Gold');
  await tier.getByLabel('Order').fill('1');
  await tier.getByRole('button', { name: 'Add tier' }).click();
  await expect(tier.getByText('Tier added.')).toBeVisible();
  for (const s of sponsors) {
    const add = page.getByRole('region', { name: 'Add sponsor' });
    await add.getByLabel('Sponsor name').fill(s);
    await add.getByRole('button', { name: 'Add sponsor' }).click();
    await expect(add.getByText('Sponsor added.')).toBeVisible();
  }
  if (exhibitor) {
    await page.goto(`${base}/exhibitors`);
    const add = page.getByRole('region', { name: 'Add exhibitor' });
    await add.getByLabel('Exhibitor name').fill(exhibitor);
    await add.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(add.getByText('Exhibitor added.')).toBeVisible();
  }
  return { base };
}

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.status()).toBe(200);
}

type Mail = { subject: string; text: string };
/** The invitation link in the newest portal invitation to an address (drains the outbox first). */
async function portalLink(page: Page, email: string) {
  let link = '';
  await expect
    .poll(
      async () => {
        await drain(page);
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const list = ((await res.json()) as Mail[]).filter(
          (m) => /portal/.test(m.subject) && /invite/.test(m.text),
        );
        link =
          (list[0]?.text.match(/https?:\/\/[^\s]+/g) ?? []).find((u) => /\/event-portal\/invite\//.test(u)) ??
          '';
        return link !== '';
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return new URL(link).pathname;
}

async function signInByCode(guest: Page, link: string, email: string) {
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Email me a sign-in code' }).focus();
  await guest.keyboard.press('Enter');
  const code = guest.getByLabel('Verification code', { exact: true });
  await expect(code).toBeFocused();
  await code.fill(await lastEmailedCode(guest, email));
  await code.press('Enter');
  await expect(guest).toHaveURL(/\/event-portal$/);
}

async function guestPage(browser: Browser) {
  const context = await browser.newContext();
  await ownClientIp(context);
  return context.newPage();
}

const card = (page: Page, heading: string) =>
  page.locator('li').filter({ has: page.getByRole('heading', { name: heading, level: 3, exact: true }) });

/** Set Gold's terms on the packages page (price, quantity, on sale, allowances, a template). */
async function setGoldTerms(page: Page, base: string) {
  await page.goto(`${base}/sponsors/packages`);
  const gold = card(page, 'Gold');
  await expect(gold.getByText('No terms yet')).toBeVisible();
  await gold.getByText('Edit the Gold package').click();
  await gold.getByLabel('Price (USD)').fill('5000');
  await gold.getByLabel('How many to sell').fill('3');
  await gold.getByLabel('Sponsors can buy it in their portal').check();
  await gold.getByLabel('Comp registrations').fill('10');
  await gold.getByLabel('Exhibitor badges').fill('4');
  await gold.getByLabel('Lead licenses').fill('3');
  await gold.getByLabel('Session slots').fill('1');
  await gold.getByLabel('Website').check();
  await gold.getByLabel('Stage').check();
  await gold.getByLabel('Deliverables for every holder').fill('Send logo files | sponsor | 21');
  await gold.getByRole('button', { name: 'Save package' }).click();
  await expect(gold.getByText('Package saved.')).toBeVisible();
  await expect(gold.getByText('On sale')).toBeVisible();
  await expect(gold.getByText(/\$5,000\.00 · Holders: 0 of 3 · left: 3/)).toBeVisible();
}

test.describe('sponsor packages and deliverables (M5.4b)', () => {
  test('package terms with validation, grant by keyboard, exhibitor link, contact invite; axe light/dark, RTL', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Summit ${s}`, [`Acme ${s}`], `Acme Booth ${s}`);

    // Sponsors page links to the new pages.
    await page.goto(`${base}/sponsors`);
    await page.getByRole('link', { name: 'Packages and sponsors' }).click();
    await expect(page.getByRole('heading', { name: 'Sponsor packages', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Validation: on sale without a price; a malformed template line.
    const gold = card(page, 'Gold');
    await gold.getByText('Edit the Gold package').click();
    await gold.getByLabel('Sponsors can buy it in their portal').check();
    await gold.getByRole('button', { name: 'Save package' }).click();
    await expect(gold.getByText('A package on sale needs a price.')).toBeVisible();
    await gold.getByLabel('Price (USD)').fill('5000');
    await gold.getByLabel('Deliverables for every holder').fill('Logo files without owner');
    await gold.getByRole('button', { name: 'Save package' }).click();
    await expect(gold.getByText(/Write one deliverable per line/)).toBeVisible();
    await expect(gold.getByLabel('Deliverables for every holder')).toHaveAttribute('aria-invalid', 'true');
    await setGoldTerms(page, base);

    // Grant Gold to Acme by keyboard only.
    const acme = card(page, `Acme ${s}`);
    await expect(acme.getByText('No package', { exact: true })).toBeVisible();
    await acme.getByLabel(`Package for Acme ${s}`).focus();
    await acme.getByLabel('Note').focus();
    await page.keyboard.type('Paid by wire');
    await acme.getByRole('button', { name: 'Grant package' }).focus();
    await page.keyboard.press('Enter');
    await expect(acme.getByText('Gold package')).toBeVisible();
    await expect(acme.getByText(/Granted by you · Paid by wire/)).toBeVisible();
    await expect(acme.getByText('Comp registrations')).toBeVisible();
    // Its comp code comes from the outbox (registration's subscriber).
    await drain(page);
    await page.reload();
    await expect(card(page, `Acme ${s}`).getByText(/COMP-[A-Z0-9]{8}/)).toBeVisible();
    await expect(card(page, 'Gold').getByText(/Holders: 1 of 3 · left: 2/)).toBeVisible();

    // The exhibitor it exhibits as, and a contact.
    const acme2 = card(page, `Acme ${s}`);
    await acme2.getByLabel(`Exhibitor for Acme ${s}`).selectOption({ label: `Acme Booth ${s}` });
    await acme2.getByRole('button', { name: 'Save exhibitor' }).click();
    await expect(acme2.getByText('Exhibitor saved.')).toBeVisible();
    await acme2.getByText(`Invite a contact to Acme ${s}`).click();
    await acme2.getByLabel('Email').fill('not-an-email');
    await acme2.getByRole('button', { name: 'Send invitation' }).click();
    await expect(acme2.getByText('Enter an email address.')).toBeVisible();
    await acme2.getByLabel('Email').fill(`acme+${s}@sponsor.test`);
    await acme2.getByRole('button', { name: 'Send invitation' }).click();
    await expect(acme2.getByText('Invitation sent.')).toBeVisible();
    await page.reload();
    await expect(card(page, `Acme ${s}`).getByText(`acme+${s}@sponsor.test`, { exact: true })).toBeVisible();
    await expect(
      card(page, `Acme ${s}`)
        .locator('p')
        .filter({ hasText: `Acme Booth ${s}` }),
    ).toBeVisible();
    // Lead licenses page: 1 included + 3 from Gold; staff badges 5 + 4.
    await page.goto(`${base}/exhibitors`);
    await page.getByRole('link', { name: 'Lead licenses' }).click();
    const booth = card(page, `Acme Booth ${s}`);
    await expect(
      booth.getByText(/Licenses in use: 0 of 4 \(included 1 · packages 3 · bought 0\)/),
    ).toBeVisible();
    await expect(booth.getByText('Staff badges: 5 + 4 from sponsor packages')).toBeVisible();
    await expectAccessible(page);

    // Arabic, right to left.
    await page.goto(`/ar${base}/sponsors/packages`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'باقات الرعاية', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('deliverables: overdue ones listed first, ticked off by keyboard, persist; empty state; RTL', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Deliver ${s}`, [`Globex ${s}`]);
    await page.goto(`${base}/sponsors/deliverables`);
    await expect(page.getByRole('heading', { name: 'Sponsor deliverables', level: 1 })).toBeVisible();
    await expect(page.getByText('No deliverables yet')).toBeVisible();
    await expect(page.getByText('Nothing is overdue.')).toBeVisible();
    await expectAccessibleBothModes(page);

    const add = page.getByRole('region', { name: 'Add deliverable' });
    // Validation: no title.
    await add.getByLabel('Due date').fill(chicagoDate(-2));
    await add.getByRole('button', { name: 'Add deliverable' }).click();
    await expect(add.getByText(/Enter what is due/)).toBeVisible();
    // Past due (two days ago in Chicago), due today (not overdue), and next week.
    for (const [title, days, owner] of [
      [`Banner proof ${s}`, -2, 'Organizer'],
      [`Logo files ${s}`, 0, 'Sponsor'],
      [`Ad copy ${s}`, 7, 'Sponsor'],
    ] as const) {
      await add.getByLabel('What is due').fill(title);
      await add.getByLabel('Who delivers it').selectOption({ label: owner });
      await add.getByLabel('Due date').fill(chicagoDate(days));
      await add.getByRole('button', { name: 'Add deliverable' }).click();
      await expect(add.getByText('Deliverable added.')).toBeVisible();
    }
    await page.reload();
    const overdue = page.getByRole('list', { name: 'Overdue deliverables' });
    await expect(overdue.getByRole('listitem')).toHaveCount(1);
    await expect(overdue.getByText(`Banner proof ${s}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overdue (1)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'All deliverables (3)' })).toBeVisible();

    // Tick it off by keyboard: it leaves the overdue list, and stays done after a reload.
    await overdue.getByRole('button', { name: `Mark Banner proof ${s} done` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Nothing is overdue.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Nothing is overdue.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Reopen Banner proof ${s}` })).toBeVisible();
    await expectAccessible(page);

    // The packages page counts them on the sponsor.
    await page.goto(`${base}/sponsors/packages`);
    await expect(
      card(page, `Globex ${s}`).getByText('Deliverables: 2 open · 1 done · 0 overdue'),
    ).toBeVisible();

    await page.goto(`/ar${base}/sponsors/deliverables`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'مستحقات الرعاة', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a sponsor contact buys Gold on the payment page and gets exactly its allowances; ticks off a deliverable', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Buy ${s}`, [`Initech ${s}`]);
    await setGoldTerms(page, base);
    const email = `initech+${s}@sponsor.test`;
    const initech = card(page, `Initech ${s}`);
    await initech.getByText(`Invite a contact to Initech ${s}`).click();
    await initech.getByLabel('Email').fill(email);
    await initech.getByRole('button', { name: 'Send invitation' }).click();
    await expect(initech.getByText('Invitation sent.')).toBeVisible();

    const guest = await guestPage(browser);
    await signInByCode(guest, await portalLink(page, email), email);
    await expect(guest.getByRole('heading', { name: `Initech ${s}`, level: 1 })).toBeVisible();
    await expect(guest.getByText('Sponsor portal').first()).toBeVisible();
    await expect(guest.getByText('Comp registrations: 10')).toBeVisible();
    await expect(guest.getByText('Your logo on: Stage, Website')).toBeVisible();
    await expect(guest.getByText('Nothing due yet')).toBeVisible();
    await expectAccessibleBothModes(guest);

    // Buy by keyboard: the fake provider's hosted page, then back to the portal.
    await guest.getByRole('button', { name: 'Buy Gold for $5,000.00' }).focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('button', { name: 'Pay now (test)' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText('$5,000.00')).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest).toHaveURL(/\/event-portal\?paid=1$/);
    await expect(guest.getByText('Thank you. Your Gold package is active.')).toBeVisible();
    await expect(guest.getByText('Paid $5,000.00')).toBeVisible();
    for (const line of [
      'Comp registrations: 10',
      'Exhibitor badges: 4',
      'Lead licenses: 3',
      'Session slots: 1',
      'Your logo on: Stage, Website',
    ])
      await expect(guest.getByText(line)).toBeVisible();
    await expect(guest.getByRole('button', { name: /^Buy / })).toHaveCount(0);
    // The comp code (made through the outbox) and its use count.
    await drain(page);
    await guest.reload();
    await expect(guest.getByText(/COMP-[A-Z0-9]{8}/)).toBeVisible();
    await expect(guest.getByText('Used: 0 of 10')).toBeVisible();
    // The package's deliverable, due 21 days before the event; the sponsor ticks it off.
    const row = guest.locator('li').filter({ hasText: 'Send logo files' });
    await expect(row.getByText('From you')).toBeVisible();
    await row.getByRole('button', { name: 'Mark Send logo files done' }).focus();
    await guest.keyboard.press('Enter');
    await expect(row.getByText('Done', { exact: true })).toBeVisible();
    await guest.reload();
    await expect(
      guest.locator('li').filter({ hasText: 'Send logo files' }).getByText('Done', { exact: true }),
    ).toBeVisible();
    await expectAccessible(guest);

    // The organizer sees the purchase.
    await page.goto(`${base}/sponsors/packages`);
    await expect(card(page, `Initech ${s}`).getByText('Bought online for $5,000.00')).toBeVisible();

    await guest.goto('/ar/event-portal');
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByText('باقتك')).toBeVisible();
    await expectAccessible(guest);
    await guest.context().close();
  });

  test('an exhibitor admin gives out lead licenses and buys extra ones; staff see their own', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Leads ${s}`, [], `Umbrella ${s}`);
    // Licenses page: validation, then 1 included and $250 per extra license.
    await page.goto(`${base}/exhibitors/licenses`);
    await expect(page.getByRole('heading', { name: 'Lead licenses', level: 1 })).toBeVisible();
    const settings = page.getByRole('region', { name: 'Licenses for every exhibitor' });
    await settings.getByLabel('Price of an extra license (USD)').fill('abc');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByText(/Enter a price like 250/)).toBeVisible();
    await settings.getByLabel('Price of an extra license (USD)').fill('250');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByText('Saved.')).toBeVisible();
    await expect(settings.getByText('Extra licenses: $250.00 each.')).toBeVisible();
    await expectAccessible(page);

    // Invite the exhibitor admin from the portal page.
    const email = `umbrella+${s}@exhibitor.test`;
    await page.goto(`${base}/exhibitors/portal`);
    await page.getByText(`Invite someone to Umbrella ${s}`).click();
    const form = page
      .locator('form')
      .filter({ has: page.locator(`input[id^="invite-"][name="email"]`) })
      .first();
    await form.getByLabel('Email').fill(email);
    await form.getByRole('button', { name: 'Send invitation' }).click();
    await expect(form.getByText('Invitation sent.')).toBeVisible();

    const guest = await guestPage(browser);
    await signInByCode(guest, await portalLink(page, email), email);
    const leads = guest.getByRole('region', { name: 'Lead licenses' });
    await expect(leads.getByText('Licenses in use: 0 of 1')).toBeVisible();
    // Give themselves the included license by keyboard.
    await leads.getByRole('button', { name: `Give ${email} a license` }).focus();
    await guest.keyboard.press('Enter');
    await expect(leads.getByText('Licenses in use: 1 of 1')).toBeVisible();
    // Invite a staff member: no license left for them.
    const staff = `staff+${s}@exhibitor.test`;
    const invite = guest.locator('form').filter({ has: guest.getByLabel('Staff email') });
    await invite.getByLabel('Staff email').fill(staff);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(invite.getByText('Invitation sent.')).toBeVisible();
    const staffRow = guest
      .getByRole('region', { name: 'Lead licenses' })
      .locator('li')
      .filter({ hasText: staff });
    await staffRow.getByRole('button', { name: `Give ${staff} a license` }).click();
    await expect(staffRow.getByText('Every license is in use. Take one back or buy more.')).toBeVisible();
    await expectAccessibleBothModes(guest);

    // Buy 2 more: validation, then the payment page.
    const buy = guest
      .getByRole('region', { name: 'Lead licenses' })
      .locator('form')
      .filter({ has: guest.getByLabel('How many') });
    await buy.getByLabel('How many').fill('0');
    await buy.getByRole('button', { name: 'Buy licenses' }).click();
    await expect(buy.getByText('Enter a number from 1 to 100.')).toBeVisible();
    await buy.getByLabel('How many').fill('2');
    await buy.getByRole('button', { name: 'Buy licenses' }).click();
    await expect(guest.getByRole('button', { name: 'Pay now (test)' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText('$500.00')).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest).toHaveURL(/\/event-portal\?paid=1$/);
    const after = guest.getByRole('region', { name: 'Lead licenses' });
    await expect(after.getByText('Thank you. Your extra licenses are ready to give out.')).toBeVisible();
    await expect(after.getByText('Licenses in use: 1 of 3')).toBeVisible();
    await after
      .locator('li')
      .filter({ hasText: staff })
      .getByRole('button', { name: `Give ${staff} a license` })
      .click();
    await expect(after.getByText('Licenses in use: 2 of 3')).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole('region', { name: 'Lead licenses' }).getByText('Licenses in use: 2 of 3'),
    ).toBeVisible();
    await expectAccessible(guest);

    // The organizer sees it.
    await page.goto(`${base}/exhibitors/licenses`);
    await expect(
      card(page, `Umbrella ${s}`).getByText(/Licenses in use: 2 of 3 \(included 1 · packages 0 · bought 2\)/),
    ).toBeVisible();

    await guest.goto('/ar/event-portal');
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('region', { name: 'تراخيص العملاء المحتملين' })).toBeVisible();
    await expectAccessible(guest);
    await guest.context().close();
  });

  test('the viewer reads packages, deliverables and licenses but gets no controls', async ({ page }) => {
    test.setTimeout(150_000);
    const s = stamp();
    await signIn(page);
    const { base } = await conference(page, `Viewer ${s}`, [`Hooli ${s}`]);
    await setGoldTerms(page, base);
    await page.context().clearCookies();
    await signIn(page, VIEWER);
    await page.goto(`${base}/sponsors/packages`);
    await expect(page.getByRole('heading', { name: 'Sponsor packages', level: 1 })).toBeVisible();
    await expect(
      page.getByText('You can view the program. Only organizers with edit rights can change it.').first(),
    ).toBeVisible();
    await expect(card(page, 'Gold').getByText('On sale')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grant package' })).toHaveCount(0);
    await expect(page.getByText('Edit the Gold package')).toHaveCount(0);
    await expect(page.getByText(`Invite a contact to Hooli ${s}`)).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(`${base}/sponsors/deliverables`);
    await expect(page.getByRole('region', { name: 'Add deliverable' })).toHaveCount(0);
    await page.goto(`${base}/exhibitors/licenses`);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  });
});
