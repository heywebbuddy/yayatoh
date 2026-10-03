import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type RsvpScenario, rsvpScenario } from '@yayatoh/testing';
import { expectAccessibleBothModes, passHumanCheck, signIn } from './helpers.ts';

// Batch 3h merge: axe runs in light and dark on every screen now (twice the checks), so these long
// journeys get more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

/**
 * M4.1f: the contact collector (guests send their household's names, address, email and phone;
 * nothing reaches the list until the host approves it into a new party or merges it field by
 * field; reject deletes it), invitations by email and text (wording per language, preview, test
 * send, bulk send, sent → viewed after the link is opened, a bounce shows on the party), deadline
 * reminders switched on, viewers who can't send, keyboard only, axe and the Arabic render.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

test.afterAll(async () => {
  await closePools();
});

interface Captured {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let orgId: string | null = null;
async function wedding(opts: { deadline?: Date | null } = {}): Promise<RsvpScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return rsvpScenario(orgId, opts);
}

const guests = (s: RsvpScenario) => `${ORG}/e/${s.eventSlug}/guests`;
const tag = () => `${test.info().project.name.split('-')[0]}${Date.now().toString(36)}`;

async function drain(page: Page) {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return res.json();
}

const guestPage = async (browser: Browser) => (await browser.newContext()).newPage();

/** Turns the collector on (as the signed-in host) and returns its public path. */
async function collectorOn(page: Page, s: RsvpScenario): Promise<string> {
  await page.goto(`${guests(s)}/collector`);
  await expect(page.getByTestId('collector-state')).toHaveText(/off/);
  await page.getByRole('button', { name: 'Turn on the collector' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The collector is on.' })).toBeVisible();
  const url = await page.getByRole('textbox', { name: 'Collector link' }).inputValue();
  expect(url).toMatch(/\/collect\/[0-9A-Z]{8}$/);
  return new URL(url).pathname;
}

async function fillPerson(page: Page, n: number, first: string, last: string) {
  const row = page.getByRole('group', { name: `Person ${n}`, exact: true });
  await row.getByLabel('First name').fill(first);
  await row.getByLabel('Last name (optional)').fill(last);
}

test.describe('Contact collector (M4.1f)', () => {
  test('a household sends its details: every error named, then the host approves it into a new party', async ({
    page,
    browser,
  }) => {
    const s = await wedding();
    await signIn(page);
    const path = await collectorOn(page, s);
    await expect(page.getByTestId('collector-qr')).toBeVisible();
    await expect(page.getByText('Nothing to review')).toBeVisible();
    await expectAccessibleBothModes(page);

    const guest = await guestPage(browser);
    await guest.goto(path);
    await expect(guest).toHaveTitle(/Share your contact details/);
    await expect(guest.getByRole('heading', { name: 'Share your contact details', level: 1 })).toBeVisible();
    await expect(guest.getByText(s.eventName).first()).toBeVisible();
    // The page never shows anyone on the list.
    await expect(guest.getByText('Luis')).toHaveCount(0);
    await expectAccessibleBothModes(guest);

    const send = guest.getByRole('button', { name: 'Send my details' });
    await send.click();
    await expect(guest.getByText("Enter your household's name.")).toBeVisible();
    await expect(guest.getByLabel('Household name')).toBeFocused();
    await expect(guest.getByLabel('Household name')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibleBothModes(guest);

    const household = `The Nguyens ${tag()}`;
    await guest.getByLabel('Household name').fill(household);
    await send.click();
    await expect(guest.getByText("Enter this person's first name.")).toBeVisible();
    await expect(guest.getByLabel('First name')).toBeFocused();

    await fillPerson(guest, 1, 'Linh', 'Nguyen');
    await guest.getByRole('button', { name: 'Add another person' }).click();
    await expect(
      guest.getByRole('group', { name: 'Person 2', exact: true }).getByLabel('First name'),
    ).toBeFocused();
    await fillPerson(guest, 2, 'Bao', 'Nguyen');
    await send.click();
    await expect(
      guest.getByRole('alert').filter({ hasText: 'Give at least one way to reach you' }),
    ).toBeVisible();
    // Values survive the refusal.
    await expect(guest.getByLabel('Household name')).toHaveValue(household);
    await expect(
      guest.getByRole('group', { name: 'Person 2', exact: true }).getByLabel('First name'),
    ).toHaveValue('Bao');

    await guest.getByLabel('Email').fill('not-an-email');
    await send.click();
    await expect(guest.getByText('Enter an email address like name@example.com.')).toBeVisible();
    await expect(guest.getByLabel('Email')).toBeFocused();
    await expectAccessibleBothModes(guest);

    const email = `linh-${tag()}@example.test`;
    await guest.getByLabel('Email').fill(email);
    await guest.getByLabel('Postal address').fill('1 River Road\nSpringfield');
    await guest.getByLabel('Mobile phone').fill('+1 312 555 0142');
    await send.click();
    await expect(
      guest.getByRole('status').filter({ hasText: 'Thank you! Your details were sent to the hosts.' }),
    ).toBeVisible();
    await expectAccessibleBothModes(guest);

    // Nothing reached the list yet.
    await page.goto(guests(s));
    await expect(page.getByRole('region', { name: household, exact: true })).toHaveCount(0);

    await page.goto(`${guests(s)}/collector`);
    await expect(page.getByRole('heading', { name: 'Waiting for you (1)' })).toBeVisible();
    const card = page.getByRole('article', { name: household });
    await expect(card.getByText('Linh Nguyen, Bao Nguyen')).toBeVisible();
    await expect(card.getByText(email)).toBeVisible();
    await expect(card.getByText('+13125550142')).toBeVisible();
    await expectAccessibleBothModes(page);
    await card.getByRole('button', { name: `Approve ${household} as a new party` }).click();
    await expect(
      page.getByTestId('collector-done').getByText(`Approved: ${household} is now on your guest list.`),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for you' })).toBeVisible();
    await expect(page.getByText('Approved', { exact: true })).toBeVisible();
    await expectAccessibleBothModes(page);

    // The new party, with its people, contact details sealed on its primary guest, and history.
    await page.getByRole('link', { name: `Open ${household}` }).click();
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(email);
    await expect(page.getByRole('textbox', { name: 'Mobile phone' })).toHaveValue('+13125550142');
    await page.goto(guests(s));
    const party = page.getByRole('region', { name: household, exact: true });
    await expect(party.getByText('Linh Nguyen', { exact: true })).toBeVisible();
    await expect(party.getByText('Bao Nguyen', { exact: true })).toBeVisible();
  });

  test('merge field by field into an existing party; reject deletes a submission', async ({
    page,
    browser,
  }) => {
    const s = await wedding();
    await signIn(page);
    const path = await collectorOn(page, s);
    const guest = await guestPage(browser);
    const sendOne = async (
      household: string,
      first: string,
      last: string,
      email: string,
      address: string,
    ) => {
      await guest.goto(path);
      await guest.getByLabel('Household name').fill(household);
      await fillPerson(guest, 1, first, last);
      await guest.getByLabel('Email').fill(email);
      await guest.getByLabel('Postal address').fill(address);
      await guest.getByRole('button', { name: 'Send my details' }).click();
      await expect(guest.getByRole('status').filter({ hasText: 'Thank you!' })).toBeVisible();
    };
    const email = `garcia-${tag()}@example.test`;
    await sendOne('Garcia family', 'Sofía', 'García', email, '9 Elm Street');
    await sendOne('Spammy', 'Buy', 'Now', `spam-${tag()}@example.test`, 'Nowhere');

    await page.goto(`${guests(s)}/collector`);
    await expect(page.getByRole('heading', { name: 'Waiting for you (2)' })).toBeVisible();
    const card = page.getByRole('article', { name: 'Garcia family' });
    await card.getByLabel('Merge into party').selectOption({ label: 'Garcia' });
    await card.getByRole('button', { name: 'Compare and merge Garcia family' }).click();
    await expect(page.getByRole('heading', { name: 'Merge Garcia family', level: 1 })).toBeVisible();
    const table = page.getByRole('table', { name: 'The party Garcia next to the submission' });
    await expect(table.getByRole('row', { name: /Email/ })).toContainText(email);
    await expectAccessibleBothModes(page);
    // The party has no address or email: the submitted ones are offered; Sofía is new.
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('use');
    await page.getByLabel('Address', { exact: true }).selectOption('keep');
    await expect(page.getByRole('checkbox', { name: 'Sofía García' })).toBeChecked();
    await page.getByRole('button', { name: 'Merge into Garcia' }).click();
    await expect(page.getByTestId('collector-done').getByText('Merged into Garcia.')).toBeVisible();

    await page.goto(guests(s));
    const garcia = page.getByRole('region', { name: 'Garcia', exact: true });
    await expect(garcia.getByText('Sofía García', { exact: true })).toBeVisible();
    await expect(garcia.getByText('9 Elm Street')).toHaveCount(0);
    await page.goto(`${guests(s)}/rsvp/${s.garcia.id}`);
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(email);

    await page.goto(`${guests(s)}/collector`);
    await page
      .getByRole('article', { name: 'Spammy' })
      .getByRole('button', { name: 'Reject Spammy' })
      .click();
    await expect(
      page.getByTestId('collector-done').getByText('Rejected. What they sent was deleted.'),
    ).toBeVisible();
    await expect(page.getByText('Nothing to review')).toBeVisible();
    await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
    await expect(page.getByText('Merged', { exact: true })).toBeVisible();
  });

  test('keyboard only: a guest fills and sends the form; the host turns the collector off', async ({
    page,
    browser,
  }) => {
    const s = await wedding();
    await signIn(page);
    const path = await collectorOn(page, s);
    const guest = await guestPage(browser);
    await guest.goto(path);
    await guest.getByLabel('Household name').focus();
    await guest.keyboard.type('Keyboard household');
    await guest.keyboard.press('Tab');
    await guest.keyboard.type('Kim');
    await guest.keyboard.press('Tab');
    await guest.keyboard.type('Lee');
    await guest.keyboard.press('Tab');
    await expect(guest.getByRole('button', { name: 'Add another person' })).toBeFocused();
    await guest.keyboard.press('Enter');
    await expect(
      guest.getByRole('group', { name: 'Person 2', exact: true }).getByLabel('First name'),
    ).toBeFocused();
    await guest.keyboard.type('Min');
    // Remove person 2 again with the keyboard.
    await guest.getByRole('button', { name: 'Remove person 2' }).focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('group', { name: 'Person 2', exact: true })).toHaveCount(0);
    await guest.getByLabel('Email').focus();
    await guest.keyboard.type(`kim-${tag()}@example.test`);
    await guest.getByRole('button', { name: 'Send my details' }).focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('status').filter({ hasText: 'Thank you!' })).toBeVisible();

    await page.goto(`${guests(s)}/collector`);
    await page.getByRole('button', { name: 'Turn off the collector' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'The collector is off.' })).toBeVisible();
    // Off: the address shows nothing.
    const res = await guest.goto(path);
    expect(res?.status()).toBe(404);
  });

  test('past the device budget a submission needs the human check', async ({ page, browser }) => {
    const s = await wedding();
    await signIn(page);
    const path = await collectorOn(page, s);
    const guest = await guestPage(browser);
    let challenged = false;
    for (let i = 0; i < 8 && !challenged; i++) {
      await guest.goto(path);
      await guest.getByLabel('Household name').fill(`Flood ${i}`);
      await fillPerson(guest, 1, 'Flo', `Od${i}`);
      await guest.getByLabel('Email').fill(`flood${i}-${tag()}@example.test`);
      await guest.getByRole('button', { name: 'Send my details' }).click();
      const done = guest.getByRole('status').filter({ hasText: 'Thank you!' });
      const check = guest.getByRole('group', { name: 'One more step' });
      await expect(done.or(check)).toBeVisible();
      challenged = await check.isVisible();
    }
    expect(challenged).toBe(true);
    // What was typed stays; the check lets it through.
    await expect(guest.getByLabel('Household name')).toHaveValue(/^Flood /);
    await expectAccessibleBothModes(guest);
    await passHumanCheck(guest);
    await guest.getByRole('button', { name: 'Send my details' }).click();
    await expect(guest.getByRole('status').filter({ hasText: 'Thank you!' })).toBeVisible();
  });

  test('Arabic renders right to left; an unknown code is not found', async ({ page, browser }) => {
    const s = await wedding();
    await signIn(page);
    const path = await collectorOn(page, s);
    const guest = await guestPage(browser);
    await guest.goto(`/ar${path}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'شارك بيانات التواصل', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(guest);
    await guest.getByRole('button', { name: 'إرسال بياناتي' }).click();
    await expect(guest.getByText('أدخل اسم أسرتك.')).toBeVisible();
    await page.goto(`/ar${guests(s)}/collector`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessibleBothModes(page);
    const res = await guest.goto('/collect/ZZZZZZZZ');
    expect(res?.status()).toBe(404);
  });
});

test.describe('Invitations (M4.1f)', () => {
  test('wording per language with preview and test send; send by email and text; viewed after the link; a bounce shows', async ({
    page,
    browser,
  }) => {
    const s = await wedding();
    const t = tag();
    const garciaEmail = `garcia-${t}@example.test`;
    const bounce = `bounce+${t}@example.test`;
    await signIn(page);

    // Contact details on each party's page (sealed on its primary guest).
    await page.goto(`${guests(s)}/rsvp/${s.garcia.id}`);
    await expect(page.getByRole('heading', { name: 'Invitation', exact: true })).toBeVisible();
    await expect(page.getByText('Add an email or a mobile phone to send the invitation.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Email' }).fill('nope');
    await page.getByRole('button', { name: 'Save contact details' }).click();
    await expect(page.getByText('Enter an email address like name@example.com.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Email' }).fill(garciaEmail);
    await page.getByRole('textbox', { name: 'Mobile phone' }).fill('312 555 0101');
    await page.getByRole('button', { name: 'Save contact details' }).click();
    await expect(page.getByText('Enter a mobile number with its country code')).toBeVisible();
    await page.getByRole('textbox', { name: 'Mobile phone' }).fill('+1 312 555 0101');
    await page.getByRole('button', { name: 'Save contact details' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contact details saved.' })).toBeVisible();
    await page.getByLabel('Invitation language').selectOption('es');
    await page.getByRole('button', { name: 'Save the language' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Language saved.' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`${guests(s)}/rsvp/${s.chen.id}`);
    await page.getByRole('textbox', { name: 'Email' }).fill(bounce);
    await page.getByRole('button', { name: 'Save contact details' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contact details saved.' })).toBeVisible();

    // The invitations page: wording, preview, test.
    await page.goto(guests(s));
    await page.getByRole('link', { name: 'Invitations: send by email and text' }).click();
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
    await expect(page.getByTestId('invite-not-sent')).toHaveText(
      "2 parties haven't been sent their invitation.",
    );
    await expect(page.getByTestId('preview-subject')).toHaveText(`You're invited: ${s.eventName}`);
    await expectAccessibleBothModes(page);
    await page.locator('#invite-lang').selectOption('es');
    await page.getByRole('button', { name: 'Show this language' }).click();
    await expect(page.getByTestId('preview-subject')).toHaveText(`Estás invitado: ${s.eventName}`);
    await page.getByLabel('Email subject').fill('');
    await page.getByRole('button', { name: 'Save the wording' }).click();
    await expect(page.getByText('Write a subject of up to 150 characters.')).toBeVisible();
    await page.getByLabel('Email subject').fill('¡Nos casamos! {event}');
    await page.getByRole('button', { name: 'Save the wording' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Wording saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('preview-subject')).toHaveText(`¡Nos casamos! ${s.eventName}`);
    await page.getByRole('button', { name: 'Send a test email to me' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Test sent to your email address.' }),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    // Send to everyone not sent yet, by email and text.
    await page.getByRole('group', { name: 'Send by' }).first().getByLabel('Text message').check();
    await page.getByRole('button', { name: 'Send to 2 parties' }).click();
    await expect(page.getByTestId('invite-sent-result')).toHaveText('Invitations sent to 2 parties.');
    await expect(page.getByTestId('invite-not-sent')).toHaveText('Every party was sent its invitation.');
    await expect(page.getByTestId(`invite-state-${s.garcia.id}`)).toHaveText('Sent');
    await expect(page.getByTestId(`invite-state-${s.chen.id}`)).toHaveText('Sent');
    await drain(page);

    let link = '';
    await expect
      .poll(async () => {
        const mail = (await mailbox(page, garciaEmail)).find(
          (m) => m.subject === `¡Nos casamos! ${s.eventName}`,
        );
        link = /href="(https?:\/\/[^"]+\/rsvp\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        return link;
      })
      .toContain('/rsvp/');
    expect(decodeURIComponent(new URL(link).pathname)).toBe(`/rsvp/${s.garcia.token}`);
    const texts = await mailbox(page, '+13125550101');
    expect(texts.some((m) => m.text.includes('/rsvp/'))).toBe(true);

    // The guest opens the link: viewed.
    const guest = await guestPage(browser);
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole('heading', { name: 'RSVP for The Garcia family', level: 1 })).toBeVisible();
    await drain(page);
    await page.reload();
    await expect(page.getByTestId(`invite-state-${s.garcia.id}`)).toHaveText('Viewed');
    // The bounce reached the party.
    await expect(page.getByTestId(`invite-party-${s.chen.id}`).getByText('Delivery problem')).toBeVisible();
    await expect(page.getByTestId(`invite-party-${s.chen.id}`).getByTestId('delivery-email')).toHaveText(
      'Email: Bounced',
    );
    await expect(page.getByTestId('invite-problems')).toHaveText(
      '1 party has a message that bounced or failed.',
    );
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'Open Chen' }).click();
    await expect(page.getByTestId('party-invite-problem')).toBeVisible();
    await expect(page.getByTestId('party-messages')).toContainText('Email: Bounced');
    await expectAccessibleBothModes(page);

    // Send again to one party.
    await page.goto(`${guests(s)}/rsvp/${s.garcia.id}`);
    await page.getByRole('button', { name: 'Send the invitation to Garcia again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation on its way.' })).toBeVisible();
  });

  test('deadline reminders: need a deadline, validate the days, switch on and off', async ({ page }) => {
    const deadline = new Date(Date.now() + 30 * 86_400_000);
    const s = await wedding({ deadline });
    const bare = await wedding();
    await signIn(page);
    await page.goto(`${guests(bare)}/invitations`);
    await expect(page.getByText('Set an RSVP deadline to use reminders.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save reminders' })).toHaveCount(0);

    await page.goto(`${guests(s)}/invitations`);
    await expect(page.getByTestId('reminders-state')).toHaveText('Off.');
    await page.getByLabel('Reminders', { exact: true }).selectOption({ label: 'On' });
    await page.getByLabel('Days before the deadline').fill('0, 200');
    await page.getByRole('button', { name: 'Save reminders' }).click();
    await expect(
      page.getByText('Enter up to five numbers of days from 1 to 90, for example 14, 3.'),
    ).toBeVisible();
    await expect(page.getByLabel('Days before the deadline')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Days before the deadline').fill('3, 14');
    await page.getByRole('button', { name: 'Save reminders' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Reminders saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('reminders-state')).toHaveText(
      'On: 14, 3 days before the deadline, by Email.',
    );
    await expect(page.getByLabel('Days before the deadline')).toHaveValue('14, 3');
    await expectAccessibleBothModes(page);
    await page.getByLabel('Reminders', { exact: true }).selectOption({ label: 'Off' });
    await page.getByRole('button', { name: 'Save reminders' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Reminders saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('reminders-state')).toHaveText('Off.');
  });

  test('viewers see invitations and the queue but cannot send, edit or decide; Arabic renders', async ({
    page,
  }) => {
    const s = await wedding();
    await signIn(page, VIEWER);
    await page.goto(`${guests(s)}/invitations`);
    await expect(page.getByText('You can see the invitations.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send to/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save the wording' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send a test email to me' })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    await page.goto(`${guests(s)}/rsvp/${s.garcia.id}`);
    await expect(page.getByRole('heading', { name: 'Invitation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Send the invitation/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save contact details' })).toHaveCount(0);
    await page.goto(`${guests(s)}/collector`);
    await expect(page.getByText('You can read the queue.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on the collector' })).toHaveCount(0);
    // The merge page is for hosts who edit guests.
    const res = await page.goto(
      `${guests(s)}/collector/00000000-0000-4000-8000-000000000000?party=${s.garcia.id}`,
    );
    expect(res?.status()).toBe(404);

    await page.goto(`/ar${guests(s)}/invitations`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الدعوات', level: 1 })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
