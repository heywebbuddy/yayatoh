import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, lastEmailedCode, signIn } from './helpers.ts';

/**
 * M5.1c approval, groups and +1: the organizer makes a type "by application" with an auto-approve
 * domain and a +1 guest type (by keyboard); an applicant at that domain is approved at once, pays
 * and brings a guest; another is approved by hand with a reason and pays from the emailed link; a
 * third is denied in bulk with a template reason and is never charged; a payer registers a group
 * of three and replaces one name; the viewer reads the queue and every write is refused; Arabic
 * renders right-to-left.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = 'lakeside-events';
const TZ = 'America/Chicago';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

test.describe.configure({ mode: 'serial' });

let base = '';
let slug = '';
let s = '';

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

async function guest(browser: Browser) {
  return (await browser.newContext()).newPage();
}

async function drain(page: Page) {
  await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
}

const typeCard = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Registration types' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

const rulesCard = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Applications, guests and name changes' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Set a matrix cell's price by keyboard. */
async function price(page: Page, cell: string, amount: string) {
  const field = page.getByLabel(`Price for ${cell} (USD)`);
  await field.fill(amount);
  await field.press('Enter');
  await expect(page.getByRole('button', { name: `Save price — ${cell}` })).toBeVisible();
}

async function addType(page: Page, name: string) {
  const add = page.getByRole('region', { name: 'Add registration type' });
  await add.getByLabel('Type name').fill(name);
  await add.getByRole('button', { name: 'Add registration type' }).click();
  await expect(add.getByText('Registration type added.')).toBeVisible();
  await expect(typeCard(page, name)).toBeVisible();
}

/** The public registration page up to the options. */
async function options(page: Page, email: string) {
  await page.goto(`/events/${slug}/register`);
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Show my options' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your registration' })).toBeVisible();
  return page.getByRole('form', { name: 'Registration' });
}

async function verify(page: Page, email: string) {
  const field = page.getByLabel('Verification code', { exact: true });
  await expect(field).toBeVisible();
  await field.fill(await lastEmailedCode(page, email));
  await page.getByRole('button', { name: /^Verify and continue/ }).click();
}

/** Apply for the Applicants type; lands on the applicant's own page. */
async function apply(page: Page, email: string, name: string) {
  const form = await options(page, email);
  const radio = form.getByRole('radio', { name: /^Applicants.*By application/ });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(form.getByText(/This registration type is by application/)).toBeVisible();
  await form.getByLabel('Full name').fill(name);
  await form.getByLabel('Company or organization (optional)').fill('Acme Research');
  await form.getByLabel('Anything the organizer should know? (optional)').fill(`Hello from ${name}.`);
  await form.getByRole('button', { name: 'Apply' }).click();
  await verify(page, email);
  await expect(page).toHaveURL(/\/registration\/[0-9a-f-]{36}~/);
}

/** The applicant's link from their newest decision email. */
async function decisionLink(page: Page, to: string, subject: RegExp): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        await drain(page);
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
        const mail = ((await res.json()) as { subject: string; html: string }[])
          .filter((m) => subject.test(m.subject))
          .at(-1);
        link = /href="(https?:\/\/[^"]+\/registration\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        return link;
      },
      { timeout: 30_000 },
    )
    .toMatch(/\/registration\/[0-9a-f-]{36}~/);
  return new URL(link.replace(/&amp;/g, '&')).pathname;
}

async function payOnFakePage(page: Page) {
  await expect(page).toHaveURL(/\/checkout\/fake/);
  await page.getByRole('button', { name: 'Pay now (test)' }).click();
}

test('the organizer makes a type by application with an auto-approve domain and a +1 guest type, by keyboard', async ({
  page,
}) => {
  test.setTimeout(240_000);
  s = stamp();
  await signIn(page);
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`Approvals ${s}`);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(40)}T09:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(42)}T18:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  base = new URL(page.url()).pathname;
  slug = base.split('/').pop() as string;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();

  await page.goto(`${base}/registration`);
  await page.getByRole('button', { name: 'Add standard types and items' }).click();
  await expect(typeCard(page, 'Member')).toBeVisible();
  await addType(page, 'Applicants');
  await addType(page, 'Plus one');
  await price(page, 'Member · Full pass', '120');
  await price(page, 'Applicants · Full pass', '80');
  await price(page, 'Plus one · Full pass', '0');

  // Applicants: by application, auto-approved at partner.test (a bad domain first).
  const rules = rulesCard(page, 'Applicants');
  await expect(rules).toContainText('Open registration');
  await rules.getByText('Admission rules for Applicants').click();
  await rules.getByLabel('Who gets in').selectOption('manual');
  await rules.getByLabel('Auto-approve email domains').fill('not a domain');
  await rules.getByRole('button', { name: 'Save rules' }).click();
  await expect(rules.getByText('Enter valid domains, such as partner.org.')).toBeVisible();
  const domains = rules.getByLabel('Auto-approve email domains');
  await domains.fill(`partner-${s}.test`);
  await domains.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(rules.getByRole('button', { name: 'Save rules' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rules.getByText('Saved.')).toBeVisible();
  // A member list by pasting addresses.
  await rules.getByLabel('Or paste addresses').fill(`email,name\nlisted-${s}@example.test,Listed`);
  await rules.getByRole('button', { name: 'Save member list for Applicants' }).click();
  await expect(rules.getByText('Member list saved.')).toBeVisible();

  // Plus one: a +1 guest type; it can't also be by application.
  const plus = rulesCard(page, 'Plus one');
  await plus.getByText('Admission rules for Plus one').click();
  await plus.getByLabel('Kind').selectOption('guest');
  await plus.getByLabel('Who gets in').selectOption('manual');
  await plus.getByRole('button', { name: 'Save rules' }).click();
  await expect(plus.getByText("A +1 guest type can't be by application.")).toBeVisible();
  await plus.getByLabel('Who gets in').selectOption('none');
  await plus.getByRole('button', { name: 'Save rules' }).click();
  await expect(plus.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(rulesCard(page, 'Applicants')).toContainText(`auto-approved domains: partner-${s}.test`);
  await expect(rulesCard(page, 'Applicants')).toContainText('1 on the member list');
  await expect(rulesCard(page, 'Plus one')).toContainText('+1 guest type: 1 guest per registrant');
  await expectAccessible(page);

  // The queue starts empty, and says what to do.
  await page.getByRole('link', { name: 'Open the applications' }).click();
  await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
  await expect(page.getByText('No applications waiting')).toBeVisible();
  await expectAccessible(page);
});

test('apply, get auto-approved by domain, pay, then bring a +1', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await guest(browser);
  const email = `ana-${s}@partner-${s}.test`;
  await apply(page, email, 'Ana Partner');
  await expect(page.getByRole('heading', { name: "You're approved", level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Pay and confirm' }).click();
  await payOnFakePage(page);
  await expect(page).toHaveURL(/\/registration\/[0-9a-f-]{36}~/);
  await expect
    .poll(
      async () => {
        await drain(page);
        await page.reload();
        return page.getByRole('heading', { level: 1 }).textContent();
      },
      { timeout: 30_000 },
    )
    .toBe("You're registered");
  // +1: the guest form, its validation, then the guest (free) is registered.
  const plus = page.getByRole('region', { name: 'Bring a guest' });
  await expect(plus.getByText('You can bring 1 more guest.')).toBeVisible();
  await plus.getByRole('button', { name: 'Add guest' }).click();
  await expect(plus.getByText('Enter a name.')).toBeVisible();
  await plus.getByLabel("Guest's full name").fill('Gil Guest');
  await plus.getByLabel("Guest's email").fill(email);
  await plus.getByRole('button', { name: 'Add guest' }).click();
  await expect(plus.getByText('Your guest needs their own email address.')).toBeVisible();
  await plus.getByLabel("Guest's email").fill(`gil-${s}@example.test`);
  await plus.getByRole('button', { name: 'Add guest' }).click();
  await expect(page.getByText('Gil Guest · Confirmed')).toBeVisible();
  await expect(page.getByText("You've added all the guests you can bring.")).toBeVisible();
  await expectAccessible(page);
  await page.close();
});

test('manual approval with a reason by keyboard; the applicant pays from the emailed link', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const applicant = await guest(browser);
  const email = `bo-${s}@example.test`;
  await apply(applicant, email, 'Bo Applicant');
  await expect(applicant.getByRole('heading', { name: 'Application received', level: 1 })).toBeVisible();
  await expect(applicant.getByRole('button', { name: 'Pay and confirm' })).toHaveCount(0);

  await signIn(page);
  await page.goto(`${base}/registration/applications`);
  const row = page.getByRole('link', { name: 'Bo Applicant' });
  await row.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('complementary', { name: 'Bo Applicant' });
  await expect(drawer).toContainText('Acme Research');
  await expect(drawer).toContainText('Hello from Bo Applicant.');
  await expectAccessible(page);
  const decision = drawer.getByLabel('Decision');
  await decision.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('See you at the opening keynote.');
  await drawer.getByRole('button', { name: 'Save decision' }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByText('Decision saved. The person will get an email.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Bo Applicant' })).toContainText('Approved');

  const link = await decisionLink(applicant, email, /^You're approved/);
  await applicant.goto(link);
  await expect(applicant.getByRole('heading', { name: "You're approved", level: 1 })).toBeVisible();
  await expect(applicant.getByText('See you at the opening keynote.')).toBeVisible();
  await applicant.getByRole('button', { name: 'Pay and confirm' }).click();
  await payOnFakePage(applicant);
  await expect
    .poll(
      async () => {
        await drain(applicant);
        await applicant.reload();
        return applicant.getByRole('heading', { level: 1 }).textContent();
      },
      { timeout: 30_000 },
    )
    .toBe("You're registered");
  await applicant.close();
});

test('bulk deny with a template reason: emailed, never charged', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const applicant = await guest(browser);
  const email = `cy-${s}@example.test`;
  await apply(applicant, email, 'Cy Applicant');

  await signIn(page);
  await page.goto(`${base}/registration/applications`);
  // A template first (its validation), then the bulk decision.
  const templates = page.getByRole('region', { name: 'Reason templates' });
  await templates.getByRole('button', { name: 'Add template' }).click();
  await expect(templates.getByText('Enter a name (up to 80 characters).')).toBeVisible();
  await templates.getByLabel('Name').fill('Full this year');
  await templates.getByLabel('Reason text').fill('We are at capacity this year. Thank you for applying.');
  await templates.getByRole('button', { name: 'Add template' }).click();
  await expect(templates.getByText('Template added.')).toBeVisible();
  await page.reload();
  // Nothing selected: refused with a message.
  const bulk = page.getByRole('form', { name: 'Bulk decision' });
  await bulk.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.getByText('Select at least one person, or choose everyone matching.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Cy Applicant' }).check();
  await page.getByLabel('Decision', { exact: true }).selectOption('deny');
  await page.locator('#bulk-template').selectOption({ label: 'Deny · Full this year' });
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.getByRole('region', { name: 'Bulk decision' }).getByRole('status')).toContainText(
    'Done: 1 decided, 0 not decided.',
  );
  await expectAccessible(page);

  const link = await decisionLink(applicant, email, /^Your application for/);
  await applicant.goto(link);
  await expect(applicant.getByRole('heading', { name: 'Application not approved', level: 1 })).toBeVisible();
  await expect(applicant.getByText('We are at capacity this year. Thank you for applying.')).toBeVisible();
  await expect(applicant.getByRole('button', { name: 'Pay and confirm' })).toHaveCount(0);
  await expect(applicant.getByText(/You haven't been charged/)).toBeVisible();
  await applicant.close();
});

test('group checkout with three names, then the payer replaces one', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await guest(browser);
  const payer = `payer-${s}@example.test`;
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('link', { name: 'Registering several people? Register a group' }).click();
  await expect(page.getByRole('heading', { name: 'Register a group', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '3 people' })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
  const form = page.getByRole('form', { name: 'Group registration' });
  await form.getByRole('button', { name: 'Register 3 people' }).click();
  await expect(form.getByText('Enter your name.')).toBeVisible();
  await expect(form.getByLabel('Your full name')).toBeFocused();
  await form.getByLabel('Your full name').fill('Pat Payer');
  await form.getByLabel('Your email').fill(payer);
  const names = ['Ada Group', 'Ben Group', 'Cal Group'];
  for (const [i, name] of names.entries()) {
    const person = form.getByRole('group', { name: `Person ${i + 1}` });
    await person.getByLabel('Full name').fill(name);
    await person.getByLabel('Email').fill(`${name.split(' ')[0]?.toLowerCase()}-${s}@example.test`);
    // The first pass offered: Member · Full pass (approval and +1 types are not sold as groups).
    await person.getByLabel('Pass').selectOption({ index: 1 });
  }
  await form.getByRole('button', { name: 'Register 3 people' }).click();
  await verify(page, payer);
  await payOnFakePage(page);
  await expect(page).toHaveURL(/\/group\/[0-9a-f-]{36}~/);
  await expect
    .poll(
      async () => {
        await drain(page);
        await page.reload();
        return page.getByText('Confirmed').count();
      },
      { timeout: 30_000 },
    )
    .toBe(3);
  await expectAccessible(page);
  // Replace Ben (validation first).
  const ben = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Ben Group' }) });
  await ben.getByText('Replace Ben Group').click();
  await ben.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(ben.getByText('Enter a name.')).toBeVisible();
  await ben.getByLabel("New person's full name").fill('Dee Group');
  await ben.getByLabel("New person's email").fill(`dee-${s}@example.test`);
  await ben.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(ben.getByText("Replaced. The new person's ticket is ready.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dee Group' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ben Group' })).toHaveCount(0);
  await page.close();
});

test('the viewer reads the queue; every decision is refused', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const applicant = await guest(browser);
  await apply(applicant, `dan-${s}@example.test`, 'Dan Applicant');
  await applicant.close();
  const viewer = await guest(browser);
  await signIn(viewer, VIEWER);
  await viewer.goto(`${base}/registration/applications`);
  await expect(viewer.getByText('You can view applications. Ask an admin to decide them.')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Dan Applicant' })).toBeVisible();
  await expect(viewer.getByRole('checkbox')).toHaveCount(0);
  await viewer.getByRole('link', { name: 'Dan Applicant' }).click();
  await expect(viewer.getByRole('complementary', { name: 'Dan Applicant' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Save decision' })).toHaveCount(0);
  await expectAccessible(viewer);
  await viewer.close();
  // The owner's open drawer, submitted as the viewer: refused by the server.
  await signIn(page);
  await page.goto(`${base}/registration/applications`);
  await page.getByRole('link', { name: 'Dan Applicant' }).click();
  const drawer = page.getByRole('complementary', { name: 'Dan Applicant' });
  await expect(drawer.getByRole('button', { name: 'Save decision' })).toBeVisible();
  await signIn(page, VIEWER);
  await drawer.getByRole('button', { name: 'Save decision' }).click();
  await expect(drawer.getByText("You don't have access to this.")).toBeVisible();
});

test('Arabic: the queue, the applicant page and the group form render right-to-left', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto(`/ar${base}/registration/applications?status=all`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page);
  const visitor = await guest(browser);
  await visitor.goto(`/ar/events/${slug}/register/group`);
  await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(visitor.locator('select[name="pass-1"]')).toBeVisible();
  await expectAccessible(visitor);
  // An applicant's page (from the queue's newest pending applicant's email is not needed: apply).
  await apply(visitor, `rtl-${s}@example.test`, 'Rtl Applicant');
  const path = new URL(visitor.url()).pathname;
  await visitor.goto(`/ar${path}`);
  await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(visitor);
  await visitor.close();
});
