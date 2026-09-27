import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';

/** A wall-clock time in Chicago, `offsetMin` minutes from now (datetime-local format). */
function chicago(offsetMin: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetMin * 60_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Create an event through the UI (optionally published); returns its console path and slug. */
async function createEvent(
  page: Page,
  name: string,
  opts: { startMin?: number; lengthMin?: number; publish?: boolean } = {},
) {
  const start = opts.startMin ?? 60 * 24 * 30;
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name').fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts').fill(chicago(start));
  await page.getByLabel('Ends').fill(chicago(start + (opts.lengthMin ?? 180)));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  if (opts.publish !== false) {
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
  }
  return { base, slug: base.split('/').pop() ?? '' };
}

async function addPass(page: Page, base: string, name: string, opts: { hidden?: boolean } = {}) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('20');
  if (opts.hidden) await page.getByLabel(/^Hidden pass/).check();
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

/** A guest buys one free pass on the public page; returns their order page. */
async function buyFree(guest: Page, slug: string, pass: string, who: string) {
  if (!guest.url().includes(`/events/${slug}`)) await guest.goto(`/events/${slug}`);
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
  await guest.getByLabel('Full name').fill(who);
  await guest
    .getByLabel('Email for your tickets')
    .fill(`${who.replace(/\W+/g, '.').toLowerCase()}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/orders\//);
}

async function guestPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

/** HTML5 drag and drop via dispatched events (deterministic in every project). */
async function dragOnto(page: Page, source: Locator, target: Locator) {
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: dt });
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await source.dispatchEvent('dragend', { dataTransfer: dt });
}

test.describe('page content, announcements and access (M1.4d)', () => {
  test('sections: add with validation, reorder by keyboard and by drag, FAQ and sanitized text render publicly', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Content Fair ${s}`);
    await page.goto(`${base}/content`);
    await expect(page.getByRole('heading', { name: 'Page content', level: 1 })).toBeVisible();
    await expect(page.getByText('No sections yet')).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);
    const add = page.getByRole('region', { name: 'Add a section' });

    // Text with markup that must stay inert.
    await add.getByLabel('Section title').fill('About');
    await add.getByLabel('Text', { exact: true }).fill('Welcome **friends** <script>alert(1)</script>');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Section added.')).toBeVisible();
    const sectionRows = page
      .getByRole('list', { name: 'Sections in page order' })
      .locator('li[data-section-id]');
    await expect(sectionRows).toHaveCount(1);

    // A schedule with a bad time: the error names the line; the typed text is kept.
    await add.getByLabel('Section type').selectOption('schedule');
    await add.getByLabel('Section title').fill('Programme');
    await add.getByLabel('Schedule', { exact: true }).fill('18:00 | Doors\n25:00 | Too late');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Line 2: use a time between 00:00 and 23:59.')).toBeVisible();
    await expect(add.getByLabel('Schedule', { exact: true })).toHaveValue('18:00 | Doors\n25:00 | Too late');
    await expectAccessible(page);
    await add.getByLabel('Schedule', { exact: true }).fill('18:00 | Doors\n19:30 | Keynote | Main hall');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Section added.')).toBeVisible();
    await expect(sectionRows).toHaveCount(2);

    // FAQ: an answer is required.
    await add.getByLabel('Section type').selectOption('faq');
    await add.getByLabel('Section title').fill('FAQ');
    await add.getByLabel('Questions and answers').fill('Is there parking?');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(
      add.getByText('Question 1 has no answer: add the answer on the lines below it.'),
    ).toBeVisible();
    await add
      .getByLabel('Questions and answers')
      .fill('Is there parking?\nYes, in lot B.\n\nCan kids come?\nYes!');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Section added.')).toBeVisible();

    const list = page.getByRole('list', { name: 'Sections in page order' });
    const row = (title: string) => list.locator('li[data-section-id]').filter({ hasText: title });
    await expect(list.locator('li[data-section-id]')).toHaveCount(3);

    // Keyboard: move FAQ up twice with Enter; the move is announced and focus stays on the row.
    await page.getByRole('button', { name: 'Move FAQ up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('FAQ moved to position 2 of 3.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move FAQ up' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('FAQ moved to position 1 of 3.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move FAQ down' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Move FAQ up' })).toBeDisabled();

    // Drag: About onto FAQ (above it) moves About to the top.
    await dragOnto(page, row('About'), row('FAQ'));
    await expect(page.getByText('About moved to position 1 of 3.')).toBeVisible();
    await page.reload();
    await expect(list.locator('li[data-section-id]').nth(0)).toContainText('About');
    await expect(list.locator('li[data-section-id]').nth(1)).toContainText('FAQ');
    await expect(list.locator('li[data-section-id]').nth(2)).toContainText('Programme');
    await expectAccessible(page);

    // Hide the programme via its edit form.
    await row('Programme').getByText('Edit Programme').click();
    await row('Programme').getByLabel('Show on the event page').uncheck();
    await row('Programme').getByRole('button', { name: 'Save section' }).click();
    await expect(row('Programme')).toContainText('Hidden');

    // Public page: sections in order, FAQ answers behind their questions, markup inert.
    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const about = guest.getByRole('region', { name: 'About' });
    await expect(about.locator('strong')).toHaveText('friends');
    await expect(about).toContainText('<script>alert(1)</script>');
    expect(
      await guest.evaluate(() => (window as unknown as { alertCalled?: boolean }).alertCalled),
    ).toBeUndefined();
    const faq = guest.getByRole('region', { name: 'FAQ' });
    await expect(faq.getByText('Yes, in lot B.')).toBeHidden();
    await faq.getByText('Is there parking?').click();
    await expect(faq.getByText('Yes, in lot B.')).toBeVisible();
    await expect(guest.getByRole('region', { name: 'Programme' })).toHaveCount(0);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
  });

  test('announcements: publish, pin, unpublish; holders-only never on the public page', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `News Night ${s}`);
    await addPass(page, base, 'Entry');
    await page.goto(`${base}/content`);
    await expect(page.getByText('No announcements yet')).toBeVisible();
    const form = page.getByRole('region', { name: 'New announcement' });

    // Validation: an empty message.
    await form.getByLabel('Title').fill('Doors at six');
    await form.getByRole('button', { name: 'Save announcement' }).click();
    await expect(form.getByText('Write a message.')).toBeVisible();
    await form.getByLabel('Message').fill('Come early for **free** coffee.');
    await form.getByLabel('Pin to the top').check();
    await form.getByRole('button', { name: 'Save announcement' }).click();
    await expect(form.getByText('Announcement saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Doors at six', level: 3 })).toBeVisible();

    await form.getByLabel('Title').fill('Backstage entrance');
    await form.getByLabel('Message').fill('Holders use the side door.');
    await form.getByLabel('Ticket holders only').check();
    await form.getByRole('button', { name: 'Save announcement' }).click();
    await expect(page.getByRole('heading', { name: 'Backstage entrance', level: 3 })).toBeVisible();
    await expect(form.getByLabel('Title')).toHaveValue('');

    await form.getByLabel('Title').fill('Draft note');
    await form.getByLabel('Message').fill('Not ready yet.');
    await form.getByLabel('Publish now').uncheck();
    await form.getByRole('button', { name: 'Save announcement' }).click();
    await expect(page.getByRole('heading', { name: 'Draft note', level: 3 })).toBeVisible();
    await expectAccessible(page);

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const news = guest.getByRole('region', { name: 'Announcements' });
    await expect(news.getByRole('heading', { name: 'Doors at six' })).toBeVisible();
    await expect(news.getByText('Pinned')).toBeVisible();
    await expect(news.locator('strong')).toHaveText('free');
    await expect(guest.getByText('Backstage entrance')).toHaveCount(0);
    await expect(guest.getByText('Draft note')).toHaveCount(0);
    await expectAccessible(guest);

    // A ticket holder sees the holders-only one on their order page.
    await buyFree(guest, slug, 'Entry', `Hana ${s}`);
    await expect(guest.getByRole('heading', { name: 'Backstage entrance' })).toBeVisible();
    await expect(guest.getByText('Ticket holders only')).toBeVisible();
    await expectAccessible(guest);

    // Unpublish: gone from the public page after a reload; publish the draft.
    await page.getByRole('button', { name: 'Unpublish Doors at six' }).click();
    await expect(page.getByRole('button', { name: 'Publish Doors at six' })).toBeVisible();
    await page.getByRole('button', { name: 'Publish Draft note' }).click();
    await expect(page.getByRole('button', { name: 'Unpublish Draft note' })).toBeVisible();
    const again = await guestPage(browser);
    await again.goto(`/events/${slug}`);
    await expect(again.getByText('Doors at six')).toHaveCount(0);
    await expect(again.getByRole('heading', { name: 'Draft note' })).toBeVisible();
  });

  test('private info and the online join link: never public; holders see them, the link only near the start', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const canary = `WIFI-CANARY-${s}`;
    const joinUrl = `https://meet.example.com/room-${s}`;
    await signIn(page);
    // Starts in 10 minutes: inside the 30-minute join window.
    const { base, slug } = await createEvent(page, `Live Stream ${s}`, { startMin: 10, lengthMin: 120 });
    await addPass(page, base, 'Stream pass');
    await page.goto(`${base}/details`);
    await page.getByLabel('Online', { exact: true }).check();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();

    await page.goto(`${base}/access`);
    await expect(page.getByRole('heading', { name: 'Access', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page
      .getByLabel('Information for ticket holders')
      .fill(`## Wi-Fi\nNetwork **Lakeside**, password ${canary}`);
    await page.getByLabel('Online join link').fill('http://insecure.example.com');
    await page.getByRole('button', { name: 'Save private information' }).click();
    await expect(page.getByText('Use a link that starts with https://.')).toBeVisible();
    await expect(page.getByLabel('Information for ticket holders')).toHaveValue(
      `## Wi-Fi\nNetwork **Lakeside**, password ${canary}`,
    );
    await expectAccessible(page);
    await page.getByLabel('Online join link').fill(joinUrl);
    await page.getByRole('button', { name: 'Save private information' }).click();
    await expect(page.getByText('Private information saved.')).toBeVisible();

    // Public HTML (including JSON-LD and meta tags) never carries the private info or join link.
    const raw = await (await page.request.get(`/events/${slug}`)).text();
    expect(raw).not.toContain(canary);
    expect(raw).not.toContain(joinUrl);
    expect(raw).toContain('https://schema.org/OnlineEventAttendanceMode');
    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const ld = await guest.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(ld ?? '{}')).toMatchObject({ '@type': 'Event', name: `Live Stream ${s}` });
    await expect(
      guest.getByRole('list', { name: 'About this event' }).getByText('Online event'),
    ).toBeVisible();
    expect(await guest.content()).not.toContain(canary);
    const og = await guest.locator('meta[property="og:title"]').getAttribute('content');
    expect(og).toBe(`Live Stream ${s}`);

    // A holder verified by their order link sees both.
    await buyFree(guest, slug, 'Stream pass', `Omari ${s}`);
    const info = guest.getByRole('region', { name: 'Information for ticket holders' });
    await expect(info.getByRole('heading', { name: 'Wi-Fi' })).toBeVisible();
    await expect(info).toContainText(canary);
    const join = guest.getByRole('link', { name: 'Join the event' });
    await expect(join).toHaveAttribute('href', joinUrl);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);

    // An event starting in two days: the holder is told when the link appears, not the link.
    const later = await createEvent(page, `Later Stream ${s}`, { startMin: 60 * 48 });
    await addPass(page, later.base, 'Later pass');
    await page.goto(`${later.base}/details`);
    await page.getByLabel('Hybrid', { exact: true }).check();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.goto(`${later.base}/access`);
    await page.getByLabel('Online join link').fill(joinUrl);
    await page.getByRole('button', { name: 'Save private information' }).click();
    await expect(page.getByText('Private information saved.')).toBeVisible();
    const early = await guestPage(browser);
    await buyFree(early, later.slug, 'Later pass', `Early ${s}`);
    await expect(early.getByText(/The join link appears here at/)).toBeVisible();
    await expect(early.getByRole('link', { name: 'Join the event' })).toHaveCount(0);
    expect(await early.content()).not.toContain(joinUrl);
  });

  test('access codes: a code unlocks a hidden pass; wrong and used-up codes fail; attempts are limited', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    const code = `FRIENDS${s}`.slice(0, 32);
    await signIn(page);
    const { base, slug } = await createEvent(page, `Friends Gig ${s}`);
    await addPass(page, base, 'General');
    await addPass(page, base, 'Friends pass', { hidden: true });
    await expect(page.getByRole('row').filter({ hasText: 'Friends pass' })).toContainText('Hidden');

    await page.goto(`${base}/access`);
    const codes = page.getByRole('region', { name: 'Access codes' });
    await expect(codes.getByText('No access codes yet')).toBeVisible();
    // Nothing chosen to unlock: refused with a message on the choices.
    await codes.getByLabel('Code', { exact: true }).fill(code.toLowerCase());
    await codes.getByRole('button', { name: 'Create code' }).click();
    await expect(codes.getByText('Choose what the code unlocks.')).toBeVisible();
    await codes.getByLabel('Hidden pass: Friends pass').check();
    await codes.getByLabel('Maximum uses').fill('1');
    await codes.getByRole('button', { name: 'Create code' }).click();
    await expect(codes.getByText('Access code created.')).toBeVisible();
    const row = codes.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('Friends pass');
    await expect(row).toContainText('0 / 1');
    await expectAccessible(page);

    // The same code again: taken.
    await codes.getByLabel('Code', { exact: true }).fill(code);
    await codes.getByLabel('Hidden pass: Friends pass').check();
    await codes.getByRole('button', { name: 'Create code' }).click();
    await expect(codes.getByText('This event already has that code.')).toBeVisible();

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByLabel('Quantity — General')).toBeVisible();
    await expect(guest.getByLabel('Quantity — Friends pass')).toHaveCount(0);
    await guest.getByRole('textbox', { name: 'Access code' }).fill('NOT-A-CODE');
    await guest.getByRole('button', { name: 'Apply code' }).click();
    await expect(guest.getByText("That code isn't valid for this event, or it has expired.")).toBeVisible();
    await expectAccessible(guest);
    // Case-insensitive; the hidden pass appears.
    await guest.getByRole('textbox', { name: 'Access code' }).fill(code.toLowerCase());
    await guest.getByRole('button', { name: 'Apply code' }).click();
    await expect(guest.getByText('Your access code is applied.')).toBeVisible();
    await expect(guest.getByLabel('Quantity — Friends pass')).toBeVisible();
    await expectAccessible(guest);
    await buyFree(guest, slug, 'Friends pass', `Friend ${s}`);
    await expect(guest.getByText('1 × Friends pass')).toBeVisible();

    // One use only: the next visitor is refused with the same message.
    const late = await guestPage(browser);
    await late.goto(`/events/${slug}`);
    await late.getByRole('textbox', { name: 'Access code' }).fill(code);
    await late.getByRole('button', { name: 'Apply code' }).click();
    await expect(late.getByText("That code isn't valid for this event, or it has expired.")).toBeVisible();
    await expect(late.getByLabel('Quantity — Friends pass')).toHaveCount(0);
    await page.reload();
    await expect(codes.getByRole('row').filter({ hasText: code })).toContainText('Used up');

    // Guessing: after 10 failures this device is told to wait, even with a valid code.
    const prober = await guestPage(browser);
    await prober.goto(`/events/${slug}`);
    for (let i = 0; i < 10; i++) {
      await prober.getByRole('textbox', { name: 'Access code' }).fill(`GUESS${i}X`);
      await prober.getByRole('button', { name: 'Apply code' }).click();
      await expect(
        prober.getByText("That code isn't valid for this event, or it has expired."),
      ).toBeVisible();
    }
    await prober.getByRole('textbox', { name: 'Access code' }).fill('ANOTHER-GUESS');
    await prober.getByRole('button', { name: 'Apply code' }).click();
    await expect(prober.getByText('Too many attempts. Please wait 15 minutes and try again.')).toBeVisible();
    await expectAccessible(prober);
  });

  test('a private event shows only a code gate until a code opens it', async ({ page, browser }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Secret Supper ${s}`);
    await addPass(page, base, 'Seat');
    await page.goto(`${base}/details`);
    await page.getByLabel('Private (access code)').check();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved.')).toBeVisible();
    await page.goto(`${base}/access`);
    const codes = page.getByRole('region', { name: 'Access codes' });
    await expect(codes.getByLabel('The event page (for a private event)')).toBeChecked();
    await codes.getByLabel('Label').fill('Invitations');
    await codes.getByRole('button', { name: 'Create code' }).click();
    await expect(codes.getByText('Access code created.')).toBeVisible();
    const generated =
      (
        await codes
          .getByRole('row')
          .filter({ hasText: 'Invitations' })
          .getByRole('cell')
          .first()
          .textContent()
      )?.trim() ?? '';
    expect(generated).toMatch(/^[A-Z0-9]{8}$/);

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByRole('heading', { name: 'This event is private', level: 1 })).toBeVisible();
    await expect(guest.getByText(`Secret Supper ${s}`)).toHaveCount(0);
    expect(await guest.content()).not.toContain(`Secret Supper ${s}`);
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
    await guest.getByRole('textbox', { name: 'Access code' }).fill('WRONG123');
    await guest.getByRole('button', { name: 'Apply code' }).click();
    await expect(guest.getByText("That code isn't valid for this event, or it has expired.")).toBeVisible();
    await guest.getByRole('textbox', { name: 'Access code' }).fill(generated.toLowerCase());
    await guest.getByRole('button', { name: 'Apply code' }).click();
    await expect(guest.getByRole('heading', { name: `Secret Supper ${s}`, level: 1 })).toBeVisible();
    await expect(guest.getByText('Your access code is applied.')).toBeVisible();
    // No JSON-LD or search indexing for a private event.
    await expect(guest.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await buyFree(guest, slug, 'Seat', `Invitee ${s}`);
    await expectAccessible(guest);
  });

  test('short links: 308 to the event, vanity validation, case-insensitive, drafts do not resolve', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Short Link ${s}`, { publish: false });
    await page.goto(`${base}/details`);
    await expect(page.getByText('Short links start working once the event is published.')).toBeVisible();
    const auto = (await page.getByTestId('short-link-auto').textContent())?.trim() ?? '';
    const code = auto.split('/e/')[1] ?? '';
    expect(code).toMatch(/^[a-z2-9]{7}$/);
    expect((await page.request.get(`/e/${code}`, { maxRedirects: 0 })).status()).toBe(404);

    await page.goto(base);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    const res = await page.request.get(`/e/${code.toUpperCase()}`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toBe(`/events/${slug}`);

    await page.goto(`${base}/details`);
    const vanity = page.getByLabel('Custom short link');
    for (const [bad, message] of [
      ['ab', 'Use at least 3 characters.'],
      ['admin', 'That word is reserved. Choose another.'],
      [
        'no--double',
        'Use only letters, numbers and single hyphens, starting and ending with a letter or number.',
      ],
    ] as const) {
      await vanity.fill(bad);
      await page.getByRole('button', { name: 'Save custom link' }).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(vanity).toHaveAttribute('aria-invalid', 'true');
    }
    await expectAccessible(page);
    const mine = `Short-${s}`;
    await vanity.fill(mine);
    await page.getByRole('button', { name: 'Save custom link' }).click();
    await expect(page.getByText('Custom link saved.')).toBeVisible();
    await expect(page.getByTestId('short-link-vanity')).toContainText(`/e/${mine.toLowerCase()}`);
    const v = await page.request.get(`/e/${mine.toUpperCase()}`, { maxRedirects: 0 });
    expect(v.status()).toBe(308);
    expect(v.headers().location).toBe(`/events/${slug}`);
    // Following it lands on the event page; unknown codes are a 404.
    await page.goto(`/e/${mine}`);
    await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
    expect((await page.request.get(`/e/nothing-here-${s}`, { maxRedirects: 0 })).status()).toBe(404);
    // Another event can't take the same vanity code.
    const other = await createEvent(page, `Other Short ${s}`);
    await page.goto(`${other.base}/details`);
    await page.getByLabel('Custom short link').fill(mine.toUpperCase());
    await page.getByRole('button', { name: 'Save custom link' }).click();
    await expect(page.getByText('That link is already taken. Choose another.')).toBeVisible();
  });

  test('a viewer can read content but not change it, never sees private info or codes, and is refused on a stale form', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Viewer Content ${s}`);
    await page.goto(`${base}/content`);
    const add = page.getByRole('region', { name: 'Add a section' });
    await add.getByLabel('Section title').fill('Visible to all');
    await add.getByLabel('Text', { exact: true }).fill('Hello.');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Section added.')).toBeVisible();

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/content`);
    await expect(viewer.getByText('You can see the page content but not change it.')).toBeVisible();
    await expect(viewer.getByText('Visible to all')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add a section' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /Move .* up/ })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'New announcement' })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewer.goto(`${base}/access`);
    await expect(viewer.getByText('Only editors can see this')).toBeVisible();
    await expect(viewer.getByLabel('Information for ticket holders')).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'Access codes' })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's page, submitted after switching to the viewer: refused by the server.
    await add.getByLabel('Section title').fill('Sneaky');
    await add.getByLabel('Text', { exact: true }).fill('Should not save.');
    await signIn(page, VIEWER);
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
  });

  test('Arabic: content, access and a public page with sections render right-to-left', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `RTL Content ${s}`);
    await page.goto(`${base}/content`);
    const add = page.getByRole('region', { name: 'Add a section' });
    await add.getByLabel('Section title').fill('About');
    await add.getByLabel('Text', { exact: true }).fill('Hello **world**.');
    await add.getByRole('button', { name: 'Add section' }).click();
    await expect(add.getByText('Section added.')).toBeVisible();
    for (const path of [
      `/ar${base}/content`,
      `/ar${base}/access`,
      `/ar${base}/details`,
      `/ar/events/${slug}`,
    ]) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectAccessible(page);
      await noHorizontalScroll(page);
    }
    await expect(page.getByRole('region', { name: 'About' }).locator('strong')).toHaveText('world');
  });
});
